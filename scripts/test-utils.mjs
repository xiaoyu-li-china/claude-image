/** Shared helpers for headless test stages. */
import { evaluate, waitForFrames } from './cdp-client.mjs';

export const HANDLE = 'window.__APP_TEST_HANDLE__';

export function check(name, condition, detail) {
  return {
    name,
    ok: Boolean(condition),
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
  };
}

export async function getSize(client, sessionId) {
  return evaluate(client, sessionId, `${HANDLE}.getCanvasSize()`);
}

export async function setCssSize(client, sessionId, width, height) {
  await evaluate(client, sessionId, `${HANDLE}.setCanvasCssSize(${width}, ${height})`);
  // Coalescing goes through rAF; wait a couple of frames for the RO callback.
  await waitForFrames(client, sessionId, 3);
}

export async function setDeviceMetrics(client, sessionId, width, height, deviceScaleFactor) {
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor, mobile: false },
    sessionId,
  );
  await waitForFrames(client, sessionId, 3);
}

export async function clearDeviceMetrics(client, sessionId) {
  await client.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
  await waitForFrames(client, sessionId, 3);
}

/** Collect console API calls and uncaught page errors for the session. */
export function collectPageDiagnostics(client, sessionId) {
  const entries = [];
  const listener = (method, params, sid) => {
    if (sid !== sessionId) {
      return;
    }
    if (method === 'Runtime.consoleAPICalled') {
      const args = (params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      entries.push({ kind: `console.${params.type}`, text: args });
    } else if (method === 'Runtime.exceptionThrown') {
      entries.push({
        kind: 'exception',
        text: params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'unknown',
      });
    }
  };
  client.onEvent(listener);
  return {
    entries,
    errors: () =>
      entries.filter((e) => e.kind === 'exception' || (e.kind === 'console.error' && e.text.length > 0)),
  };
}
