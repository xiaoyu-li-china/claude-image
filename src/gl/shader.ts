/**
 * Shader / program compilation pipeline with full driver diagnostics.
 * All objects produced here are registered with the GLContext resource
 * registry and are recreated automatically after a context restore.
 */
import type { GLContext } from './context';
import { ProgramLinkError, ResourceDisposedError, ShaderCompileError, type ShaderStage } from './errors';

function compileShader(gl: WebGL2RenderingContext, stage: ShaderStage, source: string): WebGLShader {
  const type = stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER;
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new ShaderCompileError(stage, 'gl.createShader() returned null', source);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const infoLog = gl.getShaderInfoLog(shader) ?? '(empty info log)';
    gl.deleteShader(shader);
    throw new ShaderCompileError(stage, infoLog, source);
  }
  return shader;
}

export interface AttributeSpec {
  name: string;
  location: number;
}

export class GLProgram {
  private readonly ctx: GLContext;
  private handle: WebGLProgram | null;
  readonly vertexSource: string;
  readonly fragmentSource: string;
  private readonly uniformCache = new Map<string, WebGLUniformLocation | null>();

  constructor(ctx: GLContext, vertexSource: string, fragmentSource: string) {
    this.ctx = ctx;
    this.vertexSource = vertexSource;
    this.fragmentSource = fragmentSource;
    this.handle = this.build();
    ctx.registry.add(this);
  }

  private build(): WebGLProgram {
    const gl = this.ctx.gl;
    const vertex = compileShader(gl, 'vertex', this.vertexSource);
    const fragment = compileShader(gl, 'fragment', this.fragmentSource);
    const program = gl.createProgram();
    if (program === null) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      throw new ProgramLinkError('gl.createProgram() returned null', this.vertexSource, this.fragmentSource);
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    // Shader objects can be detached and deleted once linked.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      const infoLog = gl.getProgramInfoLog(program) ?? '(empty info log)';
      gl.deleteProgram(program);
      throw new ProgramLinkError(infoLog, this.vertexSource, this.fragmentSource);
    }
    return program;
  }

  get webglProgram(): WebGLProgram {
    if (this.handle === null) {
      throw new ResourceDisposedError('program');
    }
    return this.handle;
  }

  use(): void {
    this.ctx.gl.useProgram(this.webglProgram);
  }

  uniformLocation(name: string): WebGLUniformLocation | null {
    if (this.uniformCache.has(name)) {
      return this.uniformCache.get(name) ?? null;
    }
    const location = this.ctx.gl.getUniformLocation(this.webglProgram, name);
    this.uniformCache.set(name, location);
    return location;
  }

  /** Called by GLContext after a context restore. */
  rebuild(): void {
    this.uniformCache.clear();
    this.handle = this.build();
  }

  /** Drop the JS reference. On a live context, delete the GL object first. */
  invalidate(dispose: boolean): void {
    if (this.handle !== null) {
      if (dispose) {
        this.ctx.gl.deleteProgram(this.handle);
      }
      this.handle = null;
    }
    this.uniformCache.clear();
  }

  dispose(): void {
    this.invalidate(!this.ctx.isLost);
    this.ctx.registry.remove(this);
  }
}
