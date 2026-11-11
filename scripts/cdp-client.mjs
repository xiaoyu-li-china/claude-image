/**
 * Minimal Chrome DevTools Protocol client over a raw WebSocket.
 * Zero third-party dependencies — Node 24 ships a global WebSocket.
 * Supports the flat-session mode (sessionId attached to each command).
 */

export class CdpError extends Error {
  constructor(message, code) {
    super(`CDP ${code}: ${message}`);
    this.name = 'CdpError';
    this.code = code;
  }
}

export class CdpClient {
  #nextId = 1;
  #pending = new Map();
  #eventListeners = new Set();
  #ws;

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (ev) => this.#onMessage(String(ev.data)));
    ws.addEventListener('error', () => {
      const err = new Error('CDP WebSocket error');
      for (const { reject } of this.#pending.values()) {
        reject(err);
      }
      this.#pending.clear();
    });
    ws.addEventListener('close', () => {
      const err = new Error('CDP WebSocket closed');
      for (const { reject } of this.#pending.values()) {
        reject(err);
      }
      this.#pending.clear();
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)), { once: true });
    });
    return new CdpClient(ws);
  }

  #onMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.id !== undefined && this.#pending.has(msg.id)) {
      const entry = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (entry === undefined) {
        return;
      }
      if (msg.error !== undefined) {
        entry.reject(new CdpError(msg.error.message, msg.error.code));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }
    if (msg.method !== undefined) {
      for (const listener of this.#eventListeners) {
        listener(msg.method, msg.params ?? {}, msg.sessionId);
      }
    }
  }

  onEvent(listener) {
    this.#eventListeners.add(listener);
  }

  offEvent(listener) {
    this.#eventListeners.delete(listener);
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const payload = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(payload);
    });
  }

  close() {
    this.#ws.close();
  }
}

/** Open a fresh page target and attach to it in flat-session mode. */
export async function openPage(client, url) {
  const created = await client.send('Target.createTarget', { url: 'about:blank' });
  const attached = await client.send('Target.attachToTarget', {
    targetId: created.targetId,
    flatten: true,
  });
  const sessionId = attached.sessionId;
  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Log.enable', {}, sessionId);
  await client.send('Page.navigate', { url }, sessionId);
  await waitForLoad(client, sessionId);
  return { client, sessionId, targetId: created.targetId };
}

export function waitForLoad(client, sessionId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const listener = (method, _params, sid) => {
      if (method === 'Page.loadEventFired' && sid === sessionId) {
        clearTimeout(timer);
        client.offEvent(listener);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      client.offEvent(listener);
      reject(new Error('Timed out waiting for Page.loadEventFired'));
    }, timeoutMs);
    client.onEvent(listener);
  });
}

/** Evaluate an expression and return its result (awaited if it is a promise). */
export async function evaluate(client, sessionId, expression, awaitPromise = true) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    },
    sessionId,
  );
  if (result.exceptionDetails !== undefined) {
    const desc = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(`Page exception: ${desc}`);
  }
  return result.result?.value;
}

/** Resolve after `frames` animation frames have elapsed inside the page. */
export async function waitForFrames(client, sessionId, frames = 2) {
  await evaluate(
    client,
    sessionId,
    `new Promise((resolve) => {
      let n = 0;
      const tick = () => { n += 1; if (n >= ${frames}) { resolve(true); } else { requestAnimationFrame(tick); } };
      requestAnimationFrame(tick);
    })`,
  );
}
