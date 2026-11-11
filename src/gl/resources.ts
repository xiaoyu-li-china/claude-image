/**
 * GPU resource registry and typed wrappers.
 *
 * Every GL object created through this layer is registered exactly once.
 * - Normal disposal calls the matching gl.delete* and unregisters the object.
 * - On webglcontextlost, GL objects are already invalid at the driver level;
 *   the registry only drops the JS handles (no delete* calls into a lost
 *   context) and marks wrappers disposed.
 * - On webglcontextrestored, GLContext asks a resource factory to rebuild
 *   the whole set, keeping all rebuild logic in one place.
 * - dispose() is idempotent: repeated calls never throw.
 */
import type { GLContext } from './context';
import { ResourceDisposedError } from './errors';

export interface ManagedResource {
  /** Recreate the underlying GL object after a context restore. */
  rebuild(): void;
  /**
   * Drop the JS handle. When `dispose` is true the context is alive and the
   * GL object must be deleted via the matching gl.delete* call.
   */
  invalidate(dispose: boolean): void;
  dispose(): void;
}

export class ResourceRegistry {
  private readonly resources = new Set<ManagedResource>();

  add(resource: ManagedResource): void {
    this.resources.add(resource);
  }

  remove(resource: ManagedResource): void {
    this.resources.delete(resource);
  }

  /** Context lost: drop all GL handles without calling delete*. */
  invalidateAll(): void {
    for (const resource of this.resources) {
      resource.invalidate(false);
    }
  }

  /** Context restored: rebuild every still-registered resource. */
  rebuildAll(): void {
    for (const resource of this.resources) {
      resource.rebuild();
    }
  }

  get size(): number {
    return this.resources.size;
  }

  /** Copy of the current resource set (safe to dispose while iterating). */
  snapshot(): ManagedResource[] {
    return [...this.resources];
  }
}

// ---------------------------------------------------------------------------
// Buffer
// ---------------------------------------------------------------------------

export interface BufferOptions {
  target?: number; // gl.ARRAY_BUFFER (default) or gl.ELEMENT_ARRAY_BUFFER
  usage?: number; // gl.STATIC_DRAW (default), gl.DYNAMIC_DRAW, ...
}

export class GLBuffer implements ManagedResource {
  private readonly ctx: GLContext;
  private readonly target: number;
  private readonly usage: number;
  private readonly initialData: BufferSource | null;
  private handle: WebGLBuffer | null;

  constructor(ctx: GLContext, data: BufferSource | null, options: BufferOptions = {}) {
    this.ctx = ctx;
    this.target = options.target ?? ctx.gl.ARRAY_BUFFER;
    this.usage = options.usage ?? ctx.gl.STATIC_DRAW;
    // Keep the source so the buffer can be recreated after context loss.
    this.initialData = data;
    this.handle = this.build();
    ctx.registry.add(this);
  }

  private build(): WebGLBuffer {
    const gl = this.ctx.gl;
    const buffer = gl.createBuffer();
    if (buffer === null) {
      throw new Error('gl.createBuffer() returned null');
    }
    gl.bindBuffer(this.target, buffer);
    gl.bufferData(this.target, this.initialData, this.usage);
    return buffer;
  }

  get webglBuffer(): WebGLBuffer {
    if (this.handle === null) {
      throw new ResourceDisposedError('buffer');
    }
    return this.handle;
  }

  bind(): void {
    this.ctx.gl.bindBuffer(this.target, this.webglBuffer);
  }

  rebuild(): void {
    this.handle = this.build();
  }

  invalidate(dispose: boolean): void {
    if (this.handle !== null) {
      if (dispose) {
        this.ctx.gl.deleteBuffer(this.handle);
      }
      this.handle = null;
    }
  }

  dispose(): void {
    this.invalidate(!this.ctx.isLost);
    this.ctx.registry.remove(this);
  }
}

// ---------------------------------------------------------------------------
// Vertex array
// ---------------------------------------------------------------------------

export interface VertexAttrib {
  /** Attribute location as used in the vertex shader. */
  location: number;
  /** Components per vertex, e.g. 2 for vec2. */
  size: number;
  type?: number; // default gl.FLOAT
  normalized?: boolean;
  stride?: number;
  offset?: number;
}

export class GLVertexArray implements ManagedResource {
  private readonly ctx: GLContext;
  private readonly vertexBuffer: GLBuffer;
  private readonly attribs: ReadonlyArray<VertexAttrib>;
  private readonly indexBuffer: GLBuffer | null;
  private handle: WebGLVertexArrayObject | null;

  constructor(
    ctx: GLContext,
    vertexBuffer: GLBuffer,
    attribs: ReadonlyArray<VertexAttrib>,
    indexBuffer: GLBuffer | null = null,
  ) {
    this.ctx = ctx;
    this.vertexBuffer = vertexBuffer;
    this.attribs = attribs;
    this.indexBuffer = indexBuffer;
    this.handle = this.build();
    ctx.registry.add(this);
  }

  private build(): WebGLVertexArrayObject {
    const gl = this.ctx.gl;
    const vao = gl.createVertexArray();
    if (vao === null) {
      throw new Error('gl.createVertexArray() returned null');
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer.webglBuffer);
    for (const attrib of this.attribs) {
      gl.enableVertexAttribArray(attrib.location);
      gl.vertexAttribPointer(
        attrib.location,
        attrib.size,
        attrib.type ?? gl.FLOAT,
        attrib.normalized ?? false,
        attrib.stride ?? 0,
        attrib.offset ?? 0,
      );
    }
    if (this.indexBuffer !== null) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer.webglBuffer);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  get webglVao(): WebGLVertexArrayObject {
    if (this.handle === null) {
      throw new ResourceDisposedError('vertex-array');
    }
    return this.handle;
  }

  bind(): void {
    this.ctx.gl.bindVertexArray(this.webglVao);
  }

  static unbind(ctx: GLContext): void {
    ctx.gl.bindVertexArray(null);
  }

  rebuild(): void {
    this.handle = this.build();
  }

  invalidate(dispose: boolean): void {
    if (this.handle !== null) {
      if (dispose) {
        this.ctx.gl.deleteVertexArray(this.handle);
      }
      this.handle = null;
    }
  }

  dispose(): void {
    this.invalidate(!this.ctx.isLost);
    this.ctx.registry.remove(this);
  }
}

// ---------------------------------------------------------------------------
// Texture
// ---------------------------------------------------------------------------

export interface Texture2DOptions {
  internalFormat?: number; // default gl.RGBA8
  format?: number; // default gl.RGBA
  type?: number; // default gl.UNSIGNED_BYTE
  minFilter?: number; // default gl.LINEAR
  magFilter?: number; // default gl.LINEAR
  wrapS?: number; // default gl.CLAMP_TO_EDGE
  wrapT?: number; // default gl.CLAMP_TO_EDGE
  generateMipmaps?: boolean; // default false
}

export class GLTexture2D implements ManagedResource {
  private readonly ctx: GLContext;
  readonly width: number;
  readonly height: number;
  private readonly options: Required<Texture2DOptions>;
  private readonly initialPixels: ArrayBufferView | null;
  private handle: WebGLTexture | null;

  constructor(
    ctx: GLContext,
    width: number,
    height: number,
    pixels: ArrayBufferView | null,
    options: Texture2DOptions = {},
  ) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    const gl = ctx.gl;
    this.options = {
      internalFormat: options.internalFormat ?? gl.RGBA8,
      format: options.format ?? gl.RGBA,
      type: options.type ?? gl.UNSIGNED_BYTE,
      minFilter: options.minFilter ?? gl.LINEAR,
      magFilter: options.magFilter ?? gl.LINEAR,
      wrapS: options.wrapS ?? gl.CLAMP_TO_EDGE,
      wrapT: options.wrapT ?? gl.CLAMP_TO_EDGE,
      generateMipmaps: options.generateMipmaps ?? false,
    };
    this.initialPixels = pixels;
    this.handle = this.build();
    ctx.registry.add(this);
  }

  private build(): WebGLTexture {
    const gl = this.ctx.gl;
    const texture = gl.createTexture();
    if (texture === null) {
      throw new Error('gl.createTexture() returned null');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.options.internalFormat,
      this.width,
      this.height,
      0,
      this.options.format,
      this.options.type,
      this.initialPixels,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.options.minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.options.magFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.options.wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.options.wrapT);
    if (this.options.generateMipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  get webglTexture(): WebGLTexture {
    if (this.handle === null) {
      throw new ResourceDisposedError('texture');
    }
    return this.handle;
  }

  bind(unit = 0): void {
    const gl = this.ctx.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.webglTexture);
  }

  rebuild(): void {
    this.handle = this.build();
  }

  invalidate(dispose: boolean): void {
    if (this.handle !== null) {
      if (dispose) {
        this.ctx.gl.deleteTexture(this.handle);
      }
      this.handle = null;
    }
  }

  dispose(): void {
    this.invalidate(!this.ctx.isLost);
    this.ctx.registry.remove(this);
  }
}
