# 来源与许可证台账

**采集日期**：2026-10-27。**执行后端**：agent-reach GitHub 路由，`gh api` 与定向 HTTPS/raw 阅读，DSH/硬件两路只读核查；先前检索 Exa 限流后使用网页后端，不能把搜索摘要当正文。**执行查询数**：本仓库实现阶段主代理新增关键词搜索 0；两路源码核查的完整请求计数未保留，不伪造可复现的总数。下面是实际取得的固定源码入口，可重新抓取复核。未下载/运行第三方驱动，未操作实体硬件。

复现示例：`gh api repos/deepseek-ai/deepseek-harness/commits/22ddee3792402c3e70ec5f86a63c3e3e895a2f60`；源码可用 `gh api repos/OWNER/REPO/contents/PATH?ref=COMMIT` 或对应 raw URL 阅读。涉及真实会话/凭据的内容不进本仓库。

## DSH：官方源码固定基线

commit：`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。以下均取到于 2026-10-27；官方源码是该快照契约证据，不等于本机安装版本/GUI 已验收。

| 来源 | 用途 |
|---|---|
| [官方 decoration 模板](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration) | Host apply、Cordis patch、lazy client table 的规范形状 |
| [插件开发说明](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md) | plugin manager install_bundle，不手工改 profile |
| [UI 插件说明](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md) | factory/apply/生命周期边界 |
| [manifest 类型](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/util/package-manifest/src/types.ts) | package.json.dsh，不存在额外 network 权限字段 |
| [UI session](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-session/src/client/index.ts) | sessionStatus、pending identity、ReadonlyMap |
| [store contract](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/store/src/contract.ts) | selector 必填、subscribe 只失效通知 |
| [conversation slots](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-conversation/src/client/contract/slots.ts) | composer.dock session scope |
| [输入契约](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-conversation/src/client/contract/input.ts) | inputActions、captureInsertion、submit；无须覆盖整草稿 |
| [approval 实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-approval/src/client/index.ts) / [factory contract](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-approval/src/client/contract/slots.ts) | 现有 PendingApproval、answerable、一次允许/拒绝，不接管 ownership |
| [session 控制](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/session-controller/src/client/contract/session.ts) | cancel/command/prompt 的精确接口 |
| [HTML](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/apps/web/index.html) / [Host 静态入口](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/host/frontend-static/src/index.ts) | 此快照未见强制 CSP，不外推反代/浏览器部署策略 |

## AU05：社区与 MIT 实现参考

全部取到于 2026-10-27。多个项目可能沿用同一逆向来源，一致不等于三个独立硬件实验。

| 来源 | 描述与限制 |
|---|---|
| [VibDock Windows device adapter](https://github.com/loonghao/vibdock/blob/eb32139a11df028edafedd7cbaf70eeb32474aa9/crates/vibdock-device-au05/src/lib.rs) | Win32 collection/caps 与 Output I/O |
| [VibDock 编解码](https://github.com/loonghao/vibdock/blob/eb32139a11df028edafedd7cbaf70eeb32474aa9/crates/vibdock-au05/src/lib.rs) | TEA、shortcut、report 参考；未复制 |
| [gesture monitor](https://github.com/loonghao/vibdock/blob/eb32139a11df028edafedd7cbaf70eeb32474aa9/src/gesture_monitor.rs) | 实际为 GetAsyncKeyState 轮询，不能写成已完成 LL hook |
| [Windows 验收记录](https://github.com/loonghao/vibdock/blob/eb32139a11df028edafedd7cbaf70eeb32474aa9/docs/testing/au05-acceptance.md) | FW4.4.0 的日期化枚举/shortcut 证据，不证明本项目灯/事件 |
| [VibDock MIT](https://github.com/loonghao/vibdock/blob/eb32139a11df028edafedd7cbaf70eeb32474aa9/LICENSE) | ©2026 loonghao；若将来复用必须保留许可 |
| [Swift protocol](https://github.com/patrick-fu/vibekey-elements/blob/c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73/Sources/VibeKeyCore/VibeKeyProtocol.swift) / [HID manager](https://github.com/patrick-fu/vibekey-elements/blob/c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73/Sources/VibeKeyCore/HIDManager.swift) | vendor callback/事件索引与灯构造证据，主要为 macOS 代码 |
| [Swift MIT](https://github.com/patrick-fu/vibekey-elements/blob/c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73/LICENSE) | ©2026 Patrick Fu；未复制实现 |
| [社区 PROTOCOL](https://github.com/eddix/webhid-config-collection/blob/2710ac66371c93f2fc2618b394be34959be0d41a/vibekey/PROTOCOL.md) | 未发现明确复用许可，只引用技术事实/链接，不复制代码/长段；同库旧 Python 注释和长度不一致，需逐字段核实 |

## Microsoft 官方边界

以下正文均在 2026-10-27 取到：

- [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)：冲突失败、MOD_NOREPEAT、F12 保留给 debugger。
- [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)：消息循环/超时/回调约束。
- [KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)：没有 hDevice，不能声称只拦 AU05。
- [Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input)：TLC、hDevice、后台观察，不等于设备级全局抑制。
- [Sending HID reports](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/sending-hid-reports)：区分 WriteFile/output 与 feature report。

## Ruled out / Unresolved

- 不移植 VibeWand：当前是 Mac 项目、许可边界另需审，本仓库不含其实现/资产；不宣称 Windows 移植。
- 不打包优篮子/Kehwin 私有 SDK/固件；不把 D200 的 Codex Micro 接口外推 AU05。
- 不从社区同名 ChatGPT/WorkBuddy 市场条目推断公开 HID SDK：准确条目未核实，且不属于本路线依赖。
- 未验证：本机 DSH GUI 安装、真实 browser/bridge 连通、Windows vendor 事件、所有灯控、固件差异、Studio 共存与恢复。下一步见 [roadmap](roadmap.md)。
