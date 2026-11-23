# AU05 面板：组件级视觉验收

## 结论与边界

本次参考 [unslop](https://github.com/heydamir/unslop)（Damir Sokolovsky / @heydamir）的审查与克制优化思路，自行实现 AU05 面板的布局、控件层级和冗余文案调整，不引入运行时依赖。组件级前后截图对比通过；**真实 DSH 宿主内的视觉验收尚未完成**。

截图由真实生产 `productView` 与 `panelCss` 在 React 18.3.1 / Chromium 156.0.8078.80 中渲染，不是设计稿。主题变量、会话和设备状态由隔离 fixture 提供，并非从真实宿主采集。仅向模块导出临时增加视图入口，不运行插件 `apply` 或控制器；未连接设备、录音、发送系统快捷键或操作真实审批，未安装或重启插件。

宿主重启后，对现有 GUI 的只读请求仍返回 HTTP 401。没有绕过认证或另起替代服务，因此这里不声称已验证宿主主题、外层布局或插件热更新效果。

## 控件顺序修正

首轮截图验收漏掉了实体位置与说明顺序的对应：设备旋钮在上方，说明却把旋钮排在最后。现已按实体从上到下改为 **旋钮 → 按键1 · 麦克风 → 按键2 → 按键3**。仅改变说明列表的一行排序，不改变按键功能、灯光通道索引或设备示意图。

- 修正对比：[桌面](<visual/au05-panel/order-desktop.png>)、[320px 窄屏](<visual/au05-panel/order-narrow.png>)。左侧为修正前，右侧为修正后；已目视核对默认、Studio、Windows 语音与自定义快捷键截图。
- `npm run build:plugin` 及相关五个测试文件 144/144 通过。[本次测试日志](<visual/au05-panel/order-focused-test.log>)。本次未重跑完整回归，首轮完整回归的缺失 Hooks 模块问题仍记录在下方。
- 修正前后各 16 个隔离浏览器场景通过。新增 DOM 阅读顺序、可见列表顺序与 SVG 控件实际纵向顺序一致的断言；既有灯光通道、焦点、溢出和安全提醒回归保持通过。验证的是从上到下的顺序，不声称说明与实体中心逐像素对齐。
- [修正前记录](<visual/au05-panel/order-before-results.json>)、[修正后记录](<visual/au05-panel/order-after-results.json>)；当前源码 SHA-256：`9cf3f672f50cc9c9c0fed5e5fdeffd10bd7bc345b1a7b01a7d92adf0b8e65746`。
- 本次原始截图在本地 `Temp/au05-unslop/before-order` 与 `Temp/au05-unslop/after-order`；仍为组件级验证，未安装或重启插件，未完成真实宿主内验收。

## 首轮布局优化记录（顺序修正前）

以下三张图片保留首轮历史记录，右侧仍包含后来修正的控件顺序问题。均为原尺寸截图并排组合，左侧优化前，右侧首轮优化后，不缩放面板。

- [桌面面板对比](<visual/au05-panel/compare-desktop.png>)
- [320px 窄屏对比](<visual/au05-panel/compare-narrow.png>)
- [展开设置对比](<visual/au05-panel/compare-settings.png>)

| 检查项 | 优化前 | 优化后 |
| --- | --- | --- |
| 320px 窗口中的连接/断开按钮 | 断开按钮另起一行 | 两个按钮保持同排 |
| 320px 默认面板高度 | 569.20px | 533.20px，减少 36px |
| 桌面默认面板高度 | 568.52px | 570.52px，基本不变 |
| 设置区域 | 操作与下一字段衔接拥挤 | 标签与输入对齐，操作归属清楚 |
| 布局和主题 | 保留 | 原信息架构、设备示意图和主题令牌保留 |

统一了按钮、输入框、焦点样式和间距；仅删除重复的连接状态前缀与旋钮说明前缀。没有改动设备控制、语音、审批、会话作用域或灯光验证逻辑。

## 验证结果

- `npm run build:plugin`：通过。
- 相关五个测试文件：144/144 通过，包含新增的控件分组、状态可访问名称和 Escape 焦点返回回归。
- `npm test`：重新运行已结束，退出码 1；691 项中 683 通过、7 失败、1 跳过。7 个失败文件都是通用 Hooks 测试，因当前仓库缺少 `packages/dsh-hooks` 下的模块而在导入阶段失败（`ENOENT` / `ERR_MODULE_NOT_FOUND`），不是 AU05 面板断言失败。该目录不在本次改动范围内，未删除或跳过这些测试，也未创建占位模块。[完整回归日志](<visual/au05-panel/full-test.log>)。
- 前后各 16 个真实浏览器场景通过；未出现浏览器运行错误或面板横向溢出。优化后连接按钮同排、可见字段关联和对齐均有断言。
- 默认及展开设置、展开高级设置后均重新测量。关闭的 `details` 内字段不计入可见字段；展开后明确断言三个字段均实际参与测量，避免隐藏元素零尺寸造成误判。
- 每个场景检查打开后的面板焦点、Escape 关闭并返回胶囊、Enter 重开、Tab 到收起按钮和可见焦点。浏览设置只允许模拟的麦克风列表刷新，不允许控制器操作。

场景覆盖：1440×900 桌面亮/暗主题、320×720 窄屏、480×900 / 320×900 展开设置、自定义快捷键、准备采集/录音/转写、连接失败、转写冲突、连接中、Windows 语音已请求、应用快捷键已请求、Studio 桥监听及 480×360 短窗口。

已目视检查桌面、窄屏和设置的前后对比，以及优化后的深色、错误、冲突、自定义快捷键、Studio、准备采集、Windows 语音、连接中和短窗口截图；未发现控件裁切、字段错位或必要提示遗漏。状态仅为测试输入，不代表实际设备或录音状态。

补充截图：[窄屏设置与高级设置](<visual/au05-panel/narrow-settings-scrolled.png>)、[深色面板](<visual/au05-panel/dark-panel.png>)、[错误提示](<visual/au05-panel/error-panel.png>)、[短窗口滚动到底部](<visual/au05-panel/short-scrolled.png>)。

## 可核验记录

- [优化前测量记录](<visual/au05-panel/before-results.json>)
- [优化后测量记录](<visual/au05-panel/after-results.json>)
- 优化前源码 SHA-256：`9bb6ba25175ed7aadeede88bd1d1229b8db2aabd2326cb3d5df7dd7322c0c170`
- 优化后源码 SHA-256：`c5519c68574dcf511e13bb1ef21533535ffcc22cca3d274d2bc84bf940cdcc64`
- 两组 fixture SHA-256 相同：`a1bb1cf871b1a2cf1118306b0a3073a28caca0630d5e4405370679c3a1f305e6`

[浏览器检查脚本](<../scripts/au05-visual-check.mjs>)和[隔离 fixture](<../test/fixtures/au05-panel-browser.js>)不进入生产依赖。运行需要已安装的 Playwright Node 驱动与 Chrome；可用 `PLAYWRIGHT_MODULE` 指向已有驱动。脚本首次运行会把固定版本的 React / ReactDOM UMD 下载到临时 vendor 目录，不安装项目依赖。

在仓库根目录运行（Bash；已存在可解析的 Playwright，或已设置上述环境变量）：

```bash
node scripts/au05-visual-check.mjs --out Temp/au05-unslop/after --verify-layout
```

若保留本次本地优化前快照，可重现前后对比：

```bash
node scripts/au05-visual-check.mjs --source Temp/au05-unslop/client.before.js --out Temp/au05-unslop/before
node scripts/au05-visual-check.mjs --out Temp/au05-unslop/after --verify-layout --compare-with Temp/au05-unslop/before
```

完整原始截图和优化前快照保留在本地临时目录；本报告附精选证据，不把旧源码复制进生产目录。后续宿主内验收仍需在已认证页面核对实际主题、顶栏避让、窄屏、焦点和真实插件加载结果。
