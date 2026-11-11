/**
 * Ambient declarations for browser-only globals used by the test harness.
 * Kept in one place so application code never needs `any`.
 */
export interface ProbeResult {
  thrown: boolean;
  [key: string]: unknown;
}

export interface AppTestHandle {
  getCanvasSize: () => {
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    bufferWidth: number;
    bufferHeight: number;
  };
  setCanvasCssSize: (width: number, height: number) => void;
  resetCanvasCssSize: () => void;
  readCenterPixel: () => Promise<[number, number, number, number]>;
  getFrameCount: () => number;
  getActivePreset: () => { id: string; label: string; raymarchSteps: number; resolutionScale: number };
  getRenderScale: () => number;
  getRendererParams: () => { raymarchSteps: number; resolutionScale: number } | null;
  getQualityFile: () => {
    defaultPresetId: string;
    presets: Array<{ id: string; label: string; raymarchSteps: number; resolutionScale: number }>;
  };
  getHudErrorText: () => string | null;
  switchPreset: (presetId: string) => {
    ok: boolean;
    activePreset: { id: string; label: string; raymarchSteps: number; resolutionScale: number };
    renderScale: number;
    error: string | null;
  };
  validateIllegalCandidate: (candidate: unknown) =>
    | { rejected: false }
    | { rejected: true; message: string; violations: string[] };
  getContextState: () => string;
  getRegistrySize: () => number;
  getLoopRunning: () => boolean;
  loseContext: () => Promise<void>;
  restoreContext: () => Promise<void>;
  probeCompileError: () => ProbeResult;
  probeLinkError: () => ProbeResult;
  probeDisposeIdempotent: () => {
    before: number;
    afterCreate: number;
    afterDispose: number;
    noThrow: boolean;
    aliveBeforeDispose: boolean;
    deletedInDriver: boolean;
  };
  runSelfTests: () => Promise<Array<{
    id: string;
    name: string;
    ok: boolean;
    detail: string;
    maxError: number;
    tolerance: number;
  }>>;
}

declare global {
  interface Window {
    __APP_TEST_HANDLE__?: AppTestHandle;
  }
}

export {};
