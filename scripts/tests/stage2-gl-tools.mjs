/** Stage 2 — GL tool layer: diagnostics, resource registry, context loss/restore. */
import { evaluate, waitForFrames } from '../cdp-client.mjs';
import { check, collectPageDiagnostics, getSize, HANDLE } from '../test-utils.mjs';

export const STAGE_NAME = 'stage2-gl-tools';

export async function runStage2(client, sessionId) {
  const results = [];
  const diag = collectPageDiagnostics(client, sessionId);

  // 1. Shader compile error carries info log, stage and annotated source.
  const compileProbe = await evaluate(client, sessionId, `${HANDLE}.probeCompileError()`);
  results.push(
    check('编译失败抛出 ShaderCompileError', compileProbe.thrown === true && compileProbe.errorName === 'ShaderCompileError', compileProbe),
  );
  results.push(
    check('错误携带 shader 类型 (fragment)', compileProbe.stage === 'fragment', compileProbe),
  );
  results.push(
    check('错误携带 getShaderInfoLog 原文', typeof compileProbe.infoLog === 'string' && compileProbe.infoLog.length > 0, compileProbe.infoLog),
  );
  results.push(
    check('错误消息包含带行号的源码', compileProbe.hasLineNumbers === true, compileProbe),
  );

  // 2. Program link error carries program info log and both sources.
  const linkProbe = await evaluate(client, sessionId, `${HANDLE}.probeLinkError()`);
  results.push(
    check('链接失败抛出 ProgramLinkError', linkProbe.thrown === true && linkProbe.errorName === 'ProgramLinkError', linkProbe),
  );
  results.push(
    check('链接错误携带 getProgramInfoLog 原文', typeof linkProbe.infoLog === 'string' && linkProbe.infoLog.length > 0, linkProbe.infoLog),
  );
  results.push(
    check('链接错误包含两端 shader 源码', linkProbe.containsBothSources === true, linkProbe),
  );

  // 3. Resources register on create, unregister on dispose; repeat dispose is safe.
  const disposeProbe = await evaluate(client, sessionId, `${HANDLE}.probeDisposeIdempotent()`);
  results.push(
    check('资源创建即登记 (registry +2)', disposeProbe.afterCreate === disposeProbe.before + 2, disposeProbe),
  );
  results.push(
    check('dispose 后注销且重复 dispose 不报错', disposeProbe.afterDispose === disposeProbe.before && disposeProbe.noThrow === true, disposeProbe),
  );
  results.push(
    check('dispose 前 GL 对象存活、dispose 后驱动层确认删除', disposeProbe.aliveBeforeDispose === true && disposeProbe.deletedInDriver === true, disposeProbe),
  );

  // 4. Baseline: loop is running and framebuffer is being drawn into.
  const stateBefore = await evaluate(client, sessionId, `${HANDLE}.getContextState()`);
  const loopBefore = await evaluate(client, sessionId, `${HANDLE}.getLoopRunning()`);
  const registryBefore = await evaluate(client, sessionId, `${HANDLE}.getRegistrySize()`);
  results.push(check('丢失前上下文 healthy 且渲染循环运行', stateBefore === 'healthy' && loopBefore === true, { stateBefore, loopBefore }));
  results.push(check('渲染器资源已登记 (program/buffer/VAO)', registryBefore >= 3, { registryBefore }));

  // 5. Force a real context loss via WEBGL_lose_context.
  await evaluate(client, sessionId, `${HANDLE}.loseContext()`);
  const stateLost = await evaluate(client, sessionId, `${HANDLE}.getContextState()`);
  const loopLost = await evaluate(client, sessionId, `${HANDLE}.getLoopRunning()`);
  const registryLost = await evaluate(client, sessionId, `${HANDLE}.getRegistrySize()`);
  results.push(check('webglcontextlost 后状态为 lost', stateLost === 'lost', { stateLost }));
  results.push(check('上下文丢失时渲染循环已暂停', loopLost === false, { loopLost }));
  const badgeLost = await evaluate(
    client,
    sessionId,
    `document.querySelector('#hud .badge').textContent`,
  );
  results.push(check('HUD 显示“已丢失”状态', badgeLost === '已丢失', { badgeLost }));
  results.push(
    check('丢失后资源包装仍登记（仅释放 GL 句柄）', registryLost === registryBefore, { registryLost, registryBefore }),
  );

  // Frames must not advance while lost.
  const fLost1 = await evaluate(client, sessionId, `${HANDLE}.getFrameCount()`);
  await waitForFrames(client, sessionId, 5);
  const fLost2 = await evaluate(client, sessionId, `${HANDLE}.getFrameCount()`);
  results.push(check('丢失期间帧计数冻结', fLost2 === fLost1, { fLost1, fLost2 }));

  // 6. Restore: resources rebuild, loop resumes, drawing works again.
  await evaluate(client, sessionId, `${HANDLE}.restoreContext()`);
  const stateRestored = await evaluate(client, sessionId, `${HANDLE}.getContextState()`);
  const loopRestored = await evaluate(client, sessionId, `${HANDLE}.getLoopRunning()`);
  const registryRestored = await evaluate(client, sessionId, `${HANDLE}.getRegistrySize()`);
  results.push(check('webglcontextrestored 后状态恢复 healthy', stateRestored === 'healthy', { stateRestored }));
  const badgeHealthy = await evaluate(
    client,
    sessionId,
    `document.querySelector('#hud .badge').textContent`,
  );
  results.push(check('HUD 恢复显示“正常”状态', badgeHealthy === '正常', { badgeHealthy }));
  results.push(check('恢复后渲染循环自动继续', loopRestored === true, { loopRestored }));
  results.push(
    check('恢复后资源数量一致（全部重建）', registryRestored === registryBefore, { registryRestored, registryBefore }),
  );

  const fR1 = await evaluate(client, sessionId, `${HANDLE}.getFrameCount()`);
  await waitForFrames(client, sessionId, 5);
  const fR2 = await evaluate(client, sessionId, `${HANDLE}.getFrameCount()`);
  results.push(check('恢复后帧计数重新推进', fR2 > fR1, { fR1, fR2 }));

  const pixel = await evaluate(client, sessionId, `${HANDLE}.readCenterPixel()`);
  const pixelOk = Array.isArray(pixel) && pixel[3] === 255 && Math.abs(pixel[0] - 128) <= 2 && Math.abs(pixel[1] - 128) <= 2 && pixel[2] >= 100 && pixel[2] <= 155;
  results.push(check('恢复后重建的 program 可正常渲染', pixelOk, pixel));

  // 7. Canvas sizing still consistent after the loss/restore cycle.
  const size = await getSize(client, sessionId);
  results.push(
    check('恢复后缓冲尺寸与 CSS 尺寸仍一致', size.bufferWidth === size.cssWidth && size.bufferHeight === size.cssHeight, size),
  );

  // 8. No uncaught exceptions anywhere in the sequence.
  const errors = diag.errors();
  results.push(check('全程无未捕获异常', errors.length === 0, errors));

  return results;
}
