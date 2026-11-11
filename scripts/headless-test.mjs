/**
 * Headless verification runner — drives the real production build in a real
 * Chromium via the DevTools Protocol (no third-party npm packages).
 *
 * Usage: npm run test:headless
 */
import { spawn } from 'node:child_process';
import { launchBrowser } from './browser-launch.mjs';
import { openPage } from './cdp-client.mjs';
import { runStage1 } from './tests/stage1-skeleton.mjs';
import { runStage2 } from './tests/stage2-gl-tools.mjs';
import { runStage3 } from './tests/stage3-math.mjs';
import { runStage4 } from './tests/stage4-quality.mjs';
import { runDocConsistencyCheck } from './tests/doc-consistency.mjs';

const BASE_URL = 'http://127.0.0.1:4173/';

async function withPreviewServer(run) {
  // Explicit 127.0.0.1 binding: default `vite preview` only listens on
  // "localhost" which may resolve to ::1 and be unreachable from headless.
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (c) => (output += c.toString()));
  server.stderr.on('data', (c) => (output += c.toString()));
  try {
    for (let i = 0; i < 100; i++) {
      try {
        const resp = await fetch(BASE_URL);
        if (resp.ok) {
          break;
        }
      } catch {
        // server not up yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await run();
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (server.exitCode === null) {
      server.kill('SIGKILL');
    }
    if (process.env.DEBUG_PREVIEW) {
      process.stdout.write(output);
    }
  }
}

const STAGES = [
  ['stage1-skeleton', runStage1],
  ['stage2-gl-tools', runStage2],
  ['stage3-math', runStage3],
  ['stage4-quality', runStage4],
];

async function main() {
  let browser;
  const all = [];
  // Node-side guard runs without a browser.
  all.push({ name: 'doc-consistency', results: await runDocConsistencyCheck() });
  try {
    await withPreviewServer(async () => {
      browser = await launchBrowser(true);
      for (const [name, run] of STAGES) {
        const page = await openPage(browser.client, BASE_URL);
        try {
          const results = await run(browser.client, page.sessionId);
          all.push({ name, results });
        } finally {
          await browser.client.send('Target.closeTarget', { targetId: page.targetId }, page.sessionId);
        }
      }
    });
  } finally {
    if (browser !== undefined) {
      await browser.close();
    }
  }

  let failures = 0;
  for (const { name, results } of all) {
    process.stdout.write(`\n=== ${name} ===\n`);
    for (const r of results) {
      process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.detail}`}\n`);
      if (!r.ok) {
        failures += 1;
      }
    }
  }
  process.stdout.write(`\n${failures === 0 ? 'ALL STAGES PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
