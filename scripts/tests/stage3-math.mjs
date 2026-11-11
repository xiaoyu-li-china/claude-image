/** Stage 3 — math library self-tests (the four required cases). */
import { evaluate } from '../cdp-client.mjs';
import { check, collectPageDiagnostics, HANDLE } from '../test-utils.mjs';

const REQUIRED_IDS = ['identity', 'perspective-roundtrip', 'lookat-orthogonality', 'unproject-ndc'];

export const STAGE_NAME = 'stage3-math';

export async function runStage3(client, sessionId) {
  const results = [];
  const diag = collectPageDiagnostics(client, sessionId);

  const tests = await evaluate(client, sessionId, `${HANDLE}.runSelfTests()`);
  results.push(check('自测返回 4 个用例', Array.isArray(tests) && tests.length === 4, { count: tests?.length }));

  const byId = new Map(tests.map((t) => [t.id, t]));
  for (const id of REQUIRED_IDS) {
    const t = byId.get(id);
    results.push(check(`必需用例存在：${id}`, t !== undefined, t ?? null));
  }

  for (const t of tests) {
    results.push(check(`[${t.id}] PASS（未弱化断言）`, t.ok === true, { maxError: t.maxError, tolerance: t.tolerance, detail: t.detail }));
    // Tolerances must remain tight: nothing looser than 1e-9 may be accepted.
    results.push(check(`[${t.id}] 容差严格 (<=1e-9)`, t.tolerance <= 1e-9, { tolerance: t.tolerance }));
    results.push(check(`[${t.id}] 观测误差为有限数且低于容差`, Number.isFinite(t.maxError) && t.maxError <= t.tolerance, { maxError: t.maxError }));
  }

  // Specific, strong expectations per case.
  const identity = byId.get('identity');
  results.push(check('单位矩阵用例覆盖矩阵与点变换', identity && identity.detail.includes('结构检查=true'), identity?.detail));

  const roundtrip = byId.get('perspective-roundtrip');
  results.push(check('透视往返同时验证 invP*P=I 与通用 inverse 一致', roundtrip && roundtrip.detail.includes('通用逆矩阵'), roundtrip?.detail));

  const lookat = byId.get('lookat-orthogonality');
  results.push(check('lookAt 用例覆盖 R^T R 与右手系', lookat && lookat.detail.includes('右手系'), lookat?.detail));

  const ndc = byId.get('unproject-ndc');
  results.push(check('NDC 还原用例含近/远平面四角采样', ndc && /12 个采样点/.test(ndc.detail), ndc?.detail));

  // Results are visible in the page (HUD list + JSON island) and console.
  const hudItems = await evaluate(
    client,
    sessionId,
    `document.querySelectorAll('#hud ul li').length`,
  );
  results.push(check('自测结果渲染到页面 HUD', hudItems === 4, { hudItems }));
  const jsonIsland = await evaluate(
    client,
    sessionId,
    `(() => { const raw = document.getElementById('test-results').textContent; const parsed = JSON.parse(raw); return Array.isArray(parsed) && parsed.length === 4 && parsed.every((r) => typeof r.ok === 'boolean'); })()`,
  );
  results.push(check('自测结果写入 #test-results JSON 岛', jsonIsland === true, jsonIsland));

  const consoleErrors = diag.errors();
  results.push(check('自测过程无未捕获异常', consoleErrors.length === 0, consoleErrors));

  return results;
}
