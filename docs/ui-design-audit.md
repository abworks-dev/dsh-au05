# AU05 UI 规范化审查

## 范围及依据

本轮针对 AU05 插件面板，不重设计宿主 GUI，不连接设备、不录音、不发送系统快捷键、不安装或重启设备插件。

用户选择：根目录 DESIGN.md；共用 UI 位于 packages/dsh-plugin/src/ui，继续嵌入原有单文件插件；克制、紧凑、宿主主题、系统字体、无装饰文案。

审查方法：Impeccable audit/layout/extract/document、独立只读布局审查、现有源码与隔离浏览器截图。历史 docs/visual/au05-panel 截图绑定旧 SHA，不能冒充本轮当前宿主验收。重新采集的改前截图使用保留源码 Temp/ui-system/client.before.js 和合成 controller。

## 改前发现

| 优先级 | 证据与影响 | 本轮处理 |
| --- | --- | --- |
| P1 | 缺少设计规范和增量开发入口；源码字段排版重复，下一次加功能可绕过布局规则 | 固化 DESIGN.md、AGENTS.md，并抽取四处相同字段与共享样式 |
| P1 | 既有视觉脚本保存截图但无像素比较门禁；新版浮动面板绝对定位，root 的 tight crop 只拍到胶囊 | 采用官方 Playwright toHaveScreenshot；直接拍真实 panel；保留独立键盘、溢出和副作用断言 |
| P2 | 跨应用听写开关使用未定义 au05-toggle，未复用统一开关行高/间距 | 改用 au05-switch；不改事件、值或风险文案 |
| P2 | 映射前条件状态、每键配置证据持续增高；长冲突文本会推远后续操作 | 规范默认区信息预算与功能归属；不在本轮擅自迁移状态或截断转写。长文本、贴边、200% 缩放仍须专项验证 |

没有发现需要整页换风格的证据。现有连接同行、语音选择、实体图加映射、原生折叠设置具备可延续的结构。

## 改前质量评分（0–4，非认证）

- 可访问性 **2/4**：原生标签、焦点环、Escape 返焦及 reduced-motion 有实现和隔离断言；未完成屏幕阅读器/触屏/完整对比度实测。
- 性能 **3/4**：轻量原生 DOM、系统字体、内联 SVG；未做宿主性能剖析。
- 主题 **3/4**：大多使用宿主 alias，插图固定色具明确语义；未逐一验证真实宿主全部主题。
- 响应式 **2/4**：有 320px、短窗口、字段对齐的自动断言；长内容、放大、四边停靠仍有证据缺口。
- 一致性 **1/4**：已有可复用视觉节奏，但没有持续规范、共享源及像素门禁；本轮以此为重点。

## 布局决策

- 阅读顺序、实体映射顺序、现有文案、风险、状态语义保持不变，不新增界面说明、卡片或标题。
- 抽取是保形重构：共用工厂返回原生 DOM，保留 label/id、data 标记、事件和焦点；UI 源不调用 controller。
- 使用 4/8/12/16px 节奏、32/36px 控件、72/64px 字段标签列和宿主色；不引入第二套主题。
- 不把“已发送快捷键”当作录音，不把回读当作实体亮灯，不把桥监听当作设备已连接。
- UNSLOP 不作为每轮功能开发后的全页重写；先检查规范和差异，再做必要局部修饰。

## Skill 安装与安全边界

本项目安装 Impeccable 4.8.0，配套 Windows engine v0.1.18，位置为 `.dsh/skills/impeccable`。未安装自动 hook，未安装或重启 AU05/DSH 设备插件。引擎二进制已忽略，不应提交到仓库。

复现安装：

```powershell
$env:IMPECCABLE_LIVE_COPY_AGENT='off'
npm exec --yes --package=impeccable@4.8.0 -- impeccable install --providers=dsh --project --no-hooks --yes
```

不启用 Live Apply 的外部代理自动执行回退，不让审美工具代替项目的权限与设备副作用约束。源扫描只能作为辅助；本轮最终 `detect --json packages/dsh-plugin/src/ui packages/dsh-plugin/client.js` 返回空数组，不证明浏览器无问题或已完成视觉验收。

## 持续验收

运行方式及基线环境见 [视觉回归说明](./ui-visual-regression.md)。行为通过、隔离截图通过、真实宿主验收三者分别报告。未经授权不操作真实设备补齐证据。

### 本轮验证结果

- `npm run build:plugin` 及生成物 `--check` 通过；相关 UI、capsule、客户端测试 230 项通过。
- 官方 Playwright 比较 34 项通过（32 个面板场景、另 2 个 capsule 用例）；102 张 Windows 基线。布局断言覆盖 32 场景、11 输入步骤、14 次合成状态发布，无错误。
- 负例注入洋红背景，官方截图比较确实失败：223603 像素（18%）不同；全部 102 张基线哈希未变，证明不会以自动更新掩盖变化。
- 抽取前后源码在同一当前 fixture 下重采 desktop/narrow/dark/settings/narrow-settings/error/short，7 个完整视口 PNG 哈希一致。已目视检查窄屏、暗色、错误、设置滚动及短窗口的隔离组件截图，不是实际宿主截图。
- 全量 `npm test`：851 项，840 通过、10 失败、1 跳过，**并非全绿**。7 项因现有 `packages/dsh-hooks` 模块缺失；另 3 项为 `test/plugin.test.js` 的 `2 !== 1` 和 `test/studio-action-integration.test.js` 的两处 `one scheduled action poll`。用本轮改前保留 client 替换 UI 源重跑这两个测试文件，复现同样 3 处失败（1 通过、3 失败），不归因于本轮 UI 抽取，未越界修改这些业务逻辑。
- 未运行 GitHub 远端 CI；Windows 2022 与本机 Windows 的首轮差异须人工审查。未验收真实宿主、真实设备、屏幕阅读器或 200% 缩放。
