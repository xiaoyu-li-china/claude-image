/** Stage 4 — quality config: single source of truth, validation, UI injection. */
import { evaluate } from '../cdp-client.mjs';
import { check, collectPageDiagnostics, getSize, HANDLE, setDeviceMetrics, clearDeviceMetrics } from '../test-utils.mjs';

export const STAGE_NAME = 'stage4-quality';

export async function runStage4(client, sessionId) {
  const results = [];
  const diag = collectPageDiagnostics(client, sessionId);
  await setDeviceMetrics(client, sessionId, 800, 600, 1);

  // 1. The single source defines exactly the three required presets.
  const file = await evaluate(client, sessionId, `${HANDLE}.getQualityFile()`);
  const ids = file.presets.map((p) => p.id);
  results.push(check('配置包含 smooth/balanced/ultra 三档', JSON.stringify(ids) === JSON.stringify(['smooth', 'balanced', 'ultra']), ids));
  results.push(check('默认档位为 balanced', file.defaultPresetId === 'balanced', file.defaultPresetId));

  // 2. The UI dropdown is generated from the same source — no hardcoded options.
  const selectState = await evaluate(
    client,
    sessionId,
    `(() => {
      const sel = document.getElementById('quality-select');
      return {
        values: Array.from(sel.options).map((o) => o.value),
        texts: Array.from(sel.options).map((o) => o.textContent),
        count: sel.options.length,
      };
    })()`,
  );
  const expectedValues = file.presets.map((p) => p.id);
  const expectedTexts = file.presets.map((p) => `${p.id} — ${p.label}`);
  results.push(
    check(
      'UI 下拉项与配置数据源完全一致',
      selectState.count === 3 &&
        JSON.stringify(selectState.values) === JSON.stringify(expectedValues) &&
        JSON.stringify(selectState.texts) === JSON.stringify(expectedTexts),
      selectState,
    ),
  );

  // 3. Every legal preset switches, injects params and resizes the buffer.
  for (const preset of file.presets) {
    const outcome = await evaluate(client, sessionId, `${HANDLE}.switchPreset(${JSON.stringify(preset.id)})`);
    results.push(check(`切换 ${preset.id} 成功`, outcome.ok === true && outcome.activePreset.id === preset.id, outcome));
    results.push(
      check(`切换 ${preset.id} 后渲染器收到同源参数`, outcome.activePreset.raymarchSteps === preset.raymarchSteps && outcome.activePreset.resolutionScale === preset.resolutionScale, outcome.activePreset),
    );
    const params = await evaluate(client, sessionId, `${HANDLE}.getRendererParams()`);
    results.push(
      check(`切换 ${preset.id} 后 renderer 注入参数一致`, params.raymarchSteps === preset.raymarchSteps && params.resolutionScale === preset.resolutionScale, params),
    );
    const size = await getSize(client, sessionId);
    const expectedW = Math.round(800 * preset.resolutionScale);
    const expectedH = Math.round(600 * preset.resolutionScale);
    results.push(
      check(`切换 ${preset.id} 后缓冲按 resolutionScale 重算`, size.bufferWidth === expectedW && size.bufferHeight === expectedH && size.renderScale === preset.resolutionScale, size),
    );
    const hudText = await evaluate(client, sessionId, `document.getElementById('hud').textContent`);
    results.push(
      check(`HUD 显示 ${preset.id} 生效参数`, hudText.includes(String(preset.raymarchSteps)) && hudText.includes(String(preset.resolutionScale)), { steps: preset.raymarchSteps, scale: preset.resolutionScale }),
    );
  }

  // 4. Unknown preset id is rejected; previous preset remains active.
  const before = await evaluate(client, sessionId, `${HANDLE}.getActivePreset()`);
  const rejected = await evaluate(client, sessionId, `${HANDLE}.switchPreset('does-not-exist')`);
  const after = await evaluate(client, sessionId, `${HANDLE}.getActivePreset()`);
  results.push(check('未知档位被拒绝', rejected.ok === false && rejected.error !== null && rejected.error.includes('未知画质档位'), rejected));
  results.push(check('拒绝后原档位保持不变', after.id === before.id, { before: before.id, after: after.id }));
  const errorVisible = await evaluate(client, sessionId, `${HANDLE}.getHudErrorText()`);
  results.push(check('拒绝原因显示在页面上', typeof errorVisible === 'string' && errorVisible.includes('未知画质档位'), errorVisible));

  // 5. Illegal candidates: every rule violation is rejected with a readable message.
  const illegalCandidates = [
    { name: 'steps=0', value: { raymarchSteps: 0, resolutionScale: 1 } },
    { name: 'steps 为小数 1.5', value: { raymarchSteps: 1.5, resolutionScale: 1 } },
    { name: 'steps=-4', value: { raymarchSteps: -4, resolutionScale: 1 } },
    { name: 'steps 为字符串', value: { raymarchSteps: '8', resolutionScale: 1 } },
    { name: 'scale=0', value: { raymarchSteps: 8, resolutionScale: 0 } },
    { name: 'scale=1.2 (超出 1)', value: { raymarchSteps: 8, resolutionScale: 1.2 } },
    { name: 'scale=-0.5', value: { raymarchSteps: 8, resolutionScale: -0.5 } },
    { name: 'scale 为字符串', value: { raymarchSteps: 8, resolutionScale: '0.8' } },
    { name: 'null 对象', value: null },
  ];
  for (const { name, value } of illegalCandidates) {
    const verdict = await evaluate(client, sessionId, `${HANDLE}.validateIllegalCandidate(${JSON.stringify(value)})`);
    results.push(
      check(`非法配置被拒绝：${name}`, verdict.rejected === true && typeof verdict.message === 'string' && verdict.message.length > 0 && verdict.violations.length > 0, verdict),
    );
  }

  // 6. Boundary-legal values are accepted (positive integer, scale inside (0,1]).
  const legal = await evaluate(
    client,
    sessionId,
    `${HANDLE}.validateIllegalCandidate(${JSON.stringify({ raymarchSteps: 1, resolutionScale: 0.5 })})`,
  );
  results.push(check('边界合法配置 (steps=1, scale=0.5) 通过校验', legal.rejected === false, legal));
  const legalScaleOne = await evaluate(
    client,
    sessionId,
    `${HANDLE}.validateIllegalCandidate(${JSON.stringify({ raymarchSteps: 999, resolutionScale: 1 })})`,
  );
  results.push(check('scale=1 上边界合法', legalScaleOne.rejected === false, legalScaleOne));

  // 7. No uncaught exceptions; rejected switches surface as handled errors only.
  const errors = diag.errors().filter((e) => !e.text.includes('[quality] rejected preset switch'));
  results.push(check('配置切换全程无未捕获异常', errors.length === 0, errors));

  // 8. The quality panel's effective buffer follows DPR changes, not just preset switches.
  await setDeviceMetrics(client, sessionId, 700, 500, 2);
  const dprSize = await getSize(client, sessionId);
  const panelText = await evaluate(client, sessionId, `document.getElementById('hud').textContent`);
  const effectiveShown = panelText.includes(`${dprSize.bufferWidth} × ${dprSize.bufferHeight} px`);
  results.push(
    check('DPR 变化后画质面板“生效渲染缓冲”同步刷新', dprSize.bufferWidth === 1400 && dprSize.bufferHeight === 1000 && effectiveShown, dprSize),
  );

  await clearDeviceMetrics(client, sessionId);
  return results;
}
