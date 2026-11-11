/**
 * Launch a Chrome for Testing binary (from the local Playwright browser cache)
 * with remote debugging enabled, using only Node built-ins.
 *
 * @typedef {object} LaunchedBrowser
 * @property {import('./cdp-client.mjs').CdpClient} client
 * @property {() => Promise<void>} close
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.HOME ?? '';
const CANDIDATES = [
  join(
    HOME,
    'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ),
  join(HOME, 'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

async function resolveChrome() {
  for (const path of CANDIDATES) {
    try {
      await readFile(path);
      return path;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`No Chrome binary found. Tried:\n${CANDIDATES.join('\n')}`);
}

/** @returns {Promise<LaunchedBrowser>} */
export async function launchBrowser(headless = true) {
  const chromePath = await resolveChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'claude-image-cdp-'));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--enable-unsafe-swiftshader',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    'about:blank',
  ];

  const proc = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const portFile = join(userDataDir, 'DevToolsActivePort');
  const port = await waitForPortFile(portFile);
  const versionResp = await fetch(`http://127.0.0.1:${port}/json/version`);
  const version = await versionResp.json();

  const { CdpClient } = await import('./cdp-client.mjs');
  const client = await CdpClient.connect(version.webSocketDebuggerUrl);

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      client.close();
    } finally {
      proc.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
      }
      await rm(userDataDir, { recursive: true, force: true });
    }
  };

  proc.on('exit', (code) => {
    if (!closed && code !== 0) {
      process.stderr.write(`[browser] exited early (${code}):\n${stderr}\n`);
    }
  });

  return { client, close };
}

async function waitForPortFile(path, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(path, 'utf8');
      const line = content.split('\n')[0];
      if (line !== undefined && line.trim() !== '') {
        return Number(line.trim());
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
