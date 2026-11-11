/**
 * Application bootstrap. Owns canvas, GL context, resize handling and the
 * render loop; all GPU objects go through the GL tool layer so context-loss
 * rebuild and dispose() semantics apply uniformly.
 */
import './styles.css';
import { CanvasSizer, type CanvasSize } from './render/canvas-sizer';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import {
  GLBuffer,
  GLContext,
  GLProgram,
  GLTexture2D,
  ProgramLinkError,
  ShaderCompileError,
  annotateSource,
} from './gl';
import { logSelfTestResults, runAllSelfTests, type SelfTestResult } from './math/self-test';
import {
  QualityConfigError,
  assertLegalPreset,
  getDefaultPresetId,
  getQualityPreset,
  listQualityPresets,
  type QualityPreset,
} from './config/quality';

const canvasEl = document.getElementById('gl-canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) {
  throw new Error('#gl-canvas element missing or wrong type');
}
const canvas: HTMLCanvasElement = canvasEl;

const ctx = GLContext.create(canvas, {
  antialias: false,
  alpha: false,
  depth: false,
  preserveDrawingBuffer: false,
});

const renderer = new Renderer(ctx);

let activePreset: QualityPreset = getQualityPreset(getDefaultPresetId());

const hud = new Hud({
  onQualityChange: (presetId) => applyQualityPreset(presetId),
  onLoseContext: () => ctx.loseForTesting(),
  onRestoreContext: () => ctx.restoreForTesting(),
  onRunSelfTests: () => runAndShowSelfTests(),
});

hud.setQualityOptions(
  listQualityPresets().map((preset) => ({ label: preset.id, value: `${preset.id} — ${preset.label}` })),
  activePreset.id,
);

// Sizer is created after the HUD because its constructor performs an
// immediate synchronous resize that updates the HUD.
const sizer = new CanvasSizer(canvas, (size: CanvasSize) => {
  renderer.resize(size.bufferWidth, size.bufferHeight);
  updateSizeHud(size);
  // The quality panel also displays the effective buffer, so keep it in
  // sync with every resize / DPR change, not just preset switches.
  updateQualityHud();
});

// Inject the default preset's scale at startup — render params always come
// from the config module, never from a local literal.
sizer.setRenderScale(activePreset.resolutionScale);
// Inject into the renderer synchronously so params never lag a frame behind
// the active preset.
renderer.setPreset(activePreset);

function updateSizeHud(size: CanvasSize): void {
  hud.setSizeInfo([
    { label: 'CSS 尺寸', value: `${size.cssWidth} × ${size.cssHeight} px` },
    { label: 'devicePixelRatio', value: size.dpr.toFixed(3) },
    { label: '渲染缩放', value: size.renderScale.toFixed(3) },
    { label: '缓冲尺寸', value: `${size.bufferWidth} × ${size.bufferHeight} px` },
    { label: 'canvas.width/height', value: `${canvas.width} × ${canvas.height}` },
  ]);
}

function applyQualityPreset(presetId: string): void {
  try {
    // Validation runs on every switch; an illegal preset is rejected and
    // the previously active one stays in effect.
    const candidate = getQualityPreset(presetId);
    assertLegalPreset(candidate, `档位 ${presetId}`);
    activePreset = candidate;
    sizer.setRenderScale(candidate.resolutionScale);
    renderer.setPreset(candidate);
    hud.clearError();
    updateQualityHud();
  } catch (err) {
    const message = err instanceof QualityConfigError ? err.message : String(err);
    hud.showError(`画质切换被拒绝：${message}`);
    console.error('[quality] rejected preset switch:', err);
  }
}

function updateQualityHud(): void {
  // Read the buffer from the canvas itself (not `sizer`) so this is safe
  // to call from inside the sizer's own initial resize callback.
  hud.setQualityDetail([
    { label: '当前档位', value: `${activePreset.id}（${activePreset.label}）` },
    { label: 'raymarchSteps', value: String(activePreset.raymarchSteps) },
    { label: 'resolutionScale', value: String(activePreset.resolutionScale) },
    {
      label: '生效渲染缓冲',
      value: `${canvas.width} × ${canvas.height} px`,
    },
  ]);
}

updateQualityHud();
updateSizeHud(sizer.size);

function runAndShowSelfTests(): SelfTestResult[] {
  const results = runAllSelfTests();
  logSelfTestResults(results);
  hud.setTestResults(
    results.map((r) => ({ name: r.name, ok: r.ok, detail: `误差 ${r.maxError.toExponential(2)} / 容差 ${r.tolerance.toExponential(0)}` })),
  );
  return results;
}

// Self-tests run at boot so results are visible on the page and console.
runAndShowSelfTests();

ctx.onStateChange((state, detail) => {
  hud.setContextStatus(state, detail);
});

let frame = 0;
ctx.startLoop(() => {
  frame += 1;
  // The active preset is the single source for render parameters; the
  // renderer reads it each frame so future raymarching work picks it up.
  renderer.render(performance.now() / 1000, activePreset);
});

// ---------------------------------------------------------------------------
// Test handle consumed by scripts/headless-test.mjs (see src/env.d.ts).
// ---------------------------------------------------------------------------
window.__APP_TEST_HANDLE__ = {
  getCanvasSize: () => ({ ...sizer.size }),
  setCanvasCssSize: (width: number, height: number) => {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  },
  resetCanvasCssSize: () => {
    canvas.style.width = '';
    canvas.style.height = '';
  },
  readCenterPixel: (): Promise<[number, number, number, number]> =>
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        renderer.render(performance.now() / 1000);
        const gl = ctx.gl;
        const x = Math.floor(gl.drawingBufferWidth / 2);
        const y = Math.floor(gl.drawingBufferHeight / 2);
        const px = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        resolve([px[0] ?? 0, px[1] ?? 0, px[2] ?? 0, px[3] ?? 0]);
      });
    }),
  getFrameCount: () => frame,
  getActivePreset: () => ({ ...activePreset }),
  getRenderScale: () => sizer.size.renderScale,
  getRendererParams: () => renderer.renderParams,
  getQualityFile: () => ({
    defaultPresetId: getDefaultPresetId(),
    presets: listQualityPresets().map((p) => ({ ...p })),
  }),
  getHudErrorText: () => {
    const box = document.querySelector('#hud .error-box');
    return box === null ? null : (box as HTMLElement).hidden ? null : (box.textContent ?? '');
  },
  switchPreset: (presetId: string) => {
    const before = activePreset.id;
    applyQualityPreset(presetId);
    const changed = activePreset.id !== before;
    return {
      ok: changed,
      activePreset: { ...activePreset },
      renderScale: sizer.size.renderScale,
      error: ((): string | null => {
        const box = document.querySelector('#hud .error-box');
        if (box === null) return null;
        const el = box as HTMLElement;
        return el.hidden ? null : el.textContent;
      })(),
    };
  },
  validateIllegalCandidate: (candidate: unknown) => {
    try {
      assertLegalPreset(candidate, 'test-candidate');
      return { rejected: false };
    } catch (err) {
      if (err instanceof QualityConfigError) {
        return { rejected: true, message: err.message, violations: [...err.violations] };
      }
      return { rejected: true, message: String(err), violations: [String(err)] };
    }
  },
  getContextState: () => ctx.currentState,
  getRegistrySize: () => ctx.registry.size,
  getLoopRunning: () => ctx.isLoopRunning,
  loseContext: async () => {
    ctx.loseForTesting();
    await ctx.waitForState(['lost']);
  },
  restoreContext: async () => {
    ctx.restoreForTesting();
    await ctx.waitForState(['healthy']);
  },
  probeCompileError: () => {
    const badSource = `#version 300 es
void main() {
  undeclaredIdentifier = 1.0;
}`;
    try {
      // eslint-disable-next-line no-new
      new GLProgram(ctx, 'void main() { gl_Position = vec4(0.0); }', badSource);
      return { thrown: false };
    } catch (err) {
      if (err instanceof ShaderCompileError) {
        return {
          thrown: true,
          errorName: err.name,
          stage: err.stage,
          infoLog: err.infoLog,
          hasLineNumbers: annotateSource(badSource).includes('1 |') && err.message.includes('3 |'),
        };
      }
      return { thrown: true, wrongType: String(err) };
    }
  },
  probeLinkError: () => {
    const vs = `#version 300 es
out vec3 vColor;
void main() {
  vColor = vec3(1.0);
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}`;
    const fs = `#version 300 es
precision highp float;
in vec2 vColor;
out vec4 outColor;
void main() {
  // Compiles standalone (vec2 + two scalars = vec4); link fails because the
  // vertex stage declares vColor as vec3 — interface type mismatch.
  outColor = vec4(vColor, 0.0, 1.0);
}`;
    try {
      // eslint-disable-next-line no-new
      new GLProgram(ctx, vs, fs);
      return { thrown: false };
    } catch (err) {
      if (err instanceof ProgramLinkError) {
        return {
          thrown: true,
          errorName: err.name,
          infoLog: err.infoLog,
          containsBothSources: err.message.includes('vertex shader source') && err.message.includes('fragment shader source'),
        };
      }
      return { thrown: true, wrongType: String(err) };
    }
  },
  probeDisposeIdempotent: () => {
    const gl = ctx.gl;
    const before = ctx.registry.size;
    const buffer = new GLBuffer(ctx, new Float32Array([1, 2, 3]));
    const texture = new GLTexture2D(ctx, 2, 2, new Uint8Array(16));
    const bufferHandle = buffer.webglBuffer;
    const textureHandle = texture.webglTexture;
    const aliveBeforeDispose = gl.isBuffer(bufferHandle) && gl.isTexture(textureHandle);
    const afterCreate = ctx.registry.size;
    buffer.dispose();
    texture.dispose();
    // Repeated dispose must not throw and must not change the registry.
    buffer.dispose();
    texture.dispose();
    const afterDispose = ctx.registry.size;
    // GL-side deletion is real, not just registry bookkeeping.
    const deletedInDriver = !gl.isBuffer(bufferHandle) && !gl.isTexture(textureHandle);
    return { before, afterCreate, afterDispose, noThrow: true, aliveBeforeDispose, deletedInDriver };
  },
  runSelfTests: async () => runAndShowSelfTests(),
};
