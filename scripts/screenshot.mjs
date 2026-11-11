/**
 * Capture a real browser screenshot of the running app for visual checks.
 * Usage: node scripts/screenshot.mjs <output.png> [width] [height] [dpr]
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser-launch.mjs';
import { openPage } from './cdp-client.mjs';
import { waitForFrames } from './cdp-client.mjs';

const outPath = process.argv[2] ?? '/tmp/claude-image-shot.png';
const width = Number(process.argv[3] ?? 1100);
const height = Number(process.argv[4] ?? 760);
const dpr = Number(process.argv[5] ?? 1);

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1200));

try {
  const browser = await launchBrowser(true);
  const page = await openPage(browser.client, 'http://127.0.0.1:4173/');
  await browser.client.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: dpr, mobile: false },
    page.sessionId,
  );
  await waitForFrames(browser.client, page.sessionId, 12);
  // Let any ResizeObserver-driven reallocation settle and confirm consistency.
  const settled = await browser.client.send(
    'Runtime.evaluate',
    {
      expression: `new Promise((resolve) => {
        let tries = 0;
        const check = () => {
          const s = window.__APP_TEST_HANDLE__.getCanvasSize();
          const c = document.getElementById('gl-canvas');
          if ((s.bufferWidth === c.width && s.bufferHeight === c.height) || tries > 20) {
            resolve(JSON.stringify(s));
          } else { tries += 1; requestAnimationFrame(check); }
        };
        requestAnimationFrame(check);
      })`,
      awaitPromise: true,
      returnByValue: true,
    },
    page.sessionId,
  );
  console.log('settled size:', settled.result?.value);
  const shot = await browser.client.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
  await writeFile(outPath, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot written: ${outPath}`);
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
