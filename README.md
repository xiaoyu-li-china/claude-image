# 体积云渲染器 — 基础工程层

仅使用**原生 WebGL2 + GLSL ES 3.00 + TypeScript（strict）+ Vite** 搭建的渲染器基础层。
不依赖 Three.js / Babylon.js / CesiumJS 等任何 3D 引擎或现成云渲染库，不使用 Docker。

本仓库当前只包含**工程基础层**：可 resize 的画布、GL 资源/上下文管理、数学库与自测、
画质配置体系。**尚未实现** raymarching、噪声纹理、阴影——这些是后续轮次的工作，
当前代码中没有任何对应 stub 或 TODO 占位。

---

## 快速开始

```bash
npm install
npm run dev          # 开发服务器 http://localhost:5173
npm run build        # tsc --noEmit 严格类型检查 + vite 生产构建
npm run preview      # 预览生产构建（绑定 127.0.0.1:4173）
npm run test:headless # 构建 + 无头 Chromium 全量自动化验证（97 项断言）
npm run gen:quality-doc # 从单一数据源重新生成 docs/quality-presets.md
```

无头验证不依赖任何 npm 第三方包：通过 Node 24 内置 WebSocket 直连 Chrome DevTools
Protocol，驱动本机 Playwright 缓存中的 Chrome for Testing 完成真实浏览器验证。

---

## 目录结构与模块职责

```
claude-image/
├── index.html                  # 入口页面：canvas + HUD 容器 + 自测结果 JSON 岛
├── vite.config.ts              # Vite 配置（dev 5173 / preview 127.0.0.1:4173）
├── tsconfig.json               # strict: true，禁止 any 逃逸（见下节）
├── src/
│   ├── main.ts                 # 应用装配：canvas/上下文/resize/渲染循环/测试句柄
│   ├── env.d.ts                # window.__APP_TEST_HANDLE__ 的严格类型声明
│   ├── styles.css              # HUD 与全屏 canvas 样式
│   ├── render/
│   │   ├── canvas-sizer.ts     # CanvasSizer：CSS 尺寸 × DPR × 渲染缩放 → 绘图缓冲
│   │   └── renderer.ts         # Renderer：全屏三角形渐变（仅用于驱动 GL 层）
│   ├── gl/
│   │   ├── context.ts          # GLContext：WebGL2 上下文、丢失/恢复状态机、渲染循环
│   │   ├── shader.ts           # GLProgram：编译/链接封装与详细诊断错误
│   │   ├── resources.ts        # GLBuffer / GLVertexArray / GLTexture2D / 资源注册表
│   │   ├── errors.ts           # ShaderCompileError / ProgramLinkError 等错误类型
│   │   └── index.ts            # 桶导出
│   ├── math/
│   │   ├── vec3.ts             # vec3：加/减/缩放/点积/叉积/归一化（不可变风格）
│   │   ├── mat4.ts             # mat4：列主序、perspective、inversePerspective、lookAt、inverse
│   │   ├── self-test.ts        # 四项数学自测（固定容差，不弱化断言）
│   │   └── index.ts
│   ├── config/
│   │   ├── quality-presets.json # ★ 画质参数单一数据源（唯一可写具体数值的地方）
│   │   └── quality.ts          # 配置导入、结构校验、运行时合法性断言
│   └── ui/
│       └── hud.ts              # HUD：上下文状态/尺寸/档位/自测结果/错误提示
├── docs/
│   └── quality-presets.md      # 由 JSON 自动生成的档位文档（请勿手改）
└── scripts/                    # 零第三方依赖的 Node 验证工具链
    ├── headless-test.mjs       # 测试总入口（先 build 再起 preview + 无头浏览器）
    ├── cdp-client.mjs          # 极简 CDP 客户端（内置 WebSocket，flat session）
    ├── browser-launch.mjs      # 查找并启动本机 Chrome for Testing
    ├── test-utils.mjs          # 断言/视口模拟/页面诊断收集
    ├── gen-quality-doc.mjs     # 画质文档生成器
    ├── screenshot.mjs          # 真实浏览器截图（人工可视化复核）
    └── tests/
        ├── doc-consistency.mjs   # 文档与 JSON 一致性 + 硬编码守卫（Node 侧，5 项）
        ├── stage1-skeleton.mjs   # resize/DPR/缓冲一致性（9 项）
        ├── stage2-gl-tools.mjs   # 着色器诊断/dispose/上下文丢失恢复（25 项）
        ├── stage3-math.mjs       # 数学自测可见性与强度（24 项）
        └── stage4-quality.mjs    # 配置单一数据源/校验/注入（34 项）
```

### TypeScript 严格度

`tsconfig.json` 开启 `strict`、`noImplicitAny`、`noUncheckedIndexedAccess`、
`exactOptionalPropertyTypes`、`noUnusedLocals/Parameters` 等；`npm run build` 会先跑
`tsc --noEmit`，类型不过则构建失败。全仓库无 `any`。

---

## WebGL 上下文丢失 / 恢复策略

`GLContext`（`src/gl/context.ts`）实现 `healthy → lost → restoring → healthy` 状态机
（重建失败进入 `failed`）：

1. **丢失时（`webglcontextlost`）**
   - `event.preventDefault()`，允许浏览器后续恢复；
   - 立即停止渲染循环（帧计数冻结，无头测试验证丢失期间不产帧）；
   - 调用 `ResourceRegistry.invalidateAll()`：所有资源包装**只释放 JS 句柄**，
     不向已失效的上下文发 `gl.delete*` 调用；包装对象仍保留在注册表中；
   - HUD 状态徽标切换为“已丢失”。
2. **恢复时（`webglcontextrestored`）**
   - 重新获取扩展（如 `WEBGL_lose_context`，旧扩展对象随丢失失效）；
   - `ResourceRegistry.rebuildAll()` 逐个重建：shader 重新编译、program 重新链接、
     buffer/texture 用构造时保留的源数据重新上传、VAO 重新绑定；
   - 成功后状态回到 `healthy` 并自动重启渲染循环；失败则进入 `failed` 并显示原因。
3. **资源生命周期**
   - 所有 GL 对象经 `GLBuffer/GLVertexArray/GLTexture2D/GLProgram` 创建即登记；
   - `dispose()` 幂等：重复调用不报错，存活上下文下调真实 `gl.delete*`
     （无头测试用 `gl.isBuffer/isTexture` 确认驱动层删除），并从注册表摘除。
4. 页面 HUD 的“GL 上下文”区域实时显示四种状态；“模拟上下文丢失 / 请求恢复”按钮
   通过 `WEBGL_lose_context` 扩展触发真实的丢失/恢复事件，可手工演练整条链路。

---

## 画质配置：单一数据源约定

**唯一数据源是 `src/config/quality-presets.json`**，定义 smooth / balanced / ultra
三档的 `raymarchSteps`（正整数）与 `resolutionScale`（∈ (0,1]）。

- **UI 不硬编码**：HUD 下拉框由 `listQualityPresets()` 从同一 JSON 动态生成；
- **渲染不硬编码**：切换档位时经 `getQualityPreset()` 读取，校验通过后注入
  `CanvasSizer.setRenderScale()`（决定绘图缓冲尺寸）与 `Renderer.setPreset()`
  （后续 raymarching 步进数的注入通道）；
- **文档不硬编码**：`docs/quality-presets.md` 由 `npm run gen:quality-doc` 生成；
- **守卫**：`scripts/tests/doc-consistency.mjs` 扫描 `src/` 下除配置层外的源码，
  出现 `"smooth"/"balanced"/"ultra"` 字面量即测试失败，防止第二处硬编码出现。

校验规则（`src/config/quality.ts`）：

- 模块加载时对整份 JSON 做结构校验，配置损坏则快速失败；
- 每次切换档位调用 `assertLegalPreset()`：步进数必须是正整数（拒绝 0、负数、小数、
  字符串），缩放必须是 (0,1] 内有限数（拒绝 0、负数、>1、字符串、null 对象）；
- 非法配置抛出 `QualityConfigError`，消息逐字段可读；UI 捕获后显示错误并**保持原档位
  不变**，不会让应用进入未定义状态。

当前生效档位与参数（步进数、缩放、实际缓冲像素数）实时显示在 HUD“画质档位”区域。

---

## 数学库与自测

`src/math/` 提供列主序 `mat4`（number[16]，float64 运算，上传 GL 时转 Float32Array）
与不可变风格 `vec3`。`inversePerspective()` 是 `perspective()` 的解析逆，
另提供 Gauss-Jordan 通用 `inverse()` 供交叉验证。

四项必测用例（`src/math/self-test.ts`，页面加载即自动运行，HUD 与浏览器控制台可见，
也可点“运行自测”重跑；结果同时写入页面 `#test-results` JSON 岛供自动化读取）：

| 用例 id | 覆盖内容 | 容差 |
| --- | --- | --- |
| `identity` | I·I=I、单位矩阵对点变换恒等、对角/零位结构检查 | 1e-12 |
| `perspective-roundtrip` | inversePerspective·perspective = I，且解析逆与通用 inverse 逐项一致 | 1e-10 |
| `lookat-orthogonality` | 相机三轴单位长度、两两垂直、右手系（RᵀR=I）、eye→原点/target→-z 落点 | 1e-10 |
| `unproject-ndc` | 12 个采样点（含近/远平面 NDC 四角）投影→NDC→逆投影完整还原 | 1e-9 |

断言不允许弱化：每个用例输出实际观测最大误差与固定容差，误差超差即 FAIL；
测试同时校验容差本身不得宽于 1e-9。

### 自测运行方式

```bash
# 方式一：浏览器打开页面，HUD“自测结果”区域与 DevTools 控制台直接可见
npm run dev

# 方式二：无头自动化（含数学自测在内的全部 97 项断言）
npm run test:headless
```

---

## 画布 resize / DPR 保证

`CanvasSizer` 保证任意时刻
`canvas.width === round(cssWidth × dpr × resolutionScale)`（高同理），
CSS 始终把完整缓冲拉伸到元素尺寸，因此内部缩放只改变渲染像素数、不会造成画面变形：

- `ResizeObserver` 监听布局变化，连续触发的回调经 rAF 合流，每帧最多重分配一次缓冲；
- `matchMedia('(resolution: <dpr>dppx)')` 监听 devicePixelRatio 变化（跨屏拖动、缩放），
  变化后重建监听并同步缓冲；
- 所有尺寸在 HUD 可见，无头测试覆盖 dpr=1/1.5/2、20 连发放大 resize、分数 DPR 取整。
