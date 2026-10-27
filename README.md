# DSH AU05

**DSH 官方格式插件 ⇄ Windows 本机 HID 桥 ⇄ Ulanzi AU05 / VibeKey** 的开源方案与 mock-first 骨架。

> 当前是 **只读验证与原型阶段，不是可直接控制 AU05 的驱动发布版**。已实现官方格式只读插件、模拟桥、输入解码和 Windows 只读 HID 诊断；本机 DSH 真实运行库的离线渲染/卸载检查已通过。三键与旋钮六类输入报告已在 Windows 真机观察到；物理动作精确计数、真实 GUI 安装与端到端集成仍待验收，灯控及实际审批均未启用。不要据此购买设备或替换生产工作流。

## 为什么分三层

```text
DSH Web / Electron
  官方 Cordis 客户端插件：选中会话、状态、审批 UI、输入框
        ⇅ loopback HTTP + Bearer + fetch SSE（拟接入）
本机桥：认证、独占租约、事件规范化、有限状态灯映射
        ⇅ Windows vendor HID（独立只读诊断已验；生产桥接待实现）
AU05 USB 接收器（发射器本体通过 2.4 GHz 连接）
```

- DSH 插件做“语义”：到底哪个会话在工作、当前审批是不是仍有效。
- 桥做“硬件”：枚举正确 HID collection、处理断线、收包和受限灯控；不读取对话，不运行 shell，不替 DSH 做权限判定。
- **不依赖另一个 Ulanzi Studio 插件，也不要求向优篮子提交仓库或上架。** 这是独立桥路线；不承诺与 Studio 同时占用设备。Studio 路线是另一种架构。
- 使用官方 `package.json` 的 `dsh.bundle` / `dsh.client` 与 Cordis patch；不虚构 `dsh-plugin.json`、外部 npm SDK 或权限 manifest。
- 本项目独立于 Ulanzi、DeepSeek、OpenAI；不含其商标图标、私有 SDK 或固件。

## 目录结构

```text
dsh-au05/
├── packages/
│   ├── dsh-plugin/          官方 bundle：package.json / index.js / client.js / cordis.patch.yml
│   └── core/               原创会话租约、快照、意图票据策略模型
├── apps/bridge/            Node 22+ 本机模拟 HTTP/SSE 桥；不含真实 HID 后端
├── scripts/                mock 演示、只读 HID 诊断、DSH 离线 runtime 验证与结构检查
├── test/                   核心策略、桥安全、输入协议、只读安全及插件测试
├── docs/
│   ├── architecture.md     组件、状态、按键语义、多会话决策
│   ├── dsh-plugin.md       官方插件格式、真实 API、安装/卸载边界
│   ├── protocol.md         本机通信契约、租约、重放与错误
│   ├── hardware.md         Windows HID 实现路线、协议证据、灯控限制
│   ├── security.md         信任边界、风险与发布前闸门
│   ├── validation.md       验证记录、人工硬件/GUI 验收清单
│   ├── roadmap.md          分阶段实施与退出标准
│   └── sources.md          固定版本来源、采集方式与许可证台账
├── .github/workflows/ci.yml
├── LICENSE                 本项目原创部分 MIT
└── THIRD_PARTY_NOTICES.md   参考资料和许可边界；不包含第三方实现
```

## 可运行的部分

需要 Node.js 22 或 24；目前无运行时第三方依赖，不需要管理员权限。

```bash
npm test
npm run check
npm run demo
```

演示会在进程内随机端口启动模拟桥，产生一个 `allow_once` **模拟意图**，返回 `executed: false` 后退出。不连接 DSH，不访问 HID，不执行工具或审批。

可单独运行 mock 桥：

```bash
npm run bridge:mock
```

默认仅绑定 `127.0.0.1:17375`。每次启动生成令牌写入被 Git 忽略的 `.local/bridge-token`，不回显令牌。默认允许 Origin 为示例 `http://127.0.0.1:3080`，**并不自动发现你当前 DSH 的端口**。用环境变量 `AU05_ORIGINS` 设置精确的本机 Origin（多个逗号分隔），`AU05_PORT` 改端口。浏览器连接插件尚未实现，现有插件只显示状态。Windows 的文件 `mode: 0600` 不等于已设置用户 ACL；当前令牌文件只适合受控开发环境。

## 官方格式插件

[插件包](packages/dsh-plugin/README.md) 的只读装饰显示当前 composer 所绑定会话的 `running` / `pendingInteraction`，没有 HID/网络/审批副作用。官方源码基线：`deepseek-ai/deepseek-harness@22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。创建仓库时没有修改 DSH 安装目录、用户 profile 或安装插件。

本机 DSH `0.2.1-rc.3` 的真实 loader、Cordis、React、renderer 已在隔离离线页面通过 **13 项断言**，详见 [runtime 验证](docs/plugin-runtime-validation.md)。会话数据仍为合成 fixture，真实 GUI/profile 安装、CSP/CORS 与跨进程桥接 **待验收**，不能把离线检查冒充 GUI 兼容认证。官方格式与后续接入方式见 [DSH 说明](docs/dsh-plugin.md)。

## Windows 只读输入诊断

要求 Windows、PowerShell 7 / .NET 6+；不需要 npm 原生 HID 依赖。

```bash
npm run hid:selftest
npm run hid:list
npm run hid:capture -- -Seconds 30
```

`selftest` 不接触设备；`list` 只查本地身份/caps；`capture` 只读精确 vendor collection，限时结束并输出脱敏白名单事件报告计数。**不会发送初始化、心跳、灯控、映射或 Feature/Output 报告**；不会监听其他键盘、注入按键或回答 DSH 审批。是否能收到事件必须实测，不能用合成协议包代替真机验收。运行前阅读 [只读验证记录与操作边界](docs/readonly-validation.md)。

## 目标与非目标

第一目标：明确选中一个会话后，提供三键、旋钮输入与可信的“运行/待确认/未知”反馈。**审批默认关闭**，之后也只支持当前可回答请求的一次允许/拒绝，不做永久放行。

首版排除：麦克风采集/ASR、全局任意按键监听、任意 HID 包、固件更新、设备重置、全自动审批、跨用户控制、Studio 插件、托盘自启动安装器。USB 音频端点与 HID 桥是两回事。

阅读顺序：[完整架构](docs/architecture.md) → [硬件与能力闸门](docs/hardware.md) → [安全](docs/security.md) → [实施路线](docs/roadmap.md)。

## 开发与发布

本仓库是设计与只读实验交付，不提供未经验证的可执行驱动下载。提交前运行测试与检查，不提交 `.local/`、token、真实会话 ID、设备序列号、原始键盘日志或抓到的私人对话。GitHub Actions 在 Windows / Linux、Node 22 / 24 上执行测试；本地通过不代表远端 CI 已通过。

- [验证记录与验收](docs/validation.md)
- [安全报告方式](SECURITY.md)
- [资料与许可](docs/sources.md)

许可：原创代码与文档采用 [MIT](LICENSE)。未复制 VibeWand、未捆绑无明确授权的社区协议实现，不宣称法律意义上的隔离 clean-room。
