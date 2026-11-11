/**
 * CanvasSizer — keeps the WebGL drawing buffer in sync with the canvas CSS
 * size, the active devicePixelRatio and the quality preset's
 * resolutionScale.
 *
 * Guarantees:
 *  - drawing buffer size === round(cssWidth * dpr * resolutionScale) x
 *    round(cssHeight * dpr * resolutionScale) at all times, so the frame is
 *    never stretched: CSS always displays the full buffer, the scale only
 *    changes how many device pixels are rendered inside it;
 *  - reacts to layout resizes through ResizeObserver, including a burst of
 *    consecutive resize callbacks (coalesced into one buffer reallocation
 *    per animation frame);
 *  - reacts to devicePixelRatio changes (window move across monitors,
 *    browser zoom) via a `resolution:` media query.
 */
export interface CanvasSize {
  /** CSS pixel size of the canvas. */
  cssWidth: number;
  cssHeight: number;
  /** Device pixel ratio used when the buffer was last (re)allocated. */
  dpr: number;
  /** Active internal render scale from the quality preset, in (0, 1]. */
  renderScale: number;
  /** Actual drawing buffer size in device pixels (already scaled). */
  bufferWidth: number;
  bufferHeight: number;
}

export class CanvasSizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private mediaQuery: MediaQueryList;
  private mediaListener: () => void;
  private readonly onResize: (size: CanvasSize) => void;

  private rafPending = false;
  private disposed = false;
  private lastSize: CanvasSize | null = null;
  private renderScale = 1;

  constructor(canvas: HTMLCanvasElement, onResize: (size: CanvasSize) => void) {
    this.canvas = canvas;
    this.onResize = onResize;

    this.resizeObserver = new ResizeObserver(() => this.scheduleSync());
    this.resizeObserver.observe(canvas);

    // Fires when the effective devicePixelRatio changes (zoom, monitor move).
    this.mediaQuery = this.createDprQuery();
    this.mediaListener = (): void => this.scheduleSync();
    this.mediaQuery.addEventListener('change', this.mediaListener);

    // Perform the initial allocation synchronously so the first frame is correct.
    this.syncSize();
  }

  private createDprQuery(): MediaQueryList {
    return window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  }

  /**
   * Update the internal render scale (driven solely by the active quality
   * preset). Invalid values are rejected before touching the canvas.
   */
  setRenderScale(scale: number): void {
    if (typeof scale !== 'number' || !Number.isFinite(scale) || !(scale > 0) || !(scale <= 1)) {
      throw new Error(`CanvasSizer: renderScale must be in (0, 1], got ${String(scale)}`);
    }
    if (scale === this.renderScale) {
      return;
    }
    this.renderScale = scale;
    // The DPR media query must keep watching the current dpr regardless of scale changes.
    this.mediaQuery.removeEventListener('change', this.mediaListener);
    this.mediaQuery = this.createDprQuery();
    this.mediaQuery.addEventListener('change', this.mediaListener);
    this.syncSize();
  }

  /** Coalesce burst resize events into one reallocation per animation frame. */
  private scheduleSync(): void {
    if (this.rafPending || this.disposed) {
      return;
    }
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      if (!this.disposed) {
        this.syncSize();
      }
    });
  }

  /** Recompute CSS size / DPR and reallocate the drawing buffer if changed. */
  syncSize(): CanvasSize {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, Math.round(rect.width));
    const cssHeight = Math.max(1, Math.round(rect.height));
    const bufferWidth = Math.max(1, Math.round(cssWidth * dpr * this.renderScale));
    const bufferHeight = Math.max(1, Math.round(cssHeight * dpr * this.renderScale));

    const next: CanvasSize = {
      cssWidth,
      cssHeight,
      dpr,
      renderScale: this.renderScale,
      bufferWidth,
      bufferHeight,
    };
    const prev = this.lastSize;
    if (
      prev === null ||
      prev.bufferWidth !== bufferWidth ||
      prev.bufferHeight !== bufferHeight ||
      prev.cssWidth !== cssWidth ||
      prev.cssHeight !== cssHeight ||
      prev.dpr !== dpr ||
      prev.renderScale !== this.renderScale
    ) {
      this.canvas.width = bufferWidth;
      this.canvas.height = bufferHeight;
      this.lastSize = next;
      this.onResize(next);
    }
    return next;
  }

  get size(): CanvasSize {
    return this.lastSize ?? this.syncSize();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.mediaQuery.removeEventListener('change', this.mediaListener);
  }
}
