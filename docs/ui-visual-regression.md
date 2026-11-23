# AU05 视觉回归

## 运行

在仓库根目录运行（Windows，Node 24.22.1）：

```powershell
npm ci
npx playwright install chromium
npm run build:plugin
npm run test:visual
npm run test:visual:negative
npm run test:visual:layout -- --out test-results/layout
```

- `test:visual` 使用官方 `@playwright/test` 的 `expect(...).toHaveScreenshot()` 比较已提交 PNG。默认 `updateSnapshots: 'none'`：缺图或不同均失败，绝不自动补图。没有自制截图 diff。
- `test:visual:negative` 仅在独立浏览器 fixture 注入洋红面板，要求官方比较失败、输出 diff，并校验全部基线 SHA-256 未变。命令本身在证明完成后成功退出；其浏览器子测试预期失败，不是产品失败。再次运行 `test:visual` 可恢复正常报告。
- `test:visual:layout` 复用原有脚本，检查布局溢出、字段关联、键盘焦点、Escape/Tab、输入回显、无设备操作，并导出人工查阅截图和 JSON。
- `npm run test:visual:preflight` 可在其他平台运行隔离行为和溢出预检，**不调用截图断言，不生成基线，不能算像素比较通过**。本机无浏览器时先执行 `npx playwright install chromium`。
- 无需启动 GUI、HTTP 服务器或插件。不会连接真实 DSH 页面、宿主 RPC、设备或麦克风。

## 固定环境与证据边界

| 项目 | 固定值 |
| --- | --- |
| Playwright Test / Chromium revision | 1.58.2 / 1208 |
| Chromium 版本（测试中断言） | 145.0.7632.6 |
| React / ReactDOM | 18.3.1 / 18.3.1，来自 npm 锁文件 |
| 字体 | `@fontsource/noto-sans-sc` 5.3.1，简体中文 WOFF2，400/600 |
| 截图平台项目 | `chromium-win32`；拒绝用 Linux 覆写 Windows 基线 |
| CI | `windows-2022`，Node 24.22.1，`npm ci` |
| 缩放、语言、时间 | DPR 1，zh-CN，UTC，固定 Date |
| 动画、光标 | reduced-motion，截图禁用动画、隐藏光标 |
| 比较 | 官方默认感知阈值 0.2，允许不同像素 0 |

字体通过本地数据 URI 内嵌，网络全部拦截。fixture 额外拒绝 fetch/WebSocket/EventSource、媒体和设备 API；控制器是合成快照，真实组件不变，仅导出 view 供测试。共用组件、样式仍来自构建后的客户端，不复制 UI 实现。输入回显不模拟实体按键、审批或录音。

本机 Windows 与 GitHub `windows-2022` 并非同一 OS 镜像。固定浏览器与字体降低差异，但不能保证系统渲染逐像素等同；首次 CI 必须复核失败的 actual/diff，不得通过放宽阈值或无差别重录掩盖差异。浏览器、字体、React 升级需独立审阅。依赖精确版本与完整性由根锁文件记录。

Linux 方案暂未启用：本机 Docker daemon 不可用，未启动它，也未伪造 Linux goldens。后续如采用 `mcr.microsoft.com/playwright:v1.58.2-noble`，应增加独立平台项目并在该环境重新审阅基线，不能重命名 Windows PNG 冒充。

## 覆盖

共享场景矩阵来自[共享 harness](<../test/fixtures/au05-visual-harness.mjs>)：桌面、320px、暗色、设置、自定义快捷键、展开高级设置、错误与冲突、准备采集/录音/转写、连接中、Windows/外部听写请求、Studio、360px 短窗口、灯光回读及实体输入的合成回显。每个检查点分别截 viewport 和真实 `[data-au05-panel]`，不再对只包住胶囊的根节点裁剪。设置在顶部和高级区域滚动位置分别拍摄；短窗口不使用 fullPage，保留实际可见和滚动边界。

隔离截图不是当前宿主页面验收，也不是物理设备、灯光、声音或隐私权限验收。`--vendor` 仅供原脚本兼容已有离线 React 文件；官方比较套件始终使用锁定 npm 运行时，不下载 CDN 内容。

## 有意变更与基线审阅

1. 先构建并执行 `npm run test:visual`，保留失败证据。
2. 运行结束后打开生成的官方 HTML 报告（`playwright-report/index.html`，构建产物，未入库）；在 `test-results/au05-visual/` 核对 expected、actual、diff，确认原因来自有意 UI 改动而非环境漂移。
3. 只有人工确认后，按测试名更新指定场景，例如：

   ```powershell
   npm run test:visual -- --grep 'narrow-settings$' --update-snapshots=changed
   ```

   首次添加新场景使用同样范围配合 `--update-snapshots=all`。不要为了变绿重录全部基线。
4. 审阅 `test/visual/__screenshots__/chromium-win32/` 的 PNG 差异，记录变更原因，再运行完整比较、负例和布局检查。
5. 将审核过的 PNG 和对应代码一起提交。CI 只比较，不更新；配置显式拒绝 CI 中的 `--update-snapshots`。失败时上传官方报告、diff、trace 和布局证据，保留 14 天。

报告目录和临时结果已加入忽略列表，goldens 不在忽略列表内。
