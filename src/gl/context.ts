/**
 * WebGL2 context owner with loss/restore state machine.
 *
 * States: 'healthy' -> 'lost' -> 'restoring' -> 'healthy'
 *                                     \-> 'failed' (rebuild threw)
 *
 * On `webglcontextlost`:
 *   - the event is preventDefault()ed so the browser is allowed to restore;
 *   - the render loop is stopped;
 *   - every registered GPU resource drops its JS handle without calling
 *     gl.delete* (the context is already invalid);
 *   - subscribers are notified to update the UI.
 * On `webglcontextrestored`:
 *   - extensions are re-required;
 *   - all registered resources rebuild themselves (shaders recompile,
 *     buffers/textures re-upload from retained source data);
 *   - the render loop is restarted.
 */
import { ContextUnavailableError } from './errors';
import { ResourceRegistry } from './resources';

export type ContextState = 'healthy' | 'lost' | 'restoring' | 'failed';

export interface ContextOptions {
  antialias?: boolean;
  alpha?: boolean;
  depth?: boolean;
  preserveDrawingBuffer?: boolean;
}

export type ContextStateListener = (state: ContextState, detail: string) => void;

export class GLContext {
  readonly canvas: HTMLCanvasElement;
  private glHandle: WebGL2RenderingContext;
  readonly registry = new ResourceRegistry();
  private state: ContextState = 'healthy';
  private readonly listeners = new Set<ContextStateListener>();
  private readonly lostHandler: (event: Event) => void;
  private readonly restoredHandler: () => void;
  private frameToken: number | null = null;
  private frameCallback: (() => void) | null = null;
  // Extension objects are invalidated by a context loss, so cache the
  // reference and re-acquire it after every restore.
  private loseExtension: WEBGL_lose_context | null = null;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.glHandle = gl;

    this.lostHandler = (event: Event): void => {
      event.preventDefault();
      this.stopLoop();
      this.setState('lost', 'GPU 上下文已丢失，渲染循环已暂停，等待浏览器恢复…');
      // GL objects are gone at the driver level; only drop JS references.
      this.registry.invalidateAll();
    };

    this.restoredHandler = (): void => {
      this.setState('restoring', 'GPU 上下文已恢复，正在重建着色器与缓冲…');
      // Re-acquire extensions: the pre-loss extension objects are dead.
      this.loseExtension = null;
      try {
        this.registry.rebuildAll();
        this.setState('healthy', 'GPU 资源已重建，渲染循环继续');
        if (this.frameCallback !== null) {
          this.startLoop(this.frameCallback);
        }
      } catch (err) {
        this.setState('failed', `上下文恢复后资源重建失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    };

    canvas.addEventListener('webglcontextlost', this.lostHandler);
    canvas.addEventListener('webglcontextrestored', this.restoredHandler);
  }

  static create(canvas: HTMLCanvasElement, options: ContextOptions = {}): GLContext {
    const gl = canvas.getContext('webgl2', {
      antialias: options.antialias ?? false,
      alpha: options.alpha ?? false,
      depth: options.depth ?? false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (gl === null) {
      throw new ContextUnavailableError(
        'WebGL2 is unavailable in this browser or blocked by GPU policy.',
      );
    }
    return new GLContext(canvas, gl);
  }

  get gl(): WebGL2RenderingContext {
    return this.glHandle;
  }

  get isLost(): boolean {
    return this.state === 'lost' || this.state === 'failed';
  }

  get currentState(): ContextState {
    return this.state;
  }

  onStateChange(listener: ContextStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state, '上下文已初始化');
    return () => this.listeners.delete(listener);
  }

  private setState(state: ContextState, detail: string): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state, detail);
    }
  }

  // -------------------------------------------------------------------------
  // Render loop ownership — guarantees the loop is paused while lost.
  // -------------------------------------------------------------------------

  startLoop(callback: () => void): void {
    this.frameCallback = callback;
    if (this.frameToken !== null || this.isLost) {
      return;
    }
    const tick = (): void => {
      if (this.isLost) {
        this.frameToken = null;
        return;
      }
      callback();
      this.frameToken = requestAnimationFrame(tick);
    };
    this.frameToken = requestAnimationFrame(tick);
  }

  stopLoop(): void {
    if (this.frameToken !== null) {
      cancelAnimationFrame(this.frameToken);
      this.frameToken = null;
    }
  }

  get isLoopRunning(): boolean {
    return this.frameToken !== null;
  }

  // -------------------------------------------------------------------------
  // Explicit loss simulation (WEBGL_lose_context) + manual restore request.
  // -------------------------------------------------------------------------

  private getLoseExtension(): WEBGL_lose_context {
    if (this.loseExtension === null) {
      const ext = this.glHandle.getExtension('WEBGL_lose_context');
      if (ext === null) {
        throw new ContextUnavailableError('WEBGL_lose_context extension is not available');
      }
      this.loseExtension = ext;
    }
    return this.loseExtension;
  }

  loseForTesting(): void {
    this.getLoseExtension().loseContext();
  }

  restoreForTesting(): void {
    this.getLoseExtension().restoreContext();
  }

  /** Wait until the context reaches one of the expected states. */
  waitForState(expected: ReadonlyArray<ContextState>, timeoutMs = 5000): Promise<ContextState> {
    return new Promise((resolve, reject) => {
      if (expected.includes(this.state)) {
        resolve(this.state);
        return;
      }
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`Timed out waiting for context state ${expected.join('/')} (current: ${this.state})`));
      }, timeoutMs);
      const listener: ContextStateListener = (state) => {
        if (expected.includes(state)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(state);
        }
      };
      this.listeners.add(listener);
    });
  }

  dispose(): void {
    this.stopLoop();
    this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
    this.canvas.removeEventListener('webglcontextrestored', this.restoredHandler);
    for (const resource of this.registry.snapshot()) {
      resource.dispose();
    }
    this.listeners.clear();
  }
}
