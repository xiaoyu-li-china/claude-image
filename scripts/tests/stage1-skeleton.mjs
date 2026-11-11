/** Stage 1 — engineering skeleton: resize, DPR, drawing-buffer consistency. */
import { evaluate, waitForFrames } from '../cdp-client.mjs';
import { check, collectPageDiagnostics, getSize, HANDLE, setCssSize, setDeviceMetrics, clearDeviceMetrics } from '../test-utils.mjs';

export const STAGE_NAME = 'stage1-skeleton';

export async function runStage1(client, sessionId) {
  const results = [];
  const diag = collectPageDiagnostics(client, sessionId);

  // 1. Initial allocation matches the emulated viewport at dpr=1.
  await setDeviceMetrics(client, sessionId, 800, 600, 1);
  let size = await getSize(client, sessionId);
  results.push(
    check('初始缓冲尺寸 = CSS 尺寸 (dpr=1)', size.bufferWidth === 800 && size.bufferHeight === 600, size),
  );
  results.push(check('初始 CSS 尺寸正确', size.cssWidth === 800 && size.cssHeight === 600, size));

  // 2. CSS-driven resize reallocates the buffer (no stretching).
  await setCssSize(client, sessionId, 640, 480);
  size = await getSize(client, sessionId);
  results.push(
    check('CSS resize 后缓冲同步', size.bufferWidth === 640 && size.bufferHeight === 480, size),
  );

  // 3. Burst of consecutive ResizeObserver callbacks — coalesced, final state correct.
  await evaluate(
    client,
    sessionId,
    `(async () => {
      const H = ${HANDLE};
      for (let i = 0; i < 20; i++) {
        H.setCanvasCssSize(300 + i * 10, 200 + i * 6);
      }
    })()`,
  );
  await waitForFrames(client, sessionId, 5);
  size = await getSize(client, sessionId);
  const burstOk = size.cssWidth === 490 && size.cssHeight === 314 && size.bufferWidth === 490 && size.bufferHeight === 314;
  results.push(check('连续 20 次 resize 后缓冲与 CSS 一致', burstOk, size));

  // 4. devicePixelRatio change (zoom / monitor move) — buffer scales, CSS stays.
  await evaluate(client, sessionId, `${HANDLE}.resetCanvasCssSize()`);
  await setDeviceMetrics(client, sessionId, 800, 600, 2);
  size = await getSize(client, sessionId);
  results.push(
    check('dpr=2 时缓冲翻倍且 CSS 不变', size.cssWidth === 800 && size.cssHeight === 600 && size.bufferWidth === 1600 && size.bufferHeight === 1200, size),
  );

  // 5. Fractional DPR — rounding must match CanvasSizer's documented rule.
  await setDeviceMetrics(client, sessionId, 801, 601, 1.5);
  size = await getSize(client, sessionId);
  results.push(
    check(
      'dpr=1.5 时按 round(css*dpr) 分配',
      size.cssWidth === 801 && size.cssHeight === 601 && size.bufferWidth === Math.round(801 * 1.5) && size.bufferHeight === Math.round(601 * 1.5),
      size,
    ),
  );

  // 6. Actual rendering lands in the buffer (gradient: center ≈ (128,128,153,255)).
  await setDeviceMetrics(client, sessionId, 800, 600, 1);
  await waitForFrames(client, sessionId, 2);
  const pixel = await evaluate(client, sessionId, `${HANDLE}.readCenterPixel()`);
  // Fragment output at center: R/G ≈ 128, B pulses 102..153 with uTime, A = 255.
  const pixelOk = Array.isArray(pixel) && pixel[3] === 255 && Math.abs(pixel[0] - 128) <= 2 && Math.abs(pixel[1] - 128) <= 2 && pixel[2] >= 100 && pixel[2] <= 155;
  results.push(check('实际渲染写入缓冲（中心像素符合渐变）', pixelOk, pixel));

  // 7. Animation loop keeps advancing after all resizes.
  const f1 = await evaluate(client, sessionId, `${HANDLE}.getFrameCount()`);
  await waitForFrames(client, sessionId, 5);
  const f2 = await evaluate(client, sessionId, `${HANDLE}.getFrameCount()`);
  results.push(check('resize 后渲染循环持续推进', f2 > f1, { before: f1, after: f2 }));

  await clearDeviceMetrics(client, sessionId);

  // 8. No uncaught exceptions / console errors during the whole sequence.
  const errors = diag.errors();
  results.push(check('页面无未捕获异常', errors.length === 0, errors));

  return results;
}
