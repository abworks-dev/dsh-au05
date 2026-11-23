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

## 2026-10-29 灯控模式、focus 与配置回读复核

**执行后端**：agent-reach 的 GitHub／gh 后端，先读取 skill 的 dev 路由，再以 `gh api` 定向读取下列固定提交的原文件并核对行号；另做了两次 `0x7d` 仓库代码查询，均无命中。API 正文请求总数未单独统计，不伪造计数。复核时这两个 SHA 仍为各仓库最新提交。只引用协议事实与必要短字段，不复制第三方实现，未下载／运行其驱动。

| 固定源码 | 本轮核对事实与限制 |
|---|---|
| [Elements 灯控构造：89–135](<https://github.com/patrick-fu/vibekey-elements/blob/c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73/Sources/VibeKeyCore/VibeKeyProtocol.swift#L89-L135>) | 全局 `0/1/2` 为 off／solid／hardware-auto；呼吸构造用 `0x7C`。`brightness` 参数未被该构造实际使用，不能据此声称设置了亮度。 |
| [OpenVibeKey 设备API：92–132](<https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/native/VibeKit/Sources/VibeKitHID/VibeKitDevice.swift#L92-L132>) | 全局模式与全亮亮度分开；wire5 来自 `focus ledIndex`，完整记录从 wire8 起，每灯五字节 `[type,workTime,breatheLevel,breatheBright,alwaysOnBright]`，默认 `[type,0A,02,02,02]`。`0x7C` 为这五个字段的组合，不是四通道选择掩码；源码直接注明 `0x04=type`。 |
| [OpenVibeKey 灯控UI：477–505](<https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/native/VibeKit/Sources/VibeKitApp/ContentView.swift#L477-L505>) / [单灯调用：677–683](<https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/native/VibeKit/Sources/VibeKitApp/VibeVM.swift#L677-L683>) | `1` 只启用全亮亮度，`2` 才启用工作模式分灯；UI按被修改灯的索引传 focus。全亮亮度 UI 使用 `0/1/2=灭/低/高`，与设备API的 `0…100` 注释不一致，因此不能把工作记录里的 `2` 解释为 2%。UI仅为 K1 提供持续呼吸选项，属于该项目的固件经验，不是对所有 AU05 固件的绝对能力结论。 |
| [OpenVibeKey MIT](<https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/LICENSE>) | ©2026 palaemonboy；本仓库独立实现协议事实，没有复制实现。 |
| [Elements 握手：353–378](<https://github.com/patrick-fu/vibekey-elements/blob/c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73/Sources/VibeKeyCore/HIDManager.swift#L353-L378>) / [心跳：807–815](<https://github.com/patrick-fu/vibekey-elements/blob/c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73/Sources/VibeKeyCore/HIDManager.swift#L807-L815>) | offline → 80ms → online03 → 首次 heartbeat，后续每 0.8s 只发 heartbeat。旧本地实现没有这个初始 offline／立即 heartbeat，但这是次要差异，不能替代本轮 focus GET 对照证据。 |
| [Elements report编码：104–135](<https://github.com/patrick-fu/vibekey-elements/blob/c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73/Sources/VibeKeyCore/VibeKeyCore.swift#L104-L135>) / [OpenVibeKey 帧编码：9–32](<https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/native/VibeKit/Sources/VibeKitCore/Frame.swift#L9-L32>) | 两者与本地相同：64 字节明文 TEA 后取前63字节密文，前置 reportID `55`，共64字节。最后一个不完整加密块不包含本次灯控关键字段，不应误判为截断错误。 |

**原文件注释不能替代实测**：OpenVibeKey 要求带完整四记录，但其 profile 批量应用仍仅发 focus0；不能据此假定一次完整向量就会更新全部通道。与只读源码访问分开的本轮临时原协议 probe 取得真实 GET 对照，模式均为 `2`、记录顺序为 K1／K2／K3／旋钮，下列数值为十进制：

```text
before       [[2,10,2,4,7], [0,10,2,4,7], [0,10,2,4,7], [1,10,2,7,4]]
focus0-only  [[1,10,2,2,2], [0,10,2,4,7], [0,10,2,4,7], [1,10,2,7,4]]
focus0/1/2/3 [[1,10,2,2,2], [1,10,2,2,2], [1,10,2,2,2], [1,10,2,2,2]]
```

每次使用相同四灯 type1 目标，第一轮固定 focus0 只更新 K1；第二轮按 focus0/1/2/3、帧间80ms后 GET，四条记录均一致。正常 finally 逐 focus 恢复原配置，未触发麦克风或按键动作。修复因此保留 global2 和 `0x7C`、改逐 focus 发送并 GET 对比；无证据要求改 global1 或 `0x7D`。默认 K2／K3 改常亮是保守策略，不宣称它们在所有固件上绝不支持持续呼吸。

追加读取 [社区字段备注：92](<https://github.com/eddix/webhid-config-collection/blob/2710ac66371c93f2fc2618b394be34959be0d41a/vibekey/PROTOCOL.md#L92>)，可独立核对 `0x08=工作时间`、`0x10=呼吸等级`、`0x20=呼吸亮度`。该资料及上述两个固定 MIT 源均未说明 workTime 单位、是否会定时熄灭、常亮是否受该值限制；因此 `0A` 不能被当作“10秒”的已证事实，也不能假设连接 heartbeat 能使灯一直亮。GET 配置一致尚不证明持续可见效果；未据此盲改时间字段。

`verified` 只代表请求与返回的配置一致，`mismatch` 代表字段不一致，写完无回读仍是 `written`；它们都不是物理可见灯态传感或人工验收。上述试验确认逐 focus 修复有效到配置层，人工可见灯态与新版端到端 GUI 验收仍未完成。产品保证边界见 [灯光反馈](<product-guide.md#5-灯光反馈与真实保证范围>)。

## 2026-10-29 对照本机 Codex hooks 与现成灯控实现

**执行后端**：agent-reach GitHub 路由，`gh api search/code` 一次（关键词 `ustudio-cli`），继而定向读取下列固定提交的源码与 LICENSE；另只读核对本机已安装的 Ulanzi hook 配置、安装脚本及 `hooks.js`，未执行官方 CLI、修改 Codex 配置或运行下载代码。正文请求总数未单独统计，不伪造总数；采集日期为 2026-10-29。复现入口：`gh api --method GET repos/ihavespoons/vibed/contents/Sources/vibed/Config.swift -f ref=f7c89385416e626a9c6c0c9d674153a9f4af6112`。

- 本机安装链样本是 Codex command hook → Node `hooks.js` → 已安装的 `ustudio-cli hook --source codex --event <event>` → Studio 本地通道；没有在 hook 内直接构造 HID 报文。`hooks.js` 不存在该 CLI 时即退出。它还留有旧 HTTP 上报帮助代码，不能仅因出现旧 URL 就认定当前分支执行了 HTTP 上报。读取已安装配置不等于证明某一真实 Codex 会话已成功触发此链，亦未把优篮子私有脚本或二进制复制进仓库。
- [vibed 配置与灯态表](<https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/vibed/Config.swift#L78-L81>) 明确使用默认 `255` 工作时间以避免灯效到期；[可见灯位与状态](<https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/vibed/Config.swift#L146-L177>) 注明该作者机器通道 1/2/3 可见、0 不可见，并以旋钮呼吸表示忙碌。这与本机只看到后三处亮灯相符，但不能外推所有固件或取代本机持续效果验收。
- [vibed 灯控实现](<https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/vibed/DeviceLighting.swift>) 使用按 focus 写入和独立 GET；有快照、单请求串行、设备在线与心跳门控。该仓库是 macOS Swift 实现，不直接当成 Windows 驱动运行。[MIT 许可证](<https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/LICENSE>) 为 ©2026 Ben Gittins，署名与完整许可已随插件保留。
- [olanzi 固定源码](<https://github.com/MrCroxx/olanzi/tree/eb78f88f973d4d28f1d6d3369cdfb65881b1e1c6>) 中的 hook 接入与 core 也分离事件入口、状态聚合和设备层，不能从“支持 Codex hooks”推断跨平台应用可直接共享同一 HID 句柄。

本轮仅采纳现成的可见旋钮反馈与 `255` 工作时间：忙碌用 `[0,0,0,2]`，录音用 `[2,0,0,2]`，不再仅依赖尚未确认可见的通道0；关闭仍为四个零，K2/K3 常亮策略保留。原独立 GET 期望同步为 `255`，断开仍逐字节恢复原快照工作时间，绝不把 `255` 写入恢复基线。不宣称字段单位或无限时长。本轮没有新增独立麦克风开关、指示开关或呼吸使能写入，也不新增诊断面板。

## 2026-10-29 K1 与官方 Codex hooks 的只读复核

**采集日期**：2026-10-29。**执行后端**：agent-reach GitHub／gh 路由及官方网页正文；另只读核对本机已安装 Hook 配置、官方包装脚本和 CLI 帮助。**执行查询数**：主代理关键词搜索 0，官方页面正文请求 2；子代理固定 SHA tree 元数据请求 4、源码正文请求 6，未扩展全网检索。不运行 Hook、不上报伪造会话、不启动 Studio、不打开 HID 或麦克风。

- [官方状态说明](https://docs.ulanzistudio.com/vibekey/faq/codex-claude-status.html) 明确 K1 表示语音输入正在聆听，其他状态灭；K2 为确认，K3 为介入／取消，旋钮为任务推进。页面描述的是预期行为，不公布 K1 的底层 HID 控制实现。
- 当前本机 Codex 用户 Hook 配置实际注册 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`PermissionRequest`，命令形状是 `ustudio-cli-hook.cmd --agent codex --event <event>`；包装脚本校验 Studio 安装目录、设置当前子进程 PATH 后直接调用版本 `1.0.23` 的 `ustudio-cli.exe`。这与上节旧 `hooks.js` 样本不是同一入口，不能把旧样本继续描述为当前唯一实现。该配置没有录音开始／结束 Hook，也没有直接灯控字节。
- 仅以 `--help` 调用当前已安装 CLI：它输出 `event/request`、`--agent/--event` 和向主进程转发命令的用法，随后按无效参数返回 `3`；因此没有继续执行脚本中后续命令，也没有调用真实 Hook 或请求设备。只读核查 Studio、CLI、原生采集器进程均为零。不能把 CLI 帮助当作 Hook 或灯态成功证据。
- [olanzi 对官方链路的复核：91–127](<https://github.com/MrCroxx/olanzi/blob/eb78f88f973d4d28f1d6d3369cdfb65881b1e1c6/docs/01-ulanzi-studio-scope.md#L91-L127>) 是对 Studio 3.3.9／macOS 的逆向记录，不是官方 CLI 开源实现：入口经官方包装脚本／编译 CLI、`QLocalSocket` 名 `ulanzistudio_cli`、运行中的 Studio，再到 `kwdm.dylib` 与 vendor HID。本机 Windows 配置能直接证实包装脚本／CLI 这一段，但不能把 macOS 私有设备层照搬为 Windows 已验证机制。Codex Hook 本身不是独立驱动。旧 `device-hook.js`／HTTP 直发帮助代码不能在没有调用关系时当成当前 Codex 控灯路径；该文档的状态表标注 Claude，亦不能冒充 Codex 实际状态表。其[未解决项：264–274](<https://github.com/MrCroxx/olanzi/blob/eb78f88f973d4d28f1d6d3369cdfb65881b1e1c6/docs/01-ulanzi-studio-scope.md#L264-L274>) 仍列出 AI 灯态映射和 recording／mic 私有路径。
- [vibed 的可见通道备注](<https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/vibed/Config.swift#L146-L177>) 明确作者设备通道 0 不可见、1／2／3 可见，因此该项目不能提供“现成 K1 已成功点亮”的依据。
- [OpenVibeKey 的独立提示调用](<https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/native/VibeKit/Sources/VibeKitApp/VibeVM.swift#L673-L674>) 有 `micUiFlick` 及麦克风 UI 闪烁注释。这只证明该项目存在独立配置路径，不证明它就是本机 K1 的充分条件，更不是录音状态到实体灯成功的测量；本机既往设置回读未改变，故不再凭该注释重试。

**结论与未解决项**：可直接借鉴 Hook → 会话状态聚合 → 单一设备控制层的分工与焦点规则；不能把“兼容 Codex hooks”当作已拥有 K1 指示灯驱动。现有证据尚未取得官方 Studio 在真实语音开始／结束时控制 K1 的确切调用或报文，也未证明如何无 Studio 独立驱动本机 K1。下一步应核对官方语音侧的实际控制差异，而不是再次重放已失败的 `0x88` 通道 0 或伪造 Codex 工作事件。涉及真实录音或新的设备写入时另行明确确认。

## 2026-10-29 官方 Codex 任务灯语义复刻

**采集日期**：2026-10-29。**执行后端**：复用上节已实际抓取的官方状态正文；定向只读检查本机提取的 DSH `0.2.1-rc.3` Client／Host 实现。**执行查询数**：新增网络查询 0。未执行 Codex Hook、真实审批、录音或新设备报文试验。

- 用户本轮确认官方 Codex Hooks 能正常驱动设备灯。这是用户报告的实机基线，不改写为本代理已重跑官方验收。[官方状态规则](https://docs.ulanzistudio.com/vibekey/faq/codex-claude-status.html)作为需求规范：K1 聆听呼吸，K2 确认呼吸，K3 介入／可取消呼吸，旋钮任务推进常亮；单焦点会话、统一呼吸，不按审批数量叠加。
- DSH `ui-session` 的状态投影分别提供 `running` 和 `pendingInteraction`；两者可以同时为真。因此不能从活跃回合直接推断此刻正在推进，审批等待期间旋钮目标应熄灭。当前只投影一个 pending，不代表没有其他交互，也不能用它计数。
- 安装版本实际内置交互类型为 `approval`、`question`、`plan-review`。审批 `answerable=false` 表示已回答／已撤销，不应继续当作有效确认。问题／计划评审没有该属性，而由自己的 `getSnapshot()` 给出 `state`、`channel`、`closed`；仍需回答的 open 交互才显示确认，continued 交互可与运行并存。每轮刷新重新读取，不能只比较载体引用。
- `session.cancel()` 在 Session 上始终有定义，不是公开的权威 `canCancel`。K3 的运行提示仅表示插件可向当前绑定会话请求中断；Host 可能拒绝，接受请求也不等于取消完成。问题提示仍要求人工在界面作答，不能由设备自动捏造答案。
- 此提取版本部分声明文件未随离线包包含，以上形状根据已安装实现核对，不能伪称额外 TypeScript 能力。改动保留既有 DSH 公开状态／服务入口，不直接调用官方 Codex 私有 CLI 或改写用户 Hook。

本轮实现证据在 [Client](<../packages/dsh-plugin/client.js>)、[Host](<../packages/dsh-plugin/host/device-controller.js>)、[原生后端](<../packages/dsh-plugin/native/au05.ps1>)；规则和验收边界见[产品说明](<product-guide.md#5-灯光反馈与真实保证范围>)。规则、离线测试和配置回读均不代替本机可见呼吸／常亮验收，尤其不把任务灯复刻写成 K1 底层问题已解决。

## Microsoft 官方边界

以下正文均在 2026-10-27 取到：

- [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)：冲突失败、MOD_NOREPEAT、F12 保留给 debugger。
- [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)：消息循环/超时/回调约束。
- [KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)：没有 hDevice，不能声称只拦 AU05。
- [Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input)：TLC、hDevice、后台观察，不等于设备级全局抑制。
- [Sending HID reports](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/sending-hid-reports)：区分 WriteFile/output 与 feature report。

## Typeless：第三方快捷键预设

**采集日期**：2026-10-29。**执行后端**：定向 HTTPS 正文抓取，原生桥子代理再次取得 HTTP 200；早先 Exa 限流后降级网页检索。**执行查询数**：本条定向复核新增关键词查询 0；先前发现阶段完整计数未保留，不伪造总数。复现入口：对下方已知 URL 进行 HTTPS GET，核对 Windows 默认快捷键及开始／结束语义，不执行应用或系统按键。

- [Typeless 官方 Dictate](https://www.typeless.com/help/quickstart/dictate)（取到日期：2026-10-29）：官方描述 Windows Right Alt 单按开始、再次按结束；据此设置预设。用户可以在应用里更改快捷键，不能由默认文档推断本机当前配置。未验证本机 Typeless 是否安装、是否响应模拟点按及实际音频／转写；本仓库不打包 Typeless 实现。

## 2026-10-29 网易叭哥说预设与当前会话滚动

**采集日期**：2026-10-29。**执行后端**：agent-reach 路由下的定向 HTTPS 正文与官方静态 JS 抓取；DSH 插槽另只读核对已安装 `0.2.1-rc.3` 的 SDK 声明和渲染代码。执行查询／请求总数未独立记录，不伪造；以下是实际取到的定向复核入口，不执行第三方应用、安装程序或真实系统快捷键。

- [网易叭哥说官网](<https://bug.youdao.com/>) 与 [官方前端脚本](<https://bug.youdao.com/js/main-5fia7obE.js>)（取到日期：2026-10-29）：名称为“网易叭哥说”，官方描述语音转文字、智能润色、去口头语、翻译和跨应用输入。未找到默认快捷键表。
- [官方隐私政策](<https://c.youdao.com/dict/law/bageshuo_privacy.html>)（取到日期：2026-10-29；页面更新 2026-08-04、生效 2026-08-11）：Windows 系统输入权限用于光标处写入转写文本，并配合自定义快捷键启动、关闭转写。仅据此接入现有完整点按桥；不能据此断言默认键、按住／切换语义、独立停止键或润色／翻译控制 API。
- [官方更新日志](<https://iau-json-store.youdao.com/api/v1/runtime/projects/bageshuo/items?key=changelog>)（取到日期：2026-10-29）：Windows 1.0.33（2026-09-17）增加鼠标快捷键，1.0.38（2026-10-16）增加润色开关、录音保存导出与失败重试。功能存在不代表有第三方可调用接口。
- [官方服务条款](<https://c.youdao.com/dict/law/bageshuo_service.html>)（取到日期：2026-10-29）：产品归有道公司所有。本仓库不包含其实现或资产，不宣称合作、授权或背书。初次实现因未核实默认键而选用 `Ctrl+Shift+Space` 模板；用户随后指出本机默认是右 Alt，预设已按该反馈纠正为 `RightAlt`，不再要求改应用默认配置。此为用户反馈与本地适配决策，不冒称上述官网正文证实了默认键；旧的自定义组合仍可在独立自定义模式保存使用。

以下记录为 2026-10-29 的初版 DOM 实现；2026-11-03 上下滚动已改用受限原生 wheel RPC（整屏仍用 DOM），不是对旧证据的追溯改写。初版当前会话滚动不依赖新增 Host API。已安装 SDK 提供 session-scoped `conversation.input.dock` 列表插槽，实际位于带会话身份的内容外壳及 `data-conversation-scroll` 之内；未发现公开 scrollActions／scrollHistory 服务。实现只在自有隐藏 ref 的祖先范围找唯一可见 scrollport，用标准 DOM `scrollBy` 移动，不搜索全文、不读消息、不模拟 wheel／键盘。此是固定运行时结构适配；真实运行中自动 follow／折叠动画与跨版本几何仍未验收，不能将隔离 fixture 说成实机历史滚动通过。

## 2026-10-29 官方 Windows 客户端静态调用链复核

**采集日期**：2026-10-29。**执行后端**：agent-reach 路由下的本机只读 PE 导入／导出、字符串交叉引用与 x64 指令分析；没有执行官方 EXE／DLL、启动麦克风、发出按键或再次试写设备。分析工具仅放入系统临时目录，未打包入本插件。此轮是安装文件证据，不是官方源码，也不是运行时抓包；定向分析命令总数未独立保留，不伪造。

检查对象为本机既有安装文件（不随仓库分发，也不是要求其他机器存在的文档依赖）：

```text
C:/Program Files (x86)/Ulanzi Studio/UlanziDeck.exe
```

- 本机官方 Windows 客户端，版本 `3.4.4.0`：定位到调试字符串对应的 `UlanziDeck::updateIndicatorLightByState(const struct CliProtocol::HookFiredEvent &)`。函数范围 RVA `0x1A6C20–0x1A70DE`，在 `0x1A6DDA`、`0x1A6DE7`、`0x1A6DF4` 明确构造灯索引 `1、2、3`，循环于 `0x1A6EA3` 调用逐灯设置包装函数 `0xC5DC0`。这是 Codex／Claude 任务状态灯路径的直接静态证据；该循环不含索引 `0`，不能把它说成 K1 录音灯的控制链。
- `HotkeyWorker::holdKey(void)` 与 `HotkeyWorker::forceRelease(void)` 的交叉引用分别定位到 RVA `0xD3C70–0xD3DFE` 与 `0xD3BF0–0xD3C6C`。已展开部分呈现快捷键保持／释放及后续按键发送；没有由此建立“第三方软件实际开始／结束录音 → K1 灯”的完整连接。相关方法名不是录音状态通知协议。
- 官方客户端与随附设备 SDK 存在麦克风数据／状态以及独立指示配置相关入口，但**入口存在不等于录音时一定调用**。未定位直接导入／直接调用亦不能排除 Qt 信号、回调、动态绑定或固件路径。不能据静态分析断言 K1 完全由固件自动驱动，更不能据此新增猜测性写入或把指示配置当成开始录音命令。

**未解决**：官方实际录音开始／结束时触发 K1 的最终调用者和完整报文序列，仍需有界运行时对照；本轮没有该证据。此前 K1 真机未亮结论不变。后续若做录音对照，应明确用户授权、不留存音频／转写，并先定义只采集控制链的边界；不再用普通任务灯参数轮试来冒充这项追踪。

## 2026-10-29 官方客户端运行期间的叭哥说录音对照

**采集日期**：2026-10-29。**执行后端**：Windows 原生进程／自有 GUI 状态核对；经用户明确同意后启动既有官方 Studio `3.4.4.0`，使用限时、按进程过滤的 DBWIN 分类观察器；用户自行操作录音并反馈实体灯。没有安装抓包驱动、注入客户端、保存原始调试行、音频或转写正文；定向命令总数未独立保留，不伪造。

- 对照前使用 DSH 自有面板正常断开 AU05，确认生产 HID 子进程为零。保留用户的语音／自动连接偏好，不重新加载插件，因此本次不会自动重连；不允许 DSH 与 Studio 同时接管设备。
- 官方 Studio 已运行，叭哥说也已运行。用户反馈 Studio 快捷键输入框只显示“Alt”，未核实左右 Alt 的发送语义，因此**没有修改或保存该映射**。本次改为指导用户用物理键盘右 Alt 启停叭哥说；它验证外部应用正常录音时的灯态，不验证 Studio 的 K1 快捷键映射。
- DBWIN 观察器对官方主进程运行 120 秒，输出 `observer_ready` 后正常到期，结果为 `targetMessages=0, matchedMessages=0, emittedEvents=0`。仅按固定方法名分类，不留原始行或报文。没有兼容调试输出**不等于没有控制调用**；没有采集用户实际按键或录音起止时间，反馈晚于观察器结束，也不能断言录音与该窗口重合。
- 用户确认：**叭哥说确实录音，但 K1 始终不亮**；随后明确确认，本次录音在叭哥说中**选择的是 AU05 麦克风**，不是未核实的系统默认输入。收尾检查时 Studio 界面存在“已连接”状态，DSH 原生 HID 子进程仍为零；可访问树未提供可独立确认的 AU05 型号标签，因此不将该状态文本升级为完整设备协议握手证据。
- 定向查询叭哥说的 Windows 麦克风使用标志不可用，未因此扩大读取其他应用的权限历史；没有独立音频采集证据。录音成功来自用户观察，不是后台观察器的判定。

**结论与边界**：本次获得的是“官方客户端运行期间，外部语音应用确实录音但 K1 未亮”的人工负向对照；不是“官方录音到 K1 控制报文已追出”，也不是 DSH 语音／灯控通过。K1 最终调用者与报文序列仍未解决。观察器已正常释放资源，官方 Studio 保持打开、DSH 保持断开；不自动切回或重试。切回 DSH 前应从托盘完全退出 Studio，再手动连接，避免双重占用。

## 2026-10-30 叭哥说状态开放能力与 K1 适配评估

**问题与判据**：是否能取得叭哥说实际开始／停止监听的状态，而不是根据快捷键猜测；状态取得与 K1 物理驱动分别验收。沿用本项目资料台账，不新建抓取工程。

**采集日期**：2026-10-30。**执行后端**：agent-reach 网页／搜索路径，Exa（主代理 1 次；公开应用调研 3 次尝试，其中 2 次成功、1 次免费额度限制后停止），Jina Reader 实抓 5 个应用官方 URL 与 3 个 Microsoft 官方 API URL。未运行叭哥说、查询本机音频会话、读取用户历史／转写、开启麦克风、发送快捷键或写设备。复现示例：`mcporter call exa.web_search_exa query="site:learn.microsoft.com IAudioSessionControl2 GetProcessId AudioSessionState capture session microphone" numResults=4`；网页使用 `curl -s https://r.jina.ai/<原URL>`。

- [叭哥说官网](https://bug.youdao.com/)／[隐私政策](https://c.youdao.com/dict/law/bageshuo_privacy.html)（取到日期：2026-10-30）：确认跨应用输入及 Windows 自定义快捷键启停语音转写；未提供公开的录音状态订阅协议。快捷键控制不等于状态反馈，采音、识别、润色和文字插入也不是同一阶段。
- [官方更新日志](https://iau-json-store.youdao.com/api/v1/runtime/projects/bageshuo/items?key=changelog)（取到日期：2026-10-30）：Windows `1.0.39`（2026-10-19）有“优化录音浮窗与状态提示”，`1.0.41`（2026-10-30）有“优化录音启动”；只证明客户端有状态提示，未核实该提示能否通过 UI Automation 稳定读取。试音、回放不能当成听写监听。
- [服务条款](https://c.youdao.com/dict/law/bageshuo_service.html)（取到日期：2026-10-30）虽提及现有／未来 APP、插件、SDK 交付形态，但不是已发布状态 SDK 的文档。[有道智云实时识别](https://ai.youdao.com/DOCSIRMA/html/tts/api/ssyysb/index.html)（取到日期：2026-10-30）的 WebSocket 是调用者自己发送音频的云 ASR，不能订阅正在运行的叭哥说桌面进程。
- Microsoft [GetState](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol-getstate)、[GetProcessId](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-getprocessid)、[IAudioSessionControl2](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessioncontrol2)（取到日期：2026-10-30）：可查询现有音频会话状态、关联 PID，不必自行打开采音流。Active 只表示存在运行中的流，不等同应用业务上的“正在听写”；跨进程会话的 PID 可能只是创建进程，不能盲目单 PID 匹配。

**结论**：本次公开范围未查到叭哥说客户端的录音状态 API／WebSocket／本地 HTTP／URI 查询／回调或插件订阅文档，不断言其内部不存在。Windows 捕获会话状态是值得先验证的系统级候选；必须排除播放会话，并核实其采音进程、预热／常驻占麦、试音及停止后的流释放行为。UIA 只读浮窗状态可作另一候选，但未实测其可访问性；不得读取转写正文、通过 OCR 全屏采集或私有进程注入来凑状态。

**K1 独立边界**：当前第三方模式仅记录“已请求快捷键”，有意不冒充真实录音。即使取得可靠的叭哥说状态，也不代表 K1 已可控：现有 Studio Hook 已验证的是任务灯链路，K1 物理控制此前未通过。不要把叭哥说录音伪装成 Codex／DSH 任务事件，也不要让直连后端与 Studio 双重占用接收器。

**下一步（尚未执行）**：优先做一次明确授权、限时、只读的“待机→用户启动→用户停止／取消”状态对照，只记录目标应用音频会话的有限枚举和时间，不保存音频或文字。只有开始／结束对应关系可靠后才接灯；K1 驱动另行验证。若应用常驻采音导致不能区分业务状态，则标记不支持，而不是改成按 K1 自行翻转状态。可同时向官方确认是否有录音开始／停止／取消／失败事件与状态快照协议。

## 2026-10-31 叭哥说只读音频会话状态对照

**问题与判据**：在不读取音频／转写、不操作录音的前提下，能否从 Windows 捕获会话观察到与用户手动开始、停止录音相符的变化。该对照只验证状态来源，不涉及 K1 写入。

**采集日期**：2026-10-31。**执行后端**：PowerShell 7／C#，Windows CoreAudio 只读元数据 API；目标为当前唯一 `bageshuo.exe`，版本 `1.0.41`，固定 PID、启动时间和完整映像路径。只枚举活动捕获端点的 `IAudioSessionManager2`／会话 PID 与状态，不打开音频客户端或采音流，不读取应用窗口、录音、转写或剪贴板。自有临时脚本及身份回执位于忽略的 `.local/`，没有修改产品后端。未发系统快捷键、未接管 AU05、未改变应用设置。复现流程为：固定当前目标身份 → 默认离线自测 → 明确传入 `-Observe` 和身份参数 → 用户操作；原身份回执不能用于静默重新绑定已重启进程。

- 默认离线编译与 **26 组合成规则自测**通过；不将其算作真实会话证据。第一次实际启动因 JSON 解析后时间字符串丢失 UTC 格式而被参数校验拒绝，没有进入会话枚举；修正启动器的 ISO 格式及退出码传播后，另行开始实际对照。
- 用户先确认未录音，再按提示手动开始并确认正在录音；随后按提示手动停止／取消并等待约 5 秒。用户没有向观察器提供音频或文字。确认时间不是精确点击时间，以下均为观察器相对时间，不推定严格启停延迟。
- 实际窗口 **150,007 ms**，**300 个样本、6 次计数字段变化**，约 500ms 一次；变化立即输出，稳定期间约 5 秒心跳。全程目标进程数为 1，最大目标 Active 会话数为 1，输出未见归属不明、端点失败或读取错误。

| 相对时间 | 对应目标会话 | 证据解释 |
|---|---|---|
| 约 0–74 秒 | 未匹配到会话，Active=0 | 用户已确认待机；“没有匹配会话”不泛化为所有场景的业务待机状态。 |
| 75.532／76.046／77.536／83.032 秒 | 依次 Active／Inactive／Active／Inactive | 用户后续明确确认开始阶段自己多点了两下；额外切换与重复操作相符，不再作为应用内部抖动或状态检测异常的证据。 |
| 89.029–约 130 秒 | Active=1，Inactive=0 | 用户确认处于录音时，读取到了严格归属该目标的活动捕获会话。 |
| 130.535–150.007 秒 | Active=0，Inactive=1 | 用户确认停止后，目标会话转为 Inactive，并保持到窗口结束；会话对象保留不等于仍在录音。 |

窗口正常超时结束、进程退出码 0，最后 `finished=true, reason=timeout, unknown=false, error=none`。后续只读清理检查确认自有观察进程为 **0**，叭哥说仍运行；15 个既有直连后端文件的 SHA 基线未变。没有自动开启下一轮，也没有因观察器结束而替用户停止应用或发出“结束录音”快捷键。

**本轮结论（经用户复核通过）**：用户明确说明额外切换来自自己多点了两下，并确认本次测试通过。将本机叭哥说 `1.0.41` 的“待机／用户开始／用户停止”只读状态对照记为通过：取得了与操作相符且可严格归属叭哥说的系统采音状态信号，不将重复操作导致的切换误报为应用抖动。该结果不是叭哥说官方业务状态 API，也不自动覆盖试音、常驻采音、设备切换、进程重启及多进程版本；不能识别“识别中／润色中／插入完成”等业务阶段。**状态检测本轮通过，K1 物理灯控仍需单独验收**；没有因用户确认而自动接灯或扩大测试范围。

## 2026-10-31 K1 状态联动尝试：原配置读取未通过，用户停止排查

**范围**：用户授权继续验证 K1，并确认已从托盘退出 Studio、保持 DSH 直连断开、叭哥说未录音。独立限时协调器只把可信 Active 状态映射为 `[2,0,0,0]`，可信停止映射为四区熄灭；其他输入事件丢弃，不调用 DSH、快捷键或音频采集。事先说明会临时控制四区灯，并由原生后端正常释放时恢复快照。没有更改既有 15 个产品后端文件、预设或自动连接偏好。

**执行后端**：忽略目录中的独立 Node 协调器，复用既有 PowerShell/C# 原生后端及上一轮只读状态观察器；本轮没有网络查询或协议参数轮试。协调器默认纯内存自测 **38 项通过**，原生默认离线 SelfTest 通过，均不算真实灯效证据。仅明确 `--run-authorized` 才进入一次实际窗口，设置 150 秒采样／195 秒总上限，并支持正常停止信号。

实际结果按顺序为：

1. 原生后端报告 `ready`；目标状态首样本相对 **39 ms**，`active=0, inactive=0, matched=0`。
2. 协调器发送首个待机目标 `idle`、`requestId=1`，回执为 **`failed`**，立即失败关闭；没有到请用户开始录音的阶段。
3. 对照未改动原生源码：写灯前必须 `CaptureSnapshot()` 取得原配置。原配置未读到时，只返回 `failed`；真正目标灯态写入位于成功分支。此次没有伴随 `write_failed` 状态、原生退出码为 0，符合原快照查询未取得有效回复的保护分支，**不应描述为目标灯态已经写入但 K1 没亮**。软件在线、配置查询及退出时的软件离线仍属于本轮实际设备协议操作。
4. 正常发送停止请求，原生与状态观察器均 **退出码 0**、自有子进程均关闭，无强制结束。只证明正常清理流程结束；没有恢复配置读回或光学测量，不把它写成实体恢复已确认。

用户随后明确说明设备刚才已醒着，并选择**先停止排查**；因此没有把睡眠认定为原因，没有重新连接、重试、延长窗口、绕过快照保护或更换灯控参数。最后只读核对：Studio **0**、自有 HID 后端 **0**、自有音频状态观察器 **0**，叭哥说仍在，产品 15 文件 SHA 基线未变。Studio 按用户此前退出状态保留，不自动重开。

**结论**：此前叭哥说状态对照通过的结果不变。本次 K1 联动因原配置读取门槛未通过而未进入录音阶段，不能判为可见灯效通过，也没有新增“录音时 K1 不亮”的对照证据。原配置未及时有效回应的原因尚未确定；遵照用户选择暂停，不自动继续调查。

## 2026-10-31 dev.2 当前 GUI 加载与 Studio 转发核对

**执行范围**：用户授权更新当前 DSH 并集中验收，随后确认已启用 Studio 组件并打开设置页。本轮在现有桌面 GUI 操作，没有另起 DSH/Web 服务；本地运行时对应 `http://127.0.0.1:56068`。此前单次 K1 排查的暂停后来已被用户的新版本开发／验收授权取代，但并未因此取得任何新的实体 K1 成功证据。

1. UI Automation 实际读取到新版独立 `AU05 / Studio` 设置组，以及“读取已发现绑定”“确认这些按键绑定”“读取按键配对配置”等控件；不是只看磁盘版本号。初始未开始跟随。
2. 发现直连面板为“已连接”、原生后端 1 个；通过本项目面板明确断开后，状态为“未连接”、原生后端 0 个。没有强关进程。
3. 正常启动已核验哈希的官方 Studio。旧启动辅助脚本报 `studio_ipc_startup_not_ready`，但之后在 GUI 明确开始跟随，实际观察到 **“运行中 · 已转发 10 · 已丢弃 0”**。这证明此次真实事件经 CLI 转发成功，说明旧辅助脚本的就绪判据不能独立判定转发失败；不是实体灯回执。
4. 将本项目自己的 Studio 输入插件 **23 个经 SHA256 清单校验的文件**，仅首次复制到新目录 `C:/Users/ASUS/AppData/Roaming/Ulanzi/UlanziDeck/Plugins/com.abworks.dshinput.ulanziPlugin`；目标已存在即拒绝覆盖，保存独立部署回执。没有写入配对密钥、创建按键配置或主动编辑原个人配置档，也没有重设原基线。
5. 最后核对：DSH 窗口 1 个、原生 HID 后端 0 个、实际 `UlanziDeck` 进程 1 个。旧辅助检查返回 3906 监听为 0，但后续独立 TCP 检查证明该检查存在漏报，不能据旧读数断言 SDK 缺失；也不能将 CLI 成功外推为输入回调已通过。原状态辅助脚本还曾误用进程名 `Ulanzi Studio`，已改为实际进程名，旧“Studio=0”读数不能直接沿用。

**未完成项**：三键操作会影响当前会话，仍需隔离的空白验收会话；后续检查时设置页已关闭，不在未确认上下文中执行实体 K2/K3。尚未开始本版真实审批操作、录音、实体 K1 灯效或完整输入桥测试。安装／配对步骤见 [开发版快速说明](<quick-start-dev.md>)；以上不是三项硬件全部通过的结论。

## 2026-10-31 就绪后配对与输入链路检查

**执行范围**：用户确认隔离验收会话和 Studio 正常重开后，继续在原 GUI 操作。执行后端为精确作用域的 UI Automation、本项目部署回执 SHA256 校验、只读 Windows PnP／TCP 状态检查；没有网络检索、读取个人配置档、打开音频流或运行新的 HID 探针。

- 明确开始当前会话跟随、连接 Studio 按键桥。末次 GUI 实读为“运行中 · 已转发 0 · 已丢弃 0”和“Studio 按键桥监听中（非设备连接证明）”。此阶段采用空绑定，仅捕获；没有确认或授权实体按键动作。
- 在独立部署目录中首次创建本项目自己的 `bridge.json`：先用 CreateNew 建立当前用户所有、禁止继承且仅当前用户可读写的 ACL，再写入配对值并复核。核验三把独立密钥及闭合配置结构，未将值写到日志、聊天、命令行或本仓库；没有覆盖已有文件。此为配对配置落盘，不是生产者连接证明。
- 只读 PnP 查询发现目标 VID/PID 的正常接口 8 个；旧辅助检查报告 3906 监听和自有生产者均为 0。后续查明端口检查漏报，且进程过滤原本只识别 `service.cjs`、漏掉新增的 `service.js`，因此旧读数不能独立证明 SDK／生产者缺失。当时 Studio 主界面实际可访问控件为“未连接”；接收器枚举成功不能外推设备已连接，也没有新增实体灯效结论。
- 精确打开 Studio 偏好设置中的“插件”页；“添加”实际打开应用市场，并非本地插件文件选择器。未安装市场插件，未切换调试模式、Agent 同步或其他全局开关；已只关闭本次打开的应用市场和偏好设置，保留 Studio 主窗口。
- 只读复核历史自有成功插件：目录名与 manifest UUID 同样不完全一致，且曾直接复制部署；旧版也有 CLI 正常而 SDK 就绪尚未确认的记录。现有证据不能把当前问题归因于目录名或 `.cjs` 扩展名，因而未猜测性改名、重写 manifest 或反复重启。

**该阶段下一步（历史）**：先由用户确认 Studio 主界面是否已连接 AU05；“未连接”有 UI 观测，但 SDK 是否就绪需要独立检查，不能使用上述漏报读数建立因果关系。随后检查生产者加载、捕获真实 ActionID、确认专用绑定，最后集中验收三键和真实审批灯。未开启录音，未回答任何审批，未把捕获桥监听或配对文件当作完整硬件通过。

### 同轮后续：已连接，SDK 就绪尚待独立核实，修正文档化入口

用户随后确认 Studio 已连接 AU05；UI Automation 也实际读到“已连接”。目标正常接口仍为 8 个；当时旧辅助检查的 3906／生产者计数为 0，但后续发现其漏报，不能据此得出“设备连接未使 SDK 就绪”的结论。此前“未连接”已不再是当前状态；设备连接、SDK 可达与实际回调仍需分别验证。

经 agent-reach 路由使用 `gh` 定向读取官方固定提交的 Git 树、README.zh 和 manifest.zh（三次来源读取），[manifest 说明](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK/blob/550ab80c69285ecf259bd494a7fff767c14f0c0f/manifest.zh.md)只明确描述 `.html`／`.js` 入口，其中 `.js` 由 Node 20.12.2 加载；并未说明 `.cjs` 是否支持。[调试说明](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK/blob/550ab80c69285ecf259bd494a7fff767c14f0c0f/README.zh.md)解释的是远程调试，未给出 3906 启动条件，故没有猜开调试选项。

据此增加仅调用既有 `service.cjs` 的 `service.js` 薄启动器，将 manifest 入口改为官方已文档化后缀。原有业务服务没有改写。启动器的被动导入、只启动一次及异常不泄密测试，加既有生产者／桥测试共 **21 项通过**；重建自有源 bundle 为 24 个文件，源检查 155 个文件通过。安装处先核对原 23 文件的部署 SHA256，确认无修改后，仅新增启动器并修改自有 manifest，更新自有哈希回执；未改动旧私密配对文件。此前交付的 dev.2 ZIP 保持不变，并不包含此后续源码修正。

这是对公开加载契约的兼容性修正，**不是 `.cjs` 根因或新入口实机加载成功的证明**。须正常重开 Studio 后观察自有 DSH 分类、SDK 与生产者。再次尝试重新连接捕获桥时，设置组已不存在，辅助程序在首步安全拒绝；后续私密配对轮换步骤未执行，没有盲启按键或录音。待明确重新连接后才为新租约更新配对。

## 2026-10-31 SDK 检测纠错与限时绑定发现

**采集日期**：2026-10-31。**执行后端**：本地独立 Node TCP 连接复核、Windows 只读进程元数据、DSH 自有设置组 UI Automation。网络检索查询数 0；限时发现读取 83 次。复现入口为本项目忽略的 `.local/dev2-studio-link-status-20261031.ps1` 与 `.local/dev2-capture-bindings-20261031.ps1 -Seconds 90`；后者只读取自有插件候选，不确认绑定、不读取配对密钥。

- 用户报告已出现 DSH 分类，并在新专用空白配置中四个动作均可绑定。这是配置能力确认，不是实际按键回调证明。
- 独立 TCP 连接实际返回 3906 可达；修正 `.js`／`.cjs` 过滤后，自有生产者进程计数为 1。同一时刻旧端口检查仍返回 0，证实其存在漏报。现辅助检查改用限时 `TcpClient.ConnectAsync`，不发送 SDK 帧，也不声称已验证监听者 PID。此结果不能证明先前每个时点都可达，亦不能证明 `.cjs` 是根因。
- 为新捕获租约显式轮换本项目自有配对文件；新文件写入前即设置当前用户独占 ACL，旧私密文件以同等 ACL 保留。未记录密钥、修改个人配置或自动确认绑定。
- 一次限时观察实际持续 **90,296 ms / 83 次读取**，结果 **0 个候选，原因 timeout**；`bindingsConfirmed=false`、`actionsAuthorized=false`、`credentialsRead=false`。不能据此断言三键不受支持：尚需确认窗口内是否完成重开与按键，以及生产者是否读到本租约、回调是否到达。
- 观察后已显式断开按键桥并停止跟随，GUI 分别显示“按键桥未连接”和“已停止”。该次任务状态计数为已转发 0／已丢弃 11；此是任务状态转发统计，不能当成 11 次按键丢失。没有开启录音、回答审批或新增实体灯效通过结论。

**未解决**：本轮真实输入回调未建立；K1 实体灯及真实审批灯仍待独立验收。旧 dev.2 ZIP 不包含后续 `.js` 启动器修正，不能将当前安装处变化外推为旧归档已更新。

## 2026-10-31 绑定显示框查找失败排查

**采集日期**：2026-10-31。**执行后端**：本地源代码复核、PowerShell UI Automation 无按键对照、Node 隔离客户端测试；网络检索 0 次。纯观察脚本 SelfTest 26 项、客户端测试 28 项通过。两次完整对照均由一个连续命令打开设置并观察，期间不修改源文件、不要求用户操作。

- 用户后来说明首轮 90 秒未看到操作提示，因此该轮不算硬件输入失败。随后两轮旧观察脚本分别在 48,110 ms／43 次成功读取、45,574 ms／42 次成功读取后返回 `binding_view_missing`；不能将它解释为硬件不支持或整个插件卸载。
- 确认旧脚本在点击读取后保留旧 Group 引用，固定等 300 ms，再把 Edit 数量 0 或大于 1 都归为同一“缺失”。已改为每轮重新定位整个路径、分别报告缺失／重复、最多 3 秒缺失容错，并增加纯存在性观察模式。四项候选判据只检查本次四个唯一 control／key／actionid，不再使用历史并集。同步 UIA 调用仍需外层进程超时保护；按钮重新启用只是完成启发式，不是 RPC 回执。
- 自有客户端源码中的候选读取不会主动导航、关闭设置或移除绑定文本框；框本身无条件渲染。新增隔离测试覆盖读取挂起期间 50 次轮询、关闭重开设置、成功与失败回复，验证框仍存在且未触发动作。此不等于实际 UI Automation 证明。
- 第一次独立存在性探测在开始时设置就已不在 UIA 树中，3,196 ms 后返回 `group_missing`；随后同一连续命令打开设置后观察 **60,155 ms／220 次**，设置／Group／按钮／Edit 始终各 1，无按键、无候选读取。
- 再以空捕获桥进行连续读取对照 **60,041 ms／136 次定位、68 次显示 JSON 校验**，新旧引用对照均未查失，超过此前 45–48 秒区间；未重新配对生产者、未请求用户按键，因此不是实际输入回调通过。结束已显式断开按键桥、停止跟随，GUI 显示已停止且转发／丢弃均为 0。

**结论与未解决**：已修复观察程序的确定性缺陷，修后无输入对照未复现框消失；尚不能证明旧失效全部由旧引用造成，也未确定视图变化的触发条件。真实输入回调、K1 实体灯和真实审批驱灯仍未验收。不再用“显示框查找失败”推断按键硬件失败。

## 2026-10-31 真实输入链路：旧配对服务滞留

**采集日期**：2026-10-31。**执行后端**：自有源码逐段复核、内存 FakeSocket／HTTP fixture、安装处 24 个自有文件 SHA256 检查；网络检索 0 次。未读取私密配对内容或个人 Studio 配置，未要求用户再次按键。

- 确认生命周期不匹配：每次捕获桥连接生成新的端口／密钥，而生产者服务只在进程启动时加载 `bridge.json`，HTTP 闭包仍引用旧配对。旧服务忽略租约刷新失败，SDK 套接字仍可存活，所以“SDK 可达＋进程 1 个”不是当前租约有效的证据。此是可复现代码问题，不是对之前每次实机失败的唯一归因。
- 源服务改为首次或后续租约刷新失败即关闭自身套接字、清理计时器；不监视／自动重载配对、不跨代重绑、不在按住状态丢失后自动恢复。新增 3 个纯内存测试覆盖初始失败、续租失败后禁止恢复、畸形租约与幂等清理；连同既有输入链路测试共 27 项通过，没有真实 SDK 或 HID 操作。
- 更新安装处前校验回执内全部 24 个自有文件且无重定向；仅修改自有 `service.cjs` 并更新该文件回执。更新后全部 24 项 SHA256 匹配，源与安装文件字节一致；服务 SHA256 为 `3b96ac99a82350f66e9303faa9a3baf28118a8abbf2a0355b488a70be5ed25c9`。没有修改私密配对、个人配置或强制结束 Studio。正在运行的旧进程不会因文件更新自动换代码，需要正常重开后验证。
- HTTP Content-Type、Origin、Host、租约字段与时长在两端匹配，未发现格式不匹配。SDK REQUEST／ACK 守卫与历史已成功的自有旋钮诊断一致，未放宽该守卫。

**仍未解决**：候选只保留短时新鲜记录；实际回调若仅带主插件 UUID，空绑定发现能否得到动作类型尚无实机路由证据，不能猜 ActionID 或按坐标推断。输入桥不发送灯效；K1 实体控制未证实，真实审批灯须在真实可回答审批上单独验证。旧 ZIP 和源 bundle 不自动随安装处修正而更新。

**下一步**：先正常退出 Studio，显式建立并配好当前捕获租约，再正常启动新服务；验证新进程使用修正代码且租约有效后，才安排一次真实按键观察。不再仅凭 SDK 可达要求用户反复按键。

### 同轮受控启动：SDK、当前租约与绑定发布实际通过

用户确认正常从托盘退出 Studio 后，实际进程核对为 Studio 0／原生 HID 后端 0。为当前捕获租约显式更新用户独占配对，再以原始参数正常启动已核验官方程序，未强制结束或添加调试选项。新生产者未保持运行；没有要求用户按键，也没有据进程消失猜测具体退出原因。

随后在 Studio 已运行且无自有生产者时，以自有受控诊断服务重新建立当前配对；先校验安装处 24 个自有文件，拒绝重复注册。诊断仅输出固定阶段、命令枚举和布尔值，不输出端口、密钥、ActionID、原始帧或配置内容。实际 **20,029 ms**：SDK 打开 1 次，收到自有动作类型 UUID 的 `add/setactive` 共 8 帧；真实 HTTP 租约成功 **20**／失败 **0**，绑定发布接受 **32**／失败 **0**。20 秒到期只关闭本诊断自己的服务，正常退出 0。

这证实此次真实 SDK → 当前租约 → 捕获桥绑定发布链路工作。实际帧带动作类型 UUID，`code` 缺省，ActionID 存在且 key 形状有效；此前主 UUID 发现死锁假设不适用于这些已观察帧。它仍不是实体按键按下／松开／旋转、DSH 动作或灯效通过；全程未确认动作绑定、未开麦、未回答审批。

### 2026-10-31：120 秒真实按键回调通过（不等于动作或灯效通过）

**采集日期**：2026-10-31　**执行后端**：已校验安装文件的自有受控 SDK 服务、现有 DSH 按键桥；前台有界运行。**执行次数**：1 次 120 秒窗口。复现方式：`.local/dev2-prepare-trace-20261031.ps1 -RunAuthorized`，随后 `node .local/dev2-trace-service-20261031.cjs --run-authorized --seconds 120`；两者均需明确启用且拒绝已有自有生产者，不能盲目重跑。

用户确认准备后，在 Studio“预设文件1”按规定顺序操作。实际 **120,034 ms**，SDK 打开 1 次，SDK 帧共 21 条；租约成功 **119**／失败 **0**，绑定发布接受 **82**／失败 **0**。收到 K1、K2、K3 的 `keydown/keyup` 各 **1/1**，旋钮 `dialdown/dialup` **1/1**、`dialrotate` **2**。诊断未记录左右方向值，因此这里只确认两次旋转回调，不能单独宣称左右方向校验通过。

这次证明本机当前版本、模式和该专用配置下，四个控制的真实回调可以进入自有服务；不能泛化为所有模式/配置。全程 `actionsAuthorized=false`、`credentialsLogged=false`，未确认绑定、未录音、未提交消息、未回答审批。诊断正常到期并关闭自身 SDK 连接、退出 0。随后通过现有 GUI 明确断开按键桥并停止跟随，后验显示“未连接”及“已停止 · 已转发 3 · 已丢弃 0”；这 3 是会话事件，不是按键计数。

**仍未解决**：真实回调→正式绑定→DSH 动作的端到端操作，以及 K1 实体灯和真实审批驱灯尚未验收。当前运行上下文禁用审批提示，不能用伪造 `PermissionRequest` 冒充真实待审批场景；Studio Task Hooks 没有已验证的 K1 控制接口。

### 2026-10-31：直连 K1 人工灯效未通过及只读核对

用户从托盘退出 Studio 后，实际核对 Studio 进程 **0**、直连 native **1**。首次连接显示“已连接／灯光：运行中 · 配置回读一致”，语音当时为 Off。用户随后手动配置语音和实验性开关，并按指引操作 K1，反馈 **K1、其他按键、旋钮全部不亮**；据此记录本轮实体灯效未通过，不以配置回读替代目测。

用户要求核对后，只读 UIA 和进程检查确认：连接“已连接”；“DSH 内置语音”单选为 true；“启用语音”“灯光反馈”“实验性 K1 录音灯配置（未验证实体灯）”三个开关全部 On；Studio **0**、native **1**；语音显示“按住按键1说话”（ready，而非正在录音）。灯光先显示“待命 · 已提交，未回读”，随后实际运行期间显示“运行中 · 已提交，未回读”。本轮核对未操作控件、未打开麦克风。

**代码能够确定的原因边界**：待命且无可答提示时请求四零，反馈 On 不等于常亮；K1 只在真实、聚焦、非准备中的 DSH recording 才请求通道 0 呼吸，本次开关确实已 On，不能归因于用户漏开。“已提交，未回读”对应已有原始快照后写入，写后 GET 在 500ms 内没有取得匹配回复；同向量不自动再读，可能长期保留 written。连接正常不代表灯光确认成功。配置匹配本身也不是实体光学确认。

**仍未确定**：未同步采集此前按住 K1 的那 5 秒实际 recording 状态及请求四通道，不能倒推当时是否发送非零；当前非零语义状态的实体全暗也没有被可靠配置回读解释。尚不能在“录音条件未成立／后续被四零覆盖”“写后 GET 回复缺失”“配置与实体输出控制存在额外条件”之间定因。不猜改 focus、global mode、workTime 或私有指示灯参数；下一步若继续应先观察请求状态、四通道、requestId、结果的同步时间轴，而不是再盲目录音或反复切灯。

### 2026-10-31：同步诊断基线明确命中原始快照保护

用户授权同步抓取后，增加有界 `lightTrace`（内存最多 32 项）和只读诊断视图：客户端记录请求时的录音阶段、准备/聚焦条件、预期四通道；Host 记录实际发送的四通道、requestId、时间和同代匹配结果。严格 RPC 校验、界面元数据隐私及现有行为合计 **123 项模拟测试通过**；不增加 HID 请求或重试、不改变灯光协议参数。

先关闭语音并断开，经官方管理页重载组件，重新连接建立无录音基线。只读采集 **15 秒**、语义变化日志 **1 条**，明确为新的连接：客户端 `running/[0,0,2,1]`、有目标且聚焦、反馈 On；Host `requestId=1` 实际请求同一非零向量，**1,753 ms** 后 `failed`，理由 **`snapshot_unavailable`**。该时窗 `sawRecording=false/sawK1Request=false`，重载重连后的实验性 K1 为 Off、语音 Disabled，不能拿这些复位值推翻此前已核实的三个 On。

**直接定位（仅本次新连接）**：原始快照未取得，安全保护在目标灯光写入前阻断，因此这次即使请求 K3/旋钮非零也不会写灯；无需为了证明这一点再次开启麦克风。日志不含音频、文本、owner、会话标识、原始 HID 或配对秘密，保存在本地忽略目录。**尚不能定因**：快照为什么未到达或未匹配仍需接收侧元数据；此前 `written`/`verified` 的其他连接不能据此追溯为相同原因。未绕过快照保护，未猜改参数。

#### 同一轮单次重连接收统计：已收到帧，但未匹配快照头

在既有 GET/读取分支增加固定计数，不增 GET、重试或重连策略；`result.readback` 为 10 字段闭集，不保留原始报文、解密字节或标识。Native 纯 C# SelfTest 已验证无回复、其他帧、长度/外层/头/模式分类、匹配、超时、饱和及副本隔离；父端 **139 项 Host/客户端测试**、采集器 **15 项纯解析检查**通过。

用户确认切回验收界面后，经官方管理页确认组件 Off→On，**只连接一次**，全程语音 Off。读取视图曾因详情折叠及硬编码窗口标题未定位成功；修正本地只读采集器为新鲜、唯一 DSH PID/窗口句柄后，读取的是**同一连接保留的请求 1**，没有为了采集重试 GET。实际 15 秒、2 条语义记录（仅聚焦状态变化），均显示：

| 初始快照统计 | 实测 |
| --- | --- |
| stage / attempts | initial / 3 |
| getWritesCompleted / timedOut / matched | 3 / 3 / 0 |
| readsWhilePending / shortReads | 2 / 0 |
| outerRejected / nonMatchingHeader / modeRejected | 0 / 2 / 0 |
| 实际请求 / 结果 | running `[0,0,2,1]` / failed `snapshot_unavailable` |
| 请求至结果 | 1,775 ms |
| 录音 / K1 请求 | 均无 |

**定位边界**：本轮确实有 2 帧进入接收与分类路径，且长度、外层头未被拒绝；但不符合既定灯光快照头，3 次 GET 等待都没有匹配结果。因此本轮阻断在**快照查询／应答匹配层**，之后按保护不写目标灯光。`nonMatchingHeader` 包括其他正常输入/心跳，**不是“两个错误快照”**；计数不证明设备未处理 GET，也不排除等待窗口之外的回复，更不能据此猜改命令或放宽解析。为何没有期望快照、此前 `written`/`verified` 场景为何实体灯仍暗，仍未最终定因；**灯效未修复，物理验收未通过**。

采集后显式断开：界面未连接、语音 Off，nativeCollectors=0、Studio=0；无额外麦克风操作、强制终止、个人预设写入或秘密回显。原始诊断元数据仅存本地忽略目录；原发布 ZIP 未重打包。

### 2026-10-31：快照匹配与初始化差异核查（尚未完成硬件因果验证）

**采集日期**：2026-10-31　**执行后端**：agent-reach GitHub / `gh api`，固定提交 `f7c89385416e626a9c6c0c9d674153a9f4af6112`；本地代码及已保存官方静态片段只读核查。**执行查询数**：检索 0 次，定向 GitHub GET 18 次（父流程 13 次、隔离探针子流程 3 次、对照后只读初始化审计 2 次）；旧 `Sources/vibed/DeviceLighting.swift` 返回 404，随后按同一提交的真实目录读取，未擅自换成最新版本。复现入口：`gh api repos/ihavespoons/vibed/git/trees/f7c89385416e626a9c6c0c9d674153a9f4af6112?recursive=1`。

以下是**社区实现的单源代码证据，不是官方固件契约**，正文均于 2026-10-31 实取：

- [Requests.swift](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Requests.swift#L199)：实际 GET 构造是 device / `0B` / `88` / read，回复 operation 为 `11`，与本地查询一致。修正此前历史链接：该提交应查 `Sources/VibeKit/`，不能声称不存在的旧路径本轮已核实。
- [Frame.swift:54–65](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Frame.swift#L54-L65) 与 [Requests.swift:30–41](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Requests.swift#L30-L41)：对照匹配命令组低 4 位，且不额外要求 fromMic；本地还要求 bit7 与完整 group 字节。尚无本机证据表明此前两帧属于被额外限制排除的灯光回复，因此**未放宽生产匹配器**。
- [VibeSession.swift](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/VibeSession.swift#L231-L263) 明确在 authenticated 后才 pump 请求；[Requests.swift](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Requests.swift) 构造接收器随机挑战，[Messages.swift:153–156](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Messages.swift#L153-L156) 验证回应。**本地原生后端没有等价认证初始化**，当前只发软件在线和心跳。这是已确认的初始化差异，但尚不能从软件差异直接推出固件必然拒绝未认证 GET。

本地核查排除了几个不成立的解释：合法 64 字节外层恒解出 56 字节，最新两帧并非快照长度不足；拒绝发生在 global mode / 四记录检查之前；pending 在发送 GET 前建立；4 字节逻辑命令实际填充并发送为完整 64 字节 HID。已保留官方静态取证只有任务灯 wrapper，没有 GET 构造与回复解析，不能伪称官方已证实此处差异。

安全诊断增加固定七类 `headerKinds` 计数（无原始字节、身份、音频或秘密），仍保留旧匹配器与快照写前保护。Native / Host 定向离线测试 **74/74**，本地诊断解析器 **20/20**；未因这些测试操作设备。用户明确同意下一次限时“认证前后只查快照”对照；实际执行与因果结论待后续记录，不提前宣称根因或灯效修复。

### 2026-10-31：单次认证前后快照对照（实机，未写灯）

用户明确选择“进行一次认证与快照对照”。隔离探针默认仅纯模拟；父流程复核并重跑离线模拟通过后，**仅一次** `-RunAuthorized`，同一独占连接、前后均最多 3 次既有 GET／每次 500ms／间隔 80ms，中间一次随机挑战应答。未改生产匹配器，也未自动重新连接。探针冻结 SHA-256：`94909c38ef45659e5c5afdb8adbbba798a53b4ccb0a6744eb10c8a9694c4b8ce`。

| 实际项目 | 认证前 | 认证后 |
| --- | --- | --- |
| GET 完成写入／等待超时 | 3 / 3 | 3 / 3 |
| 原生产匹配器匹配 | 0 | 0 |
| 放宽 relay/group 限制、仍保留 payload 模式保护的诊断匹配 | 0 | 0 |
| 等待中收到／非匹配头 | 2 / 2 | 2 / 2 |
| 非匹配帧类别 | dongle 2，其他 0 | dongle 2，其他 0 |
| 短帧／外层拒绝／模式拒绝 | 均 0 | 均 0 |

认证本身：写入 1 次，收到且校验通过 1 次，无认证超时。整个实际进程 `complete`、exit 0；GET 合计 6，online/offline 各 1、heartbeat 4；`readerStopped=1`、`streamClosed=1`、`cleanupFailed=0`、`ledWrites=0`。结束后独立进程预检确认 Studio / native / 其他探针均为 0；未打开录音、未改预设、未回显挑战值或任何私有配置。结果仅在本地忽略目录保留。

**本轮结论与限制**：接收器 HID 与认证往返已实证可用，但等待窗口内没有收到可识别的设备灯光快照。认证前后看到的两帧是接收器类型，不是缺 relay/group 标记而被原匹配器误拒的灯光回复；因此**本轮没有放宽生产匹配器的依据，也不支持“补一次认证即可恢复快照”**。不同于完全没收到数据，阻断进一步收窄到接收器通路之后的设备查询响应链路。

仍不能冒充最终根因：没有验证接收器之后的设备在线／转发状态，且本对照保持软件 online 在认证前发送，未检验“认证成功后才发 online”的完整启动顺序。不存在事务 ID，亦不能完全排除跨等待窗口的晚到回复。后续固定提交的两文件只读核查确认：`VibeSession` 的连接回调只清认证状态，认证后才进入心跳和请求队列；但未找到高层 software-online 调用者，不能把必要顺序当作已核实事实。`Requests.swift:98–99` 的 `deviceActive` 是“mic 是否 linked”的只读状态查询，不是 relay-enable 初始化写，两个文件也没有认证后自动调用它。当前收到的接收器类型帧没有保存 command，不能追认为 heartbeat 或 deviceActive 回复。

下一项最小测量可选择接收器到设备的 linked 状态只读查询；另一独立实验才是只改变 online 位于认证之后的顺序，不能把多个变化混作单因果证据。**超时未修复、灯效未验收**；本次授权的一次硬件对照已结束，不自动补做其他命令试探。

### 2026-10-31：按键实测通过后，恢复独立灯控修复

用户确认直连 K1（DSH 内置语音长按输入）、K2、K3 及其已测试的普通按键逻辑正常；不将其扩大为所有 Studio 路径、真实审批或每一种旋钮模式的验收。用户随后明确选择继续修复灯不亮，而非仅重开反馈开关。诊断先关闭语音并暂断直连；不改已验收的按键解析、会话动作或个人 Studio 配置。

**采集日期**：2026-10-31。**执行后端**：本地隔离有界探针、固定提交 GitHub / gh；本轮父流程 5 次只读 GET（1 树、4 源文件），只读审查代理 4 次 GET（其中 1 次旧路径 404）。来源仍是社区 MIT 实现，不冒充官方固件规范。

- [Frame.swift](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Frame.swift)、[Requests.swift](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Requests.swift)：核实完整填充、加密与 GET 构造，没有找到隐藏的额外请求位。取到日期：2026-10-31。
- [VibeKey.swift](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/VibeKey.swift)：`requireMic()` 使用只读 `deviceActive` 确认 linked；没有把它解释成设备配置写。取到日期：2026-10-31。
- [VibeSession.swift](https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/VibeSession.swift)：默认请求窗口 3 秒，认证后泵送请求，重发间隔 100ms；本轮诊断未照搬其持续重发。取到日期：2026-10-31。

实际测量（不含纯模拟）：

| 诊断 | 结果 | 解释边界 |
| --- | --- | --- |
| 认证后才发 online，再做原 500ms 查询 | 认证通过；3 GET 全超时，均无灯快照 | 改变顺序本身尚未修复；相比先前也移除了认证前 GET，不能算严格单变量 |
| 认证后仅一次 `06 03 0A 01` linked 查询 | `linked=true`，1 请求、1 回复、无超时 | 只证实该次接收器报告主设备联机；无 online/offline/心跳或灯写 |
| 认证后 online，单 GET 3000ms | 原严格匹配器与掩码诊断均匹配 1，GET 1、无超时 | 首次读到有效快照；未写任何灯，不等于实体灯修复 |
| 同一路径再次单 GET 3000ms | 严格匹配 1，应答约 40ms | 不能声称必须等超过 500ms |
| 再用原 500ms 窗口 | 第 1 GET 严格匹配，应答约 33ms | 进一步否定“单纯把超时常数加大就是唯一根因”；初始化与设备暂态仍混杂 |

上述各探针均 `selfTest=false`、正常结束、`readerStopped=1`、`streamClosed=1`、`cleanupFailed=0`、`ledWrites=0`。未保存/回显原始帧、设备身份、挑战值或音频。新包装器保留原始快照匹配保护；默认仅纯测试，显式参数才打开设备。linked 探针的 5 个模拟场景另行通过，不与真机结论混算。

**当前实施方向，尚非实体灯验收**：补齐一次认证与明确 linked 确认，再沿既有 online/心跳和原灯态保护路径执行灯控；保守采用已实测可用的有界快照等待，而不宣称时限是唯一根因。认证/联机/快照未确认必须阻止目标灯写，不能把输入路径一起杀掉。保持按键与配置不变，待新生产路径实测配置回读和人眼灯效。

#### 生产路径接入后的首轮结果：未通过，继续定位

Native 已加入有界认证、linked 确认与原灯态快照门禁，仍保留原按键解析。原生 13 项测试通过；父复核发现初始化未做 GET 时 `attempts=0` 不能送入原 Host 正数 codec，已改为省略该可选 readback，而非伪造次数或放宽协议。纯 JSON 序列化、自测与 Host/device 回归补测通过。

实际 GUI 重连后仍是 `snapshot_unavailable`；本地 `k1-sync-77a93f28-9640-4600-9431-510c1968b8a4.jsonl` 的 request 35/36 均失败且无 readback，说明新的认证/联机门禁没有确认，不是新 GET 已等满 3 秒。另用只输出布尔和源码摘要的进程检查核实：唯一 Native 进程使用预期仓库路径、在源码写入后启动，参数含 `-EnableLights`，源码 SHA 为 `87d080950977a39046404c429dc79888981c8a73a5361ce489ac1ee08d8354ae`。不将这轮描述为已恢复灯效。

只读对照又发现一项具体差异：成功隔离探针在 HID `WriteAsync` 后不调用 `FlushAsync`，生产路径额外调用它，并把写/flush 异常统一视为该初始化未确认；纯模拟的 Flush 先前总返回完成，未覆盖此差异。已完成这一项单变量实测：移除 Flush 后，真实 request 40 仍在约 27ms 内失败、无 readback（`k1-sync-4b62993e-a5a6-4e81-89fe-ed84948be171.jsonl`），因此不能以 Flush 解释本轮门禁失败，也不能称已修好。无 Flush 路径的纯模拟验证覆盖了 Flush 若抛异常仍不应被调用，并保留了完整认证、目标写入与精确恢复流程。下一步仅观察正式 Native 自身初始化的认证/linked 状态，不发任何目标灯光命令。生产连接已再次断开，语音关闭。

#### 正式 Native 有限诊断：本轮直接阻断点是 linked=false

随后只增加显式 `-TraceInitialization`，默认不开启；stdout/Host codec 不变，stderr 仅一次封闭 `au05-light-init-v1` 元数据。纯 SelfTest 和针对性回归 4/4 通过；父另测普通 client 86 项通过。

父运行正式 Native `Connect -EnableLights -TraceInitialization`，只等待 10 秒后发送正常 stop，**没有发送任何 lights 命令，也没有开启录音**。实际结果：

| 阶段 | 写入完成 | 合法匹配回复 | 待应答期间读取数 | 结果 |
|---|---|---|---:|---|
| auth | true | true | 1 | matched |
| link | true | true | 1 | linked_false |

stdout 已 ready，stderr 无未知行，子进程 exit 0、未强制终止。独立清理检查 Studio、正式 Native、其他探针均为 0。

这轮可以明确：**正式路径认证已经成功，但接收器的合法联机查询回复未确认本体联机；快照 GET 因该门禁未执行**。因此不能继续把本轮写成快照匹配超时，也不能声称移除 Flush 已恢复灯效。`linked_false` 仅描述收到的设备状态，不能自行推断休眠、关机或配对丢失；此前独立查询曾返回 true，需对照当前本体状态再复测。原先 500ms 失败、3 秒及随后 33/40ms 成功的原因也不能因此追溯定案。

#### 用户确认本体唤醒后：正式任务灯配置与实体状态均通过

用户随后确认本体已唤醒并连接，要求立即复测。独立初始化探针被 `nativeCollectors=1` 的独占前置检查拦住，**没有再打开 HID**；读取现有 DSH 面板发现已连接、语音关闭、灯光反馈开启且显示配置回读一致，因此保留该连接，仅采集已有诊断。

实际 `k1-sync-a979603f-4ca9-405e-815e-f8dc93526a27.jsonl`：request 41 `attention [0,2,2,0]` 于 1793457399816 请求、1793457400382 verified；request 42 `running [0,0,2,1]` 于 1793457403938 请求、1793457404527 verified。两次均 `post_write/attempts=1/getWritesCompleted=1/matched=1/timedOut=0`，无短报文、外层拒绝、非匹配头或模式拒绝。

随后用户对实体观察明确选择“任务灯已亮，且会随状态变化”。据此本轮 **K2/K3/旋钮任务灯恢复获得配置回读及用户实物两层证据**；这不是仅写入成功。不能把前面的 linked=false 直接归因为休眠：中间等待期间连接和设备状态变化未完整记录。初始化门禁、严格原快照和按键保护继续保留；没有放宽匹配、伪造应答或无原快照写灯。

该日志 `voicePhase=disabled`、`experimentalK1Lamp=false`，因此 **没有 K1 录音灯验收证据**，也不是特权工具真实审批的专项验收。旧 dev.2 ZIP 未重新打包，当前真机效果属于工作区运行版本。

#### K1 同步真机测试：录音与配置回读通过，实体时序不通过

用户手动选择 DSH 内置语音、开启语音/灯光反馈/实验性 K1 灯；只读检查核实三开关 On，父未自动开启录音。明确发送 60 秒测试说明后，用户自行长按/松开 K1；采集器仅状态元数据，得到 `k1-sync-a96c7c15-1a28-45aa-a2c2-a7ff9086f3af.jsonl` 共 23 行，`sawRecording=true/sawK1Request=true/recordingRequestResults=[verified]`。

以第一条采集时刻为相对零点，去重后的 K1 开/关请求如下（秒）：

| K1 开 request | 请求 | verified | K1 关请求 |
|---|---:|---:|---:|
| 47 | 3.748 | 4.268 | 6.695 |
| 49 | 11.121 | 11.637 | 13.429 |
| 51 | 14.479 | 14.993 | 17.407 |
| 53 | 21.410 | 21.934 | 30.501 |
| 55 | 32.624 | 33.123 | 33.901 |

开请求均为 `recording [2,0,2,1]`，关请求为 `running [0,0,2,1]`，均 verified；实际观测 recording/preparing=false/focused=true 与请求相符。中间存在 transcribing/ready/error 阶段，但没有采集文本、音频或错误详情，不据此归因语音功能故障。

用户实物反馈：“按住和按下的时候都不会亮或者呼吸，但是松开的时候会亮一下然后熄灭”。**K1 实体验收不通过**。其中 request 53 在录音阶段内已 verified，并持续约 8.6 秒才发关灯请求，不能解释成软件只在松开后才下发开灯指令。当前只缩小到 K1 配置与实体输出/按住状态的关系，尚不能确定固件覆盖、硬件通道含义或其他机制；禁止把 verified 写成 K1 已修好。

已恢复且用户确认的 K2/K3/旋钮任务灯与本次 K1 异常分开记录。下一步若获用户同意，可做一次明确标注、不录音、不按住 K1 的有界单灯对照；本段没有执行该对照，没有猜测修改 0x24、通道编号或其他协议字段。

#### K1 单灯对照：用户确认完全不亮；恢复正常 DSH 连接

用户明确授权不录音、不按键的 5 秒 K1 单灯对照，并多次要求因未看清而重做。使用本地有界工具 `au05-k1-only-test-20261031.mjs`，只发送一次 `[2,0,0,0]`；正常 Native 仍先认证、确认联机、读取原灯态，verified 后才计时 5 秒并发送正常 stop。未确认配置或独占检查不通过时不启动 5 秒观察，不将这些拦截计作实体灯测试。

最后一次成功执行记录：verified、holdMs=5001、elapsedMs=7936、inputCount=0、childExitCode=0、forced=false、recordingStarted=false；原灯态恢复仅为正常流程已尝试，未声称独立回读确认。用户此后明确反馈“完全不亮，所有的灯都不亮了”。所以 **K1 在没有长按、没有录音的对照条件下也未通过实体验收**，不能把此前异常仅归因为长按覆盖；配置回读仍不等于实体输出。

该对照向量把 K2/K3/旋钮临时设置为 0，且测试结束后 DSH 原连接尚未重连。因此用户观察到全暗不能单独证明另外三灯也已失效。父停止重复对照：确认 Studio/Native/其他探针均为 0，打开已有 AU05 面板，关闭语音，再恢复正常 DSH 连接。后置面板已确认“已连接 / 灯光：运行中 · 配置回读一致”，灯光反馈 On、语音 Off。后续用户明确确认：会话进行时旋钮亮、K3 呼吸，会话输出结束后全灭；这给出恢复后旋钮/K3 的实体反馈证据，不再把当时全暗当成任务灯损坏，也不是特权审批专项验收。K1 仍为实体不通过，未宣布修复。

#### K1 后续排查：先区分模式设置与录音执行

用户要求继续修复 K1。只读复核固定 MIT OpenVibeKey `c6466fd4687da612c9c52b006399f87148903727` 的 `VibeKitDevice.swift` / `VibeVM.swift` 及既有本地探针：`0x24` 对应该社区应用的 `micUiFlick` 可读写模式；调用者为设置/档案重放，不是已证实的录音开始/结束执行链。既有本地 `led-probe.ps1` 没有认证路径；此前“设置回读未改变”不能排除当时初始化缺失，但也不能据此认定认证后一定能写入或点灯。

下一步仅准备一次认证、联机检查后的固定 `01 06 24 01` GET-only 查询，区分 disabled/enabled/unsupported/timeout；默认离线自测，显式授权才访问硬件。不重放旧 SET、不操作麦克风启用、不把读到配置当作 K1 物理控制已成立。若涉及新的设置写入或真实录音对照，另行明确范围与原状态恢复验证。

#### 2026-11-01：正确初始化后的独立录音指示查询读到 disabled

用户单独允许“认证→联机确认→读取录音指示开关”，不允许本次设置写入/录音。只在忽略目录新增 `au05-mic-ui-read-20261031.ps1`，固定已审查的 auth/link/native SHA，复用独占接收器与 caps 检查；包白名单仅一次 Auth、一次 linked GET、一次 `01 06 24 01`。默认为纯 FakeStream 七场景，显式授权才进入硬件。严格回复匹配 masked type=1/group=6/command=0x24/op=0x11/body>=5，原字节 0/1/其他分别分类 disabled/enabled/unsupported，不把未知字节压成布尔。

父复核抓到并修复探针自身的授权转发错误：dot-source 构建器的 param 重新绑定开关为 false，导致第一次显式调用只执行离线自测（selfTest=true/hardwareAccess=false），没有访问设备。保存 `requestedLive` 并明确传递给构建器和最终入口后，默认七场景仍通过；随后唯一实际硬件调用明确 selfTest=false。未把最初自测输出算作真机结果，未修改生产文件。

实际结果：status=complete；Auth attempts/write/matched/reads=1，拒绝/超时=0；linked=true，linked GET/read=1、超时=0；mic GET=1、matched=1、超时=0、**value=disabled**。Online/Offline/Heartbeat/LED writes 均为 0；readerStopped=1、streamClosed=1、cleanupFailed=0。没有 SET、音频、档案或原始报文输出。

前后均从自有面板操作，先关闭语音并断开 DSH；探针退出后独立确认 Studio/Native/其他 probe 均为 0，再恢复正常 DSH。面板已确认“已连接 / 运行中 · 配置回读一致”，语音 Off、任务灯反馈 On。该 disabled 是当前配置事实，不能倒推是何时或由何者关闭，也不证明写成 1 就能点亮 K1。下一步新的设置写入必须单独授权，先保留原值、SET 后独立 GET，结束独立恢复并回读，不改变已通过的任务灯和按键路径。

#### 2026-11-01：可恢复 0x24 设置对照仍未确认开启

用户另行允许保存原值、临时设置 1、独立回读、结束恢复原值并独立回读；准备在既有叭哥说/AU05 上由用户手动录音，工具不录音、不转写、不发快捷键。只新增忽略目录 `au05-mic-ui-compare-20261101.ps1`，默认 9 个 FakeStream 场景通过，包括已开启不写、未知值拒写、SET 可能生效但抛错仍恢复、回读超时仍恢复、恢复失败明确报告。最终源码 SHA `eb97b0d320eb687c8d026c1e4eb362f0a5f82ba119709477c0a50e2c9da92cb6`。父复核要求删除新执行器未维护的继承诊断字段，换成专用 21 字段 JSON 并实测序列化，避免虚报计数。认证和每次 GET 的总预算固定；触碰前保存原值，SET 前标记 touched；恢复用独立 4 秒 token；操作软上限 32 秒、进程硬上限 45 秒；不发送 Online/Offline/Heartbeat/0x88/0x43/0x2A。

第一实际调用：Auth matched=1，但 linked=false，故 `setAttempts=0/micGetWritesCompleted=0/holdMs=0`，未改设置、未开始观察；已关闭流并恢复 DSH。用户保持本体唤醒后明确允许立即重试。

第二实际调用：Auth matched=1、linked=true；原值 disabled，SET1 一次后独立 GET 仍为 **disabled**，因此 `enable_unconfirmed`、holdMs=0，**未进入 15 秒启用态观察**。随后发送原值恢复一次、第三次 GET 比较确认 `restoreVerified=1`。统计：mic GET=3、setAttempts=1、restoreAttempts=1、discarded=2（未分类，不能当已知 ACK）；readerStopped=1、streamClosed=1、cleanupFailed=0、ledWrites=0、audio=false。

结论限定在本次无 Online 的已认证/已联机条件：该社区 SET 没有获得开启回读确认，不能当 K1 已启用，也不能认定所有固件条件下 `0x24` 都无效。没有原始回复/错误语义，未确认两个丢弃帧含义；没有猜试其他操作码或值。两个调用后均独立确认无 Studio/Native/其他 probe 遗留，再恢复 DSH：已连接、运行中配置回读一致、语音 Off、反馈 On。下一步只读核对官方设置构造/调用门槛，不扩大硬件写入。

只读复核（2026-11-01，agent-reach / GitHub 固定提交，子代理实际获取 3 个源码，另有 1 次猜路径 404 后目录定位；目录定位请求计数未单独回传）：[VibeKitDevice.swift:172–176](https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/native/VibeKit/Sources/VibeKitHID/VibeKitDevice.swift#L172-L176) 确为 `01 06 24 02 [0|1]`，与本次工具一致；[Frame.swift:9–32](https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/native/VibeKit/Sources/VibeKitCore/Frame.swift#L9-L32) 直接构造、加密，无操作码转换；[VibeKitHID.swift:61–129](https://github.com/palaemonboy/OpenVibeKey/blob/c6466fd4687da612c9c52b006399f87148903727/native/VibeKit/Sources/VibeKitHID/VibeKitHID.swift#L61-L129) 的 open/send 内没有自动 Auth/Online/relay，send 只检查 OS 输出返回而非设备 ACK；其 request 匹配也不严格检查操作方向或事务 ID。因此不能拿该社区实现证明任一 SET 已被设备接受，也没有证据支持改试 dir=04。未找到精确官方 SDK 构造摘录，当前固件是否还要求其他初始化条件保持未知；不把未确认开关并入常驻插件。

## 2026-11-01 官方 K1 专用接口与初始化静态追踪

**问题与判据**：用户要求继续找官方 K1 录音灯触发调用和初始化条件。不再将社区注释、SDK 返回 true、通道 0 配置回读或普通插件 connected 当实体灯通过。判据分别为：官方 SDK 的实际命令构造和发送链；Studio 录音开始/结束是否实际调用；初始化守卫及其语义；实体结果需另行受控验证。本轮仅静态读取，无供应商 DLL 加载/执行、HID、录音、设置写入或生产逻辑修改。

**采集日期**：2026-11-01。**执行后端**：agent-reach / GitHub `gh api` 与 Jina；本机 PE 解析、Capstone 对安装文件 read_bytes。公开调研可计：显式官方 GitHub GET 24、Jina GET 3（商品页 2、状态 FAQ 1），另 `gh search repos` 1（底层请求数未知）、Exa 1、check-update 1。一次 GET 后接不存在的 Select-String 导致 broken pipe，GET 已发出且计入；纠正后重取也计入。静态子代理的逐条命令数量未独立记录；父另用固定 SHA 脚本从正确函数起点独立复核。最初从指令中间起解码的片段不采用。临时工具不打包，官方二进制不复制进仓库。

### 公开官方边界

- [当前状态 FAQ](https://docs.ulanzistudio.com/vibekey/en/faq/codex-claude-status.html) 实际正文仍有 `Key K1: Voice input status. It breathes while listening and is off in other states.`，但没有函数、HID report 或认证/Online/麦克风启用组合。商品页正文未出现该句不代表 FAQ 已取消承诺。
- [官方 Node Cmd 类型](https://github.com/UlanziTechnology/plugin-common-node/blob/9e478b2586a4ebdadbd590fc8f80519df18a8d32/apiTypes.d.ts#L12)、[HTML Events](https://github.com/UlanziTechnology/plugin-common-html/blob/0aeb6a26b43cd45b8a5426689ca6e59c1a36b43d/js/constants.js#L6-L42) 没有 K1/mic/record 灯专用命令；其 `state/setState` 是动作图标状态，不能当录音状态。[Node connect](https://github.com/UlanziTechnology/plugin-common-node/blob/9e478b2586a4ebdadbd590fc8f80519df18a8d32/libs/ulanziApi.js#L23-L53) 只注册插件 WebSocket，不等于设备 SoftwareOnline。
- [OpenCodexMicro 的 mic/ACT10](https://github.com/UlanziTechnology/OpenCodexMicro/blob/7488f14106b0c67bb682575215f8582b1c31141a/src/bridge/codex-cdp.mjs#L43-L49) 是另一产品的 Codex 软件事件，不是 AU05 灯指令。官方 SDK README 提供开发咨询 ustudioservice@ulanzi.com，但不据此声称已获厂商答复。

### 新增：Windows 官方 SDK 发送链，而非社区猜测

实际 SDK 已定位为安装文件 `C:/Program Files (x86)/Ulanzi Studio/Ulanzi_Studio.dll`（PE 原导出模块名 kwdm.dll），SHA256 `2e37239e7bd6cc7a9bf0395eae05aa9892b1544a6dace45d9f009b7bc131bd48`；不是需要继续寻找其他设备 DLL 的转发壳。x86 对应原名 kwdm_x86.dll，SHA256 `564d26bbabdf22a3caae046af86ed9a2fa2174bb1fa9cfbbf7b16bafae5fe025`。SDK 与 Studio 属安装证据，不是厂商公开源码。

- 导出 `setDeviceMicrophoneUIFlickMode`，x64 RVA `0x4F0B0`，于 `0x4F148` 调用内部 `0x163C0`。后者 `0x1649C–0x164B8` 从零初始化数据构造明文前缀 **`01 06 24 00 <mode低8位>`**；队列消息类型 `0x52`，超时字段 `0xBB8`（3000），数据容量 `0x7E`。这是与此前社区 `01 06 24 02 ...` 的实际差异；不能继续把社区 SET 当官方一致格式。
- `0x1658B → 0x3E760` 入设备发送队列。worker `0x3E9A0` 从 device+0x110 队列取当前对象，`0x3EA43–0x3EA63` 将 payload 拷到 transport+1；`0x3EA90` 填 report ID。device+0x54==2 时 `0x3EAA9 → 0xEF10` 对块作 TEA 变换，否则不加密；这里未见统一把操作字段 `00` 改成 `02`。
- `0x3EABF → 0x3E1E0` 最终适配层只分配/清零/按长度拷贝，于 `0x3E348` 间接调用 IAT RVA `0x8C168`。父独立解析导入表确认是 `KERNEL32.dll!WriteFile`，并独立解码上述完整函数；发送前这段没有额外操作字段改写。结论是官方这条静态实现保留 `00` 明文语义，条件性整块加密；尚未运行时测量 AU05 对象的加密分支或报文。
- 不能由函数名断言 mode=1 已能点亮 K1，亦未证明它是瞬时录音状态而非模式配置。没有导出 `getDeviceMicrophoneUIFlickMode`；此前候选内部 `0x16170` 实际是命令 `0x2C`，不能误命名为 `0x24` getter。

### 已证初始化守卫与尚未闭合的录音调用

- 导出包装器在 `0x4F0C9/0x4F0DB` 检查全局 SDK 已初始化标志 RVA `0xB0B88` 和 manager 指针 `0xB0B80`，缺任一返回 false。sdkInit 的初始化路径分别设置这些位置。
- 内部先通过 `0x1B440` 由设备标识解析对象，失败返回 false。device+0x2D0>0 且 +0x2D5==0 时先调用 `0x3E5F0(device,0x43,0x35640())`，这段字段/操作的语义仍未知，不能冒充已证认证或联机条件。
- 入队函数检查 device+0xC8，最终发送还检查可写标记、合法句柄和非零长度。尤其入队失败可被静默忽略而 setter 仍返回 true，因此 SDK true 仍不等于已发出，更不是灯已亮。
- Studio EXE SHA256 `85896a993e758689990f64d94c726e2c23234ed0e48c9176e6e9a30b2f8a05ca` 的 `DialDeviceManager::DialDeviceManager`（`0xBE600–0xBEEEC`）确实加载 Ulanzi_Studio.dll，并解析 sdkInit 等函数；该构造函数解析表没有 UIFlick/MicrophoneEnable，只见 MicNRLevel、AudioButtonSystemMode 等。未发现对导出 setter 的直接调用或 EXE 对其名称的交叉引用，**不能据此排除其他动态路径，也未建立录音开始/结束的实际 caller**。

**结论/下一步**：本轮已经从“没有官方控制依据”推进到“找到官方专用设置接口、具体发送链及进程内初始化守卫”。此前 `02` 不生效不能证明官方 `00` 也无效。但 K1 录音触发、mode 语义、固件条件仍未闭合，不把设置接口等同录音回调。若后续做硬件验证，须另获同意，按官方格式单变量、保存原值、独立确认回读并恢复，禁止顺带改 MicEnable/其他灯字段；本轮没有任何试写，已通过的按键和任务灯保持不动。

### 同轮后续：用户授权官方 `00` 格式受控对照，原值恢复确认

**采集日期**：2026-11-01。**执行后端**：现有独占 HID 探针、固定源 SHA 构建、默认纯 FakeStream，真机只在用户明确授权后执行。执行次数：纯测试首次构建作用域失败 1 次（未访问硬件）、修正后 9 场景通过；真机首次联机门槛阻止 1 次（无 0x24 GET/SET）、用户确认唤醒并另行允许的立即重试 1 次。没有再次加载/执行官方 SDK，也未自动启动录音。

新增仅忽略目录工具 `.local/au05-mic-ui-official00-20261101.ps1`。固定旧比较工具 SHA `eb97b0d320eb687c8d026c1e4eb362f0a5f82ba119709477c0a50e2c9da92cb6`，唯一改变为 SET 与恢复的操作字段 `02 → 00`，并同步修改纯模拟的严格命令校验及独立 schema/命名空间。原有认证、联机、GET、原值验证、touched 标记、独立 4 秒恢复预算、最多 3 次 GET/一次开启/一次恢复、32 秒操作与 45 秒硬截止均保持。首次以子作用域调用冻结构建器导致其 script-scoped patch accumulator 不一致，默认模式在构建守卫拒绝，无硬件；改为显式传递授权布尔值的同脚本作用域 dot-source 后，9 项纯模拟和恢复场景通过。没有修改旧探针或生产组件。

首次实际调用 Auth matched=1，但 linked=false，因此 0x24 GET/SET/restore/hold 均为 0；没有设置变化，已退出探针并恢复 DSH 连接。用户另行确认唤醒并选择立即重试。

重试真机结果（schema `au05-mic-ui-official00-v1`）：

| 项目 | 实际结果 |
|---|---|
| 认证、联机 | authAttempts=1、authWritesCompleted=1、authMatched=1、linked=true、linkRequestsCompleted=1 |
| 保存原值 | GET 为 disabled |
| 开启 | `01 06 24 00 01` 一次，随后独立 GET **仍为 disabled** |
| 观察 | status=enable_unconfirmed、holdMs=0；没有进入 15 秒启用态观察，不要求用户判断灯亮灭 |
| 恢复 | 官方 `00` 格式写回原值 0 一次；独立第三次 GET 确认 `restoreVerified=1` |
| 计数与清理 | micGetWritesCompleted=3、setAttempts=1、restoreAttempts=1、discarded=2（未分类，不称作 ACK）；readerStopped=1、streamClosed=1、cleanupFailed=0 |
| 其他控制 | ledWrites=0、audio=false；无 Online/Offline/Heartbeat、无 MicEnable 或按键映射修改 |

恢复后独立进程检查 Studio/native/probe 均为 0，再正常连接 DSH：**已连接、运行中配置回读一致、语音 Off、反馈 On**。这确认的是设置原值回读和正常连接状态，不代替重新测量所有实体灯。

**限定结论**：官方操作字段差异已从静态证据得到本机受控检验，但 `00` 在当前“认证+联机、无 SoftwareOnline”的独立条件下，同样没有得到开启回读；单独替换操作字段不是已验证修复。不能据此断言官方函数无效或 K1 硬件损坏；剩余 SDK 设备准备分支/软件在线条件、设备模式语义及真正录音 caller 仍未知。本次原值恢复已确认，不将这个未生效设置接入常驻插件，也没有继续试其他值。

### 2026-11-01：设备准备字段已命名，SoftwareOnline 持续维护链已定位（仅静态）

**采集日期**：2026-11-01。**执行后端**：同一固定 SHA 的官方 x64 SDK 文件只读 PE/导入表/Capstone 解码；主代理独立复核，子代理解析发现与待机字段。**执行查询数**：联网 0；主代理 12 次本地验证命令；子代理本地命令完整计数未保留，不伪造总数。未加载或执行 SDK、未打开 HID、未试写设备、未改生产组件或当前连接。

复现入口：本机临时只读工具 `python C:/Users/ASUS/AppData/Local/Temp/au05-sdk-online-static-20261101.py 0x35a30`；同工具可分别解码 `0x17f60`、`0x3dc10`、`0x35640`、`0x37010`，`names 0x9a9a8 0x9cd10` 核对字符串。SDK SHA256 仍为 `2e37239e7bd6cc7a9bf0395eae05aa9892b1544a6dace45d9f009b7bc131bd48`。子代理摘录保存于本机 `C:/Users/ASUS/AppData/Local/Temp/au05-preconditions-*`；不打包私有 SDK 或其反汇编文本。

#### 设备准备分支：不是未认证/未联机守卫

- SDK `0x35640–0x356C2` 实际构造的是 `01 01 0D 00 …`，不是 HID 命令 `0x43`。`0x3E5F0` 把参数 `0x43` 写为内部队列任务类型，另存报告指针、长度 `0x7E` 与超时 `0xBB8`；不能把内部任务标签当作线协议命令。
- device+`0x2D0` 对应 SDK 的 **deviceStandbyStatus** 缓存：主 owner vtable `0x9BA00` 的 `+0xD8` 指向回调 `0x21C60`，`0x21D0B` 引用字符串 RVA `0x9A9A8`；状态由 `0x4075C` / `0x44398` 的接收路径更新。这里有可复核名字，不推测固件中各数值的实际效果。
- device+`0x2D5` 来自发现描述 `+0x28`（`0x376EF–0x376F4`）；关联日志字符串 RVA `0x9CD10` 为 **mIs8KObject**，不是认证位。`isDeviceActive` 与 `getConnectionMode` 读取的是 manager map 的其他字段，也不能与该待机缓存混用。
- **关键控制流**：UIFlick 内部 `0x16455–0x16477` 仅在 standby status>0 且非 8K 分支时，前插上述 `0x0D` 任务。条件不满足则跳到 `0x1647C`，仍继续构造 `01 06 24 00 <mode>`、任务 `0x52`。因此这两个字段不是主 SET 的“准入不满足则返回”门槛。不能因此自动补写 `0x0D`，更不能断言它就是已证 K1 唤醒修复。

#### SoftwareOnline：报文相同，但官方存在持续发送路径

| 已核实位置 | 实际逻辑 |
|---|---|
| SDK `0x35A30–0x35AC3` | 构造 `01 01 10 00 <value>`，参数==1 时 value=3，否则为0；与当前生产 `SoftwareFrame(true/false)` 的 `03/00` 完全相同，不是值或操作字段不一致 |
| SDK `0x17F60`，特别是 `0x1801C–0x18027` | 在线设置路径把参数是否非零存入 device+`0x2B8`，清 `+0x2B9`，并把同一在线/离线报告以内部任务 `0x5A` 入队 |
| SDK worker `0x3DD30–0x3DE1D` | 在 `+0x2B8!=0` 且设备可写时，按模式分支的 500/850ms 门槛再次构造在线报告并实际送入既有 WriteFile 适配链；这是循环路径，不只一次函数调用 |
| SDK worker `0x3DE22–0x3DF49` | 另有约1000ms门槛的 `06 01 23 00 01` 心跳路径，与上述在线维持不是同一个报文 |
| SDK `0x6CFD0` 与导入表 | 用 QueryPerformanceCounter/QueryPerformanceFrequency 换算、乘1000后返回整型计时值，支撑上述毫秒单位；未运行时测定本机 AU05 对象会走500还是850ms分支 |
| 当前生产后端 | `WriteLights()` 初始化后只调用一次 SoftwareOnline，之后每800ms发送另一种 Heartbeat；本轮未更改这个已能带动普通任务灯的路径 |
| 此前 `02` / 官方 `00` 两次独立模式对照 | 明确没有 SoftwareOnline/Heartbeat；因此都不是“官方持续在线条件已满足时仍无法启用”的检验 |

**限定结论**：本轮排除了把 standby/8K 缓存当认证/联机门槛的解释，并找到了具体的持续 SoftwareOnline 实现差异；尚未证明固件强制要求持续在线，也尚未证明该差异造成 K1 不亮。没有 SDK 在线标志的主 SET 准入检查，也不能由此断言其不影响固件行为。下一步若继续实机，应另获同意，只针对在线维持条件做有限、可恢复对照，沿用官方 `00`、保存原值、独立 GET、失败立即恢复，不同时引入 `0x0D` 或新灯控值。K1 尚未修复，已通过的按键与任务灯保持不动；本轮不要求用户再次判断没有实际进入的观察窗口。

### 2026-11-01：仅增加持续 SoftwareOnline 的可恢复实机对照（未启用成功）

**采集日期**：2026-11-01。**执行后端**：本机受控独占 HID 工具；复用固定 SHA 的上一轮官方 `00` 比较，只增加 SoftwareOnline 首次发送与850ms维护，不增加 Heartbeat、`0x0D`、MicEnable、普通灯通道或音频操作。**执行查询数**：联网0；12项 FakeStream 纯测试通过；本轮实际硬件比较1次，认证1次、联机读取1次、Mic UI GET共3次、开启SET1次、原值恢复SET1次。执行前用户明确允许并确认本体已唤醒。

复现入口仅用于已获授权的单次工具，不是自动重试指令：`pwsh -NoProfile -File E:/Repository/Github/dsh-au05/.local/au05-mic-ui-online-20261101.ps1 -RunAuthorized`。工具 SHA256：`479c94e8d31436b70f6f288988887b3fa9bbe0937d5764fa5fd3bd9358ad7be5`；未修改生产组件或此前已经通过的按键与任务灯逻辑。

- 原值 GET 保存后，先发送在线报告并启动维护；固定预维持2500ms且至少3次系统写完成才尝试官方 `01 06 24 00 01`。全部写入同锁串行、每次300ms预算；在线维护持续至原值恢复 GET 完成，随后停止自身维护、发送一次 Offline、关闭读取与句柄。系统写完成不是设备 ACK。
- 主代理复审纠正了“立即 SET/GET 失败可能只发出一次 Online、实际上未覆盖持续条件”的对照缺口；最终12项纯测试包括开启前在线次数门槛、循环失败、SET生效后异常、独立恢复失败及 Offline 超时，实际硬件结果不由这些模拟结果替代。

| 实际元数据 | 本轮结果 |
|---|---|
| 状态 / selfTest | `enable_unconfirmed` / `false` |
| 认证 / 联机 | 认证写完成1、匹配1；联机 `true` |
| 原值 / 开启后独立 GET | `disabled` / `disabled` |
| Online / Offline 系统写完成 | 3 / 1；自身维护任务已停止 |
| SET / 恢复 SET / Mic GET | 1 / 1 / 3 |
| 原值恢复独立 GET | `restoreVerified=1` |
| 观察窗口 | `holdMs=0`，没有进入15秒窗口，不要求用户判断不存在的录音灯测试 |
| 其他 | 丢弃5个未分类接收包；Heartbeat0、普通LED写0、音频false |
| 清理 | readerStopped1、streamClosed1、cleanupFailed0；独立检查 Studio0、原生收集器0、探针0后才重新连接 DSH |

**限定结论**：在本轮具体初始化、官方 `00`、850ms维护与2500ms预维持条件下，持续 SoftwareOnline 单独不足以让 Mic UI 设置回读为开启。该条件已实际覆盖，不把失败归因于“根本没持续发送”；也不外推所有 SDK 模式分支、Heartbeat组合、设备准备或固件条件。GET 无事务ID，迟到应答不能完全排除；本轮没有观察窗口，不新增物理 K1 成败证据。原值已由独立 GET 确认恢复，未继续猜测其他命令或参数。DSH 以语音关闭、任务灯反馈开启重新连接；随后面板实际确认“已连接 / 运行中 · 配置回读一致”、无错误。此为恢复连接与配置回读证据，不是新增的物理灯效验收。156项源文件检查及 `git diff --check` 通过（仅既有 CRLF 提示）。

### 2026-11-01：官方 0x24 接收语义复核——SET 回显不等于录音灯执行（重要解释收窄）

**采集日期**：2026-11-01。**执行后端**：固定 SHA 官方 SDK 和主程序原件只读 PE/Capstone 静态审计；两路子代理分别审计接收语义及真实调用链，主代理独立核实 SDK 跳表和接收分支。**执行查询数**：联网0；主代理本节新增2次验证命令（第一条错误地传入旧工具不支持的 `exports` 参数，退出1且未执行厂商代码；改为读取工具并使用独立固定字节验证器）；子代理完整本地命令数未保留。无新增 HID 操作、SDK执行、录音或生产代码修改。

- 固定 SDK SHA 仍为 `2e37239e7bd6cc7a9bf0395eae05aa9892b1544a6dace45d9f009b7bc131bd48`。group6/cmd24 跳表 `0x44170[0x24-3]=9`、`0x44124[9]=0x425D4` 已由主代理从原件验证。
- 完整报告在 `0x3EFF0` 路径复制到 `[rbp-0x50]`；`0x3F093` 从 `[rbp-0x4F]`（报告+1）复制给 group 处理。因此 handler 的 `[r13+2]` 是完整明文 `plain[3]`，`[r13+3]` 是 `plain[4]`，没有证据支持任意改偏移。
- `0x425D4–0x42666` 首先检查 operation 的 `0x10` 位、当前 pending 及对象有效性；`0x42605` 读取 mode，`0x42638–0x4264B` 与 pending 参数比较，不一致即退出；一致才在 `0x42654` 完成事务，并调用 vtable+`0x118`。回调路径 `0x41966` 固定 access=0、`0x41969` 传 mode；access 不是设备负载内的成功状态码。
- **已证语义是当前 SET 参数回显确认**，不是在该分支找到一个独立 GET 模式读取接口。SDK只检查 operation 的 `0x10` 位，不能宣称官方应答必为 `0x10`、不能随意接受任意同命令包；并发 pending 与 mode 必须关联。
- **对历史报告的解释收窄**：以前工具的 `disabled` / `restoreVerified=1` 精确含义是“其社区 GET 解码读到 raw0，恢复后又读到相同 raw0”。本轮不能由官方 SDK 给这个 GET 的完整偏好读取／持久原值恢复语义背书，也没有证据反向断言 raw0 就是状态码或 getter 必然不支持。因此不再把旧 GET 门槛包装为官方确认开启失败／严格原值恢复，更不能由此宣称物理 K1 已修好。
- 原始 Studio 主程序 `updateIndicatorLightByState` 的 `0x1B9670–0x1B9B2E` 明确只构造 channel1/2/3；`0xBEBD3–0xBEBE3` 绑定 `setDeviceIndicatorLightWorkModeType` 到对象+`0x160`，经 `0xC6389–0xC638E` 调用 SDK `0x57B70→0x3C560`。这是已工作的任务灯链，不是新找到的 K1 录音执行链。完整 SDK 导出没有 Record/Begin/End；另一个 MicrophoneEnable setter 是 `01 01 2A 00 value`，不得当成录音灯控制或擅自开关麦克风。

**产品边界与决定**：K1按键、DSH长按语音及普通任务灯已有人验通过，继续保留；K1实体录音灯仍未通过。当前没有可靠基线与已验证录音执行语义，不能把 `channels[0]==2` 自动转换成 `0x24` 偏好写入，或只实现 ACK 解析就宣称可用。拟议生产改动已暂停，原生文件 SHA 仍为 `dc988bb6f167ae5ce4c91684ecf1fc078bc0f6c4551fbdc58d1de51427a84d68`，没有增加自动写偏好、额外实机对照或更改现有按键/任务灯。尚缺可验证的 AU05 录音灯执行调用链／协议及可靠原值语义；不等同于已证明固件不支持，也不把不确定性伪装成完成。

### 2026-11-01：官方商品介绍与原厂基准测试条件复核

**采集日期**：2026-11-01。**执行后端**：agent-reach Exa搜索1次、Jina官方文本抓取3次、官方商品CDN灯效图抓取2次并直接查看；未执行设备测试、未开启录音或修改固件。用户提供设备信息中 TX/RX 固件均为4.6.3（用户报告，未独立读取；不记录序列号）。

- 商品页 https://www.ulanzi.com/products/au05-vibe-key-ai-voice-input-keypad-i018 （取到日期2026-11-01）：明确推荐第三方语音软件，举例Typeless，不是设备自带ASR。灯效段落列Work/All-On/Power-Saving；商品All-On插图明确“Every key stays lit”，Work插图强调Hooks审批状态。页面Details含像素屏等明显与AU05主体不一致的文案，本轮不采用这些混入内容作硬件参数证据。
- 软件指南 https://docs.ulanzistudio.com/vibekey/en/au05/ （取到日期2026-11-01）：第三方语音快捷键可用Typeless/豆包输入法/微信输入法；设备设置位于Home→Preferences→Device→Lighting Mode，默认Working。没有规定所有第三方录音自动触发K1，也没有本机4.6.3固件专属适配说明。
- 官方灯效FAQ https://docs.ulanzistudio.com/vibekey/en/faq/codex-claude-status.html （取到日期2026-11-01）：K1原文“Voice input status. It breathes while listening and is off in other states.” 即宣称监听/录音期间呼吸、其他状态熄灭，不是只承诺松开闪一下；仍未给出执行API和明确的录音检测集成条件。

**建议的一次原厂基准流程（尚未执行，不是通过证据）**：DSH显式断开后由Studio独占；先在非零亮度的All-On模式观察K1是否常亮，再恢复Working模式。在新建临时预设中给K1配置语音软件的快捷键，不沿用DSH Input动作，不覆盖个人预设；为控制变量，语音App选择AU05麦克风并确认录音界面实际处于录音状态，持续5–10秒观察K1，结束后再观察熄灭。需分别记录全亮K1和实际录音K1两个结果；全亮不亮仅优先指向设备设置/固件/灯本身，不能直接判定硬件坏。全亮可亮而Working录音不呼吸也不足以归咎DSH，须核实官方语音集成条件。不因当前未找到接口而断言AU05没有此能力，不自动升级或刷写固件。

### 2026-11-01：用户完成原厂模式基准对照

**证据来源**：用户本轮现场报告；非自动光学测量。未采集录音内容、设备序列号或个人预设。TX/RX 4.6.3仍为用户报告版本。

- All-On模式、非零亮度：K1、其余按键和旋钮全部常亮。K1发光能力已由用户实测确认，不能继续把灯珠完全不发光当作本轮首要解释。
- Working模式，K1绑定语音软件快捷键：语音软件采用单击开始、再次单击结束的交互；用户报告期间无论如何操作K1均熄灭。此结果属于原厂Studio快捷键组合下的负面基准，不是DSH控制链独有的现象。没有另行读取录音应用、音频设备选择或软件实际录音状态，不能把这些未独立核验项补成已验证事实。
- 单击启停与长按说话是不同软件交互，不足以据此指责用户操作错误，也不能推断更换按法即可修复。快捷键触发成功不等于软件把真实录音状态上报给灯控；本轮尚未定位具体缺失环节，不能断言固件缺陷、硬件损坏或任意语音软件都应自动被Studio识别。

**下一步边界**：停止重复相同通道0和0x24试写、停止要求用户重做本轮基准。K1物理录音灯仍未修复；后续需要核实官方支持的语音软件/状态上报条件，或取得可验证的录音状态到K1执行接口。保持已通过的DSH按键、内置语音和任务灯逻辑，不自动录音、升级固件或改写个人预设。

### 2026-11-01：录音状态来源与 SDK 音频数据回调分流调查

**执行后端**：仅本地固定版本 PE 静态解析、导出表/字符串检查、`.pdata` 函数边界内 Capstone 反汇编；网络查询0。SDK SHA256沿用 `2e37239e7bd6cc7a9bf0395eae05aa9892b1544a6dace45d9f009b7bc131bd48`。未加载或执行厂商DLL、未开启音频、未发HID、未修改生产程序或设备预设。父验证脚本位于临时目录 `au05-record-state-static-20261101.py`，不会进入发行包。

**SDK正证据**：

- `registerDeviceAudioDataCallbackListener` RVA `4a2a0` 在 `4a2d0..4a2d7` 将传入回调存入SDK manager的 `+0xd0`。manager虚表 `9ba00+0xc8` 指向 `21920`，后者 `21943..21962` 取出该回调，并传递数据指针和长度。
- 接收分支 `3f19a..3f3b7` 对设备分包组装/处理，经过 `5e4f0` 后，将缓冲区指针和 `0x100` 长度送到上述虚方法。此处能证明设备音频数据上行通路，不是布尔录音开始/结束回调；该回调包装函数本身没有K1灯控写入，不能把注册此函数等同于监听第三方应用的录音状态。
- 另有 `setDeviceAudioButtonSystemMode` RVA `50910` → `193d0`，构造 `01 06 51 04 <mode>` 并入队；这是单独的模式设置接口，枚举含义及与K1的关系未证实，不据此安排试写。

**Studio EXE侧正证据与限定查无**（`UlanziDeck.exe` SHA256 `85896a993e758689990f64d94c726e2c23234ed0e48c9176e6e9a30b2f8a05ca`；不是不存在的 `Ulanzi Studio.exe`）：

- 父独立验证 `be600` 函数中 `be884..be894`：解析音频回调注册导出并存到包装对象 `+0x38`，不是调用它注册回调。本轮尚未把该特定对象的 `+0x38` 调用和回调接收函数闭合；不能宣称Studio已经使用音频buffer监听，也不能宣称全程序绝无注册。父按合法指令边界核验全局对象 `345c738` 的11个RIP字节候选，确认 `11b420` 懒初始化getter，以及 `c3e40`、`1b9670` 的构造/使用，但这些引用本身没有补上音频注册调用。
- 找到的CoreAudio路径 `486e60..487217` 是输入端点选择：子代理识别MMDeviceEnumerator/capture枚举与CPolicyConfigClient；父独立复核 `48713c`、`487161` 的同一COM对象虚方法 `+0x68`，角色参数分别0、2，用于设置默认端点，不是录音会话状态通知。子代理整EXE精确GUID特征扫描没有找到IAudioSessionManager2/IAudioSessionNotification/IAudioClient/IAudioCaptureClient，范围只限这些特征，不能排除动态实现或别的模块。
- 子代理定位 `isrecording` 字符串到OBS录制插件及其JSON解析，不是通用语音App到K1的事件；存在Qt WebSocket设施也不足以证明语音状态消息。另有 `SystemAudioInputService`/`stateChanged` Qt元数据（父复核 `ff2748`/`ff2760`），方法名本身不能当“录音中”语义，具体类行为仍未闭合。
- 本轮没有发现可验证的“第三方语音开始/结束事件→K1灯执行调用”完整链路。上述否定均限定为本轮覆盖路径，不是固件不支持的结论。

**关键范围限制**：DSH内置语音的真实 `recording` 阶段已在此前同步记录中捕获，且通道0请求回读一致而K1未持续呼吸，因此不能把DSH故障重新泛化成“不知道录音状态”。缺口仍包括受支持的K1执行路径。用户最新原厂模式基准没有单独报告语音App当前实际采集端点；历史叭哥说只读观察跨capture端点累计，不能追溯证明每次录音都来自AU05。USB音频驱动/接收器固件直接感知实际AU05采集这一分支尚未排除，不能仅凭Studio静态搜不到某GUID就断言整个链路不存在。

**本轮追问后的补充**：用户明确确认原厂测试的语音软件设置中选择了AU05麦克风，不是仅用AU05按键启动而采用电脑麦克风。此为用户报告，不是本轮独立端点采集；不再以“选错麦克风”作为默认解释或要求重做同一灯效基准。尚待闭合的是实际采集状态如何被固件/Studio用于K1执行，以及 `SystemAudioInputService::stateChanged` 的真实语义和去向。

### 2026-11-01：SystemAudioInputService::stateChanged 完整限定链路

**执行后端与范围**：仅读取同一固定SHA的 `UlanziDeck.exe`，解析Qt6元对象、导入表、合法函数边界反汇编和常见RIP引用；网络请求0，未运行厂商代码、未访问HID/音频/用户配置、未改生产代码。本轮一个独立只读子代理核对发射侧，父核对元数据、两个接收侧和Qt转发源。首个按 `.pdata` 读取 `516d70` 的操作因leaf无表项断言退出、无写入，之后依据元对象函数指针从真实入口做有界解码，不从任意指令中间解码。

**准确签名与元对象**：`void SystemAudioInputService::stateChanged()`，没有参数，不能承载“正在录音=true/false”。Qt6元对象起点为 `ff26f0`（不是 `ff26f8`，后者是成员）；字符串表 `ff2730`、数据表 `ff2770`。方法表 `[1,0,0x14,2,6,1]`，参数表返回类型 `0x2b` 为void。static metacall入口 `516d70`，信号函数 `516ec0` 以signal index 0、空参数数组调用IAT `5fd940` 的 `Qt6Core!QMetaObject::activate`。

**已定位的两类发射源**：

1. 切换默认输入端点：组合框选择回调 `11d850` 读取 `QComboBox::itemData(index,0x100)`，经 `11d8aa` 调用服务setter `486860`；菜单动作Qt functor `1883a0` 的invoke分支也转到 `486860`。该setter在 `486870` 调用既有Windows默认capture端点切换函数 `486e60`，保存成功/失败返回值后，`48687b` **无条件**调用 `516ec0`，最后才把返回值交还调用者。切换失败也通知，不是录音启停检测。
2. 音频输入设备变化转发：服务单例构造 `486720` 在 `486797` 创建 `Qt6Multimedia!QMediaDevices`，`4867aa` 从IAT `601218` 读取 `QMediaDevices::audioInputsChanged()`，`4867b6` 读取其staticMetaObject，`486825` 通过 `QObject::connectImpl` 转发到 `stateChanged()`。这是设备列表变化通知，不是录音活动。子代理最初“唯一”结论只覆盖直接E8/E9调用，父补查此Qt连接后已更正，不能漏掉它。

**两个业务接收槽的闭合路径**：

- 设置界面连接点 `118f37..118f94` → 成员槽 `11d5f0` → `486570` 枚举输入设备、`4866e0` 取当前输入 → `3136c0` 更新组合框。父核对导入表：该更新函数执行 `QObject::blockSignals`、`QComboBox::clear/insertItem/findData/setCurrentIndex`，再恢复信号；目的是刷新麦克风选项和当前选择。
- 菜单连接点 `17d437..17d4b9` → Qt包装函数 `188d40` → `167f30`。父核对导入表：`QMenu::clear`、`QWidget::addAction`、`QAction::setCheckable`，根据 `4866e0` 当前设备ID比较结果调用 `QAction::setChecked`；每个菜单动作绑定上述 `1883a0` 端点切换回调。由此形成“选择输入→设置默认端点→通知→刷新菜单/组合框”的UI闭环。

**结论与边界**：在已核验的发射源和两个业务接收槽内，`stateChanged()` **不是通向K1的录音状态信号**，没有连入录音启动/结束、SDK灯控或K1通道写入。拿它直接驱动录音灯会把插拔/切换设备误当成录音变化。该特定线索现可排除，不再把类名当未解释的录音证据；仍不宣称排除所有计算型间接调用、外部模块反射或固件/USB音频自主驱灯。K1实际录音灯仍未修复，已通过的DSH按键/语音/任务灯未作修改。

### 2026-11-01：USB 音频与 SDK 音频数据到 K1 的边界核查

**执行后端/范围**：本地固定SHA SDK静态解析和缓存PnP属性查询，网络0请求。独立子代理检查接收分派，父复核跳转表、解码入口及既有音频callback；未打开任何设备句柄或音频客户端、未发HID或灯控命令、未运行固件、未改生产程序。只读取指定安装目录和设备缓存，不读个人配置/录音内容，不输出实例ID或序列号。临时工具为 `au05-audio-driver-metadata-20261101.ps1`、`au05-subdispatch-20261101.py` 和父既有静态脚本。

**本机实际驱动元数据**：按已知VID/PID匹配8个缓存PnP节点，USB父服务 `usbccgp`，HID节点含 `HidUsb`，MEDIA节点服务为 `usbaudio`，INF属于标准USB音频INF且节点状态OK；不是把安装了通用驱动误当匹配了AU05，也不是推测为 `usbaudio2`。此处证明标准Windows USB音频类接口与vendor HID接口并存，未观测本轮实际录音、USB streaming alternate setting或USB控制传输。

**已核验的SDK数据链**：

- SDK接收线程 `3d7d0` 在 `3da78..3da82` 去掉report首字节后进入 `3eff0`；按payload首字节低5位分派。父复核 `3f48c` 字节索引表/`3f468` 跳转目标表：`0x0c→3f25a`、`0x0d→3f2eb`、`0x0e→3f19a`；其它有效分支1/6/0xb/0x1e/0x1f进入各自通用/通知解析。这个switch不是完整固件能力清单。
- 子代理分支核查：0x0c/0x0e第二字节高2位为分片索引、低6位参与包序比较，变化后清理重组缓冲区；分别处理18×2/32×2字节，0x0d处理58字节单包。不能把序号变化命名为录音开始/结束，也不擅自修正原代码0x0c分支传decoder长度0x40的行为。
- 汇合 `3f361→5e4f0`；父复核解码入口 `5e50c` 要求数据首字节0x9c，不匹配则输出长度0并返回-3。成功条件后经manager虚槽 `+0xc8→21920`，再调用manager `+0xd0` 注册的consumer，数据长度传0x100。这个接口交付音频buffer，不是明确的recording/start/stop事件。
- 已查上述音频支路未直接调用K1/LED setter；通用通知包含很多虚调用，尚未穷尽所有子命令及EXE消费者，不能宣称固件没有自治K1能力。SDK音频包不是 `usbaudio` 的IRP、USB streaming接口状态或Windows录音客户端开关，不能混成同一条链。

**到固件的缺口**：主机侧可画出“语音App/Windows音频路径→标准USB音频驱动→AU05 USB音频接口”，但目前没有可核验的RX/TX 4.6.3固件USB流状态处理到K1 LED状态机代码，也没有对应厂商协议说明。仅SDK数据上行与主机未直接写灯，均不能证明采集启停到K1的因果。安装目录两层内仅发现名为 `debug.hex` 的候选：1024字节，SHA256 `e1a3db94c7f239d8d08e23928a9fe09ffb3c8db667f8d2e2ed0ea80910fab8e5`，不是合法Intel HEX，身份/目标版本未证实；未执行、刷写或将它宣称为4.6.3固件。这不是全盘/所有固件来源不存在的结论。

**结论与下一证据需求**：本轮把标准USB音频和SDK vendor音频数据两路区分清楚，但仍未找到可验证的K1启停接口。若继续跨越到固件内部，需获得对应版本固件/协议或有选择、无音频负载的USB控制元数据证据；当前没有启动此类跟踪，也不把未实现的抓取能力说成已可用。保留已通过的按键、语音和任务灯，K1仍未修复，不安排猜参试写或重复原厂基准。

### 2026-11-01：RX/TX 4.6.3 固件和官方更新入口查找

**采集日期**：2026-11-01。**执行后端/请求计数**：agent-reach Exa/Jina/GitHub gh；父Exa检索1次、Jina官方downloads抓取1次、官方精确无参API GET1次、GitHub社区文档抓取1次；公开检索子代理报告12条网络命令（包含内部请求的实际HTTP总数未逐一保留），本地静态子代理0网络。公开子代理有2次GitHub代码搜索成功但空结果，精确版本Exa返回噪声；父官方裸GET实际HTTP500。未使用账号凭据或设备SN发请求，未运行更新器/SDK、未下载执行固件、未写设备。Agent Reach版本更新提示此前已报告，本轮未重复升级或提示。

**公开页面和协议检索结果**：

- 官方 https://www.ulanzi.com/pages/downloads （取到日期2026-11-01）实际只导向 https://www.ulanzi.com/pages/ulanzi-app 和视频教程；页面标题含Firmware不等于提供AU05固件。子代理实取软件页，未找到4.6.3 RX/TX固件URL、manifest、校验值或发布说明；不排除动态API资源。
- 子代理经GitHub API实取UlanziTechnology官方6仓库，代码检索 `"AU05" org:UlanziTechnology`、`"4.6.3" "ulanzi"` 均空。本轮未找到官方USB/HID/K1录音灯协议。官方插件API、TC002或D200的OpenCodexMicro不当AU05固件协议。
- https://github.com/MrCroxx/olanzi/blob/main/docs/02-vibekey-protocol.md （父与子均实抓，取到日期2026-11-01）：第26行明确dongle/device固件均为4.4.2，第124行记载0x1e/0x1f升级消息，第149–150行为其固件版本读取示例。这是社区逆向资料，**不是官方协议且不是4.6.3适配证据**；本轮未发送任何这些命令。

**找到官方客户端实际使用的更新入口**：

```text
https://api.ulanzistudio.com/api/vibekey/firmware/checkUpdate
  ?deviceSn=<设备SN>&pid=<固件目标>&ver=<当前固件版本>&lang=<语言>
```

来自固定SHA的官方EXE静态内容，不是搜索结果猜测：base字符串RVA `639288`，路径模板 `640db0`，`requestVibeKeyOtaCheck` 函数 `1c8720..1c8f95`，父独立核验模板引用 `1c89d1`。客户端日志RVA `640d60` 明确SN或版本为空则return；这是客户端条件，不是服务端认证规则的证明。

- RX/接收器 pid=`AU05_USB`：父独立核验caller `1c2597` 构造QString、`1c25b0` 传入r8、`1c25bb` 调用共同检查函数。
- TX/麦克风本体 pid=`AU05_Device`：父独立核验caller `1c271a` 构造QString、`1c2733` 传入r8、`1c273e` 调用同一函数；与官方Dongle/Mic日志对应。不是数字model/subtype，不能用布局JSON中的subtype猜参数。
- 相邻/引用到的响应字段线索有 `needUpdate/versionInfo/downloadUrl/md5/size`，尚未取得真实响应、完整嵌套schema或可验证下载URL，不能说“已找到4.6.3固件包”。该接口按当前版本检查更新，也不保证提供当前4.6.3的历史完整包。

**无身份探测和隐私边界**：父仅GET一次不带任何参数的上述精确URL，返回HTTP500、标准error JSON；没有固件清单。不能由500推断需要登录或证明SN是服务端强制条件。未伪造SN/版本、未枚举参数、未从用户配置读取身份、未将用户此前提供的设备信息发送到外部。若下一步按官方客户端形式带真实SN查询，需用户明确允许向该官方域名发送设备身份，仅取更新元数据，不经搜索/Jina代理，不在聊天/报告/命令行记录SN，也不自动刷机。当前尚未进行此查询。

**后续授权与身份来源核对**：用户已明确允许向上述官方域名发送设备SN、RX/TX目标和当前版本，仅取更新元数据，不刷机。父随后只读检查Studio自有窗口：进程唯一、窗口1个，但没有可靠识别到设备信息/SN标签，未回显任何字段值、未调用任何控件、未带身份发请求。不能把无法识别的界面或任意文本猜成SN；下一步等待用户打开官方设备信息页后再核对，不从配置、日志或聊天历史挖取身份。

**本轮结果**：已确定官方更新入口及RX/TX目标标识；仍未获得RX/TX 4.6.3固件文件、校验或K1官方执行协议，K1修复不能据此宣称完成。

### 2026-11-01：继续核对无 SN 公开资源（03:36 后）

**采集日期**：2026-11-01。**执行后端/计数**：agent-reach Exa/gh/curl/Jina。父 Exa 精确目标检索1次、gh代码检索1次；子代理6条网络命令预算，其中1条因把PowerShell语法用于Bash而exit127、未成功发请求，未追加补查。另只读列举官方安装目录深度3内的 `.bin/.dfu/.ufw/.fw/.hex` 文件名，并重新检查Studio自有窗口的匿名字段类别；没有调用控件、读取字段值或发送身份请求。

- 子代理实抓官方文档中心 https://docs.ulanzistudio.com/vibekey/en/ 、AU05指南 https://docs.ulanzistudio.com/vibekey/en/au05/ 及指南HTML实际引用的 https://docs.ulanzistudio.com/assets/app.BFZuGBeF.js （均取到日期2026-11-01）。这些已检查页面和主脚本未出现可验证的4.6.3固件文件、无SN固件清单、对应发布说明或官方线协议。**指南V3.2.0是Studio软件版本，不是设备固件版本。** 不能把有限页面检查外推为全站不存在。
- 父精确 `AU05_USB firmware` 检索只返回无关产品；gh代码搜索 `"ulanzistudio.com" "firmware"` 返回空数组。没有猜测CDN文件名、API路由、设备身份或版本参数。
- 安装目录深度3内仍只发现之前已分类的 `debug.hex`，其AU05/4.6.3归属未验证，不能当固件交付。重新检查Studio窗口仍为1个、已识别字段类别空、SN候选0；没有可靠身份来源，尚未进行已获授权的带SN官方元数据查询。字段类别检查已改用无反斜杠的空格字符类避免渲染/转义歧义；这次结果仍不能证明设备信息页不存在。
- **下一步**：公开入口这轮没有新增固件地址；最具体的后续仍是从官方设备信息页私密核对RX/TX各自SN与4.6.3版本，再仅向已验证的官方更新接口查询元数据。即使返回“无更新”，也不等于取得当前4.6.3历史完整包。未刷机、未运行SDK、未改动生产实现或已通过的按键/任务灯。

### 2026-11-01：官方 RX/TX 私密更新查询成功（用户打开设备页后）

**采集日期**：2026-11-01。**执行后端/请求计数**：本机PowerShell UIA只读字段核对 + .NET HttpClient直接HTTPS官方API，两次GET（RX、TX各1次），未重试、未使用Jina/搜索代理、禁用自动重定向和显式HTTP代理。仅在用户此前已明确允许发送SN、且本轮确认设备页已打开后执行。身份只在进程内存中，未放入命令行、文件、日志或报告；响应不输出原文，只重建白名单元数据。

**身份配对**：唯一Studio进程及其自有偏好设置窗口，依据“麦克风/接收器”标签、各自下方SN标签同排唯一字段、对应版本行的空间关系分别读取；两者显示版本都严格核对为4.6.3。初始辅助脚本只接受窗口名“设备信息”而拒绝当前偏好设置窗口，失败于字段核对阶段，发请求0；扩大到已审查的明确窗口名后，再进行匿名布局验证。没有读取用户配置、聊天历史或控件中的其他设置，也没有调用任何按钮。

| 目标 | 官方 pid | HTTP | 服务 code | data.needUpdate | data.version |
|---|---|---|---|---|---|
| RX / 接收器 | AU05_USB | 200 | 200 | false | 4.6.3 |
| TX / 本体 | AU05_Device | 200 | 200 | false | 4.6.3 |

查询来源：此前静态确认的 https://api.ulanzistudio.com/api/vibekey/firmware/checkUpdate （取到日期2026-11-01；真实查询参数中的SN不记录）。每次总取消预算12秒、响应上限64KiB，响应解析仅允许固定字段并过滤私密值；下载、设备写入均0，重定向0。工具返回两次请求成功，不再把先前无参HTTP500误认为官方服务不可用。

**结论与未解决项**：官方接口对当前这台设备、两个4.6.3目标都明确报告“不需要更新”。这不证明4.6.3是所有设备的最新版本，也不代表提供了当前4.6.3的历史固件包；本次白名单解析未取得可验证的固件下载地址或校验值。官方K1执行协议仍未找到，K1未修复，不能通过伪造旧版本/SN或猜测CDN路径继续枚举。后续应向官方开发支持索取对应4.6.3 RX/TX包及K1录音灯的接口/固件条件；不自动联系第三方或刷机。

### 2026-11-01：仅内置语音 K1 的定点构帧核实

**范围**：用户要求只核实K1入口并修内置语音灯控，保留按键、语音流程和K2/K3/旋钮。只读检查既有固定SHA官方SDK和本地实现，网络请求0，不执行SDK、不操作设备、不继续固件调研。

- 官方 `setDeviceIndicatorLightWorkModeType`：RVA `0x57B70` → `0x3C560`。参数channel未经±1转换，写入 `plain[5]`；类型写入 `plain[8 + 5 * channel]`。这与当前focus/record索引一致，未发现通道偏移依据。SDK此函数没有通道范围校验，不能解释为支持额外通道。
- **可实施的具体差异**：官方该setter的字段mask为 `0x04`，仅改变选定通道的类型；当前实现使用 `0x7C`，还覆盖时长与亮度参数。因此仅为K1引入与官方setter同构的type-only帧，并按原始快照严格验证K1其余四个字段未变；K2/K3/旋钮仍使用原有帧与原有严格回读规则。不猜测新的通道、操作码、时长或亮度值。
- 这核实的是SDK构帧，不是K1实体执行的最终证明。此前通道0的GET一致但物理失败仍有效；`UIFlick`偏好设置不能未经证明替代录音即时状态。实施与纯测试完成、以及后续单独实体验收的结果应分别记录，不能将本段当作K1已修复。

**本轮实施与验证**：原生层新增 `K1TypeFrame` 和 `MatchesK1PreservingLights`，只有通道0改用type-only帧；原来的通道1/2/3构帧、快照门槛与退出恢复未变。K1回读必须匹配目标类型且四个非type字段逐字节等于连接前原快照，其他三通道仍严格核对原有255/2/2/2参数。原生18/18离线测试通过（含独立JS编码golden、on/off、坏回读拒绝、原值恢复及无硬件SelfTest）；父在明确切入本仓库后另跑client/device/Host共148个mock回归通过，158源码检查与diff检查通过。本轮没有重连设备、写入设备、启动录音、自动安装或重新打包。配置能力仍为 `configuration_only` / `physicalVerified:false`；原有实验开关和内置语音状态链保持不变，实体呼吸效果尚待用户单独验收。

#### 同日后续：type-only 实体验收失败，不能作为修复完成

用户明确要求重连并验证K1。先正常关闭语音、断开旧连接；确认Studio已退出。首次新连接虽ready但未取原快照，未进入灯效验证；用户确认唤醒后另行允许一次正常重连，随后取得配置回读一致。实际运行进程已核对本仓库新原生源码SHA `611697b29a51061308b6c0a83f3197432e9b4bd3c167476e321333159ee66f01`，非旧桥接进程。用户手动启用DSH内置语音、灯光反馈及实验K1，三者经只读UI核对均On，其他语音模式未选。

60秒只读状态观察完成，6条元数据记录，未收集音频或转写内容。以第一条采集时间为零：录音实际开始约6513ms（focused=true、preparing=false）；request42于6514ms请求 `[2,0,2,1]`，7025ms回读verified（matched=1、timedOut=0）；11503ms进入转写，request43于11504ms请求 `[0,0,2,1]`，12011ms回读verified；13375ms回ready。用户对此次实体结果明确选择“全程不亮”。因此：状态源、开启/关闭请求及保留参数后的配置回读均有证据，但K1实体仍失败；type-only修正没有解决问题，也不能把原0x7C覆盖额外字段判定为已证根因，更不能把该SDK构帧认定为已验证K1执行入口。

本轮不再重复测试、不新增协议猜测。测试结束仅关闭本次语音与实验K1开关，已核对二者Off、灯光反馈On、设备保持连接；其他任务灯没有改动，其实体状态本轮未另作专项验收。诊断元数据保存在忽略目录，文件标识 `k1-sync-67e6440a-06c2-470c-816d-d179d75d67d3`，记录不含音频/转写/设备身份。K1能力仍为未验证物理控制，目标未完成。

#### 2026-11-01 后续：四档K1灯控预览实体均不亮

**采集日期**：2026-11-01 20:20（本地） **执行后端**：本仓库忽略目录中的隔离预览工具、真实vendor-HID、用户肉眼反馈；无网络/SDK执行/音频采集。**执行查询数**：1次有界预览，9次灯配置GET；不是互联网检索。复现入口为独立四阶段工具，默认仅纯测试，明确授权才打开设备。

用户要求逐个展示已有K1灯控代码。新增工具仅存在于忽略目录，SHA256 `128621a7d06fc256461f36fcca5b62884c3d3d530881af4ac60b7fde7e27af9d`，依赖的原生源码仍是 `611697b29a51061308b6c0a83f3197432e9b4bd3c167476e321333159ee66f01`，没有更改生产代码、默认开关或其他功能。父独立运行15项纯测试通过；用户确认就位后，正常关闭语音、断开DSH设备连接，再独占运行一次。

| 阶段 | K1写法 | 实际保持 | 配置回读 | 用户实体观察 |
|---|---|---:|---|---|
| A | 旧0x7C完整K1记录，type=1（常亮） | 8012ms | 匹配 | 不亮 |
| B | 旧0x7C完整K1记录，type=2（呼吸） | 8003ms | 匹配 | 不亮 |
| C | 官方0x04 type-only，type=1（常亮） | 8003ms | 匹配 | 不亮 |
| D | 官方0x04 type-only，type=2（呼吸） | 8001ms | 匹配 | 不亮 |

阶段间恢复原K1记录并独立GET确认，间隔约2秒；最终再次恢复。真实运行38.8秒，四阶段全部完成：阶段写4次、恢复写4次、9次GET、4次恢复确认，输入事件0；只写K1 focus0，没有全局模式或另三路SET。每次匹配均核对全局mode与全部4条work record；未知响应元数据[0/1/3]不冒充配置。auth/link成功、Online一次、Heartbeat48次；结束Offline一次、读线程停止、句柄关闭、cleanupFailed=0，无强杀、无自动录音、未触碰0x24或MicEnable。

**结果是实体失败，不是回读成功即修复**：用户明确反馈“四档全程都不亮”，并指出之前真实录音松手时曾闪一下。此前闪亮仍是有效的用户观察；本轮没有按键、录音或松手操作，不能把两个不同情景直接当作回归对照，也不能据本轮宣称LED损坏或闪亮已消失。此前闪亮究竟由松手、录音结束还是内部状态触发，仍未确定；不能武断称为硬件自动反馈。

结束已重新连接DSH，实际界面“已连接 / 运行中·配置回读一致”，语音Off、灯光反馈On，无错误。其他任务灯本轮没有另作实体专项验收。下一步若继续，应围绕既有“松手闪一下”的触发条件做最小对照，而非重复扫描灯效值；K1修复仍未完成。

#### 2026-11-01 20:31：松手闪灯触发链的只读核对

**采集日期**：2026-11-01 **执行后端**：父读取既有23行状态记录的元数据归约、只读源码审计；子代理独立只读核对。**执行查询数**：0网络、0设备命令、0录音。没有修改生产代码或测试、没有重连设备。

当前可证实的软件链：Native `ReadInputs()` 识别 `k1.up` 并只发输入NDJSON；Host仅记录松手和事件。客户端 `processEvent()` 在当前手势、会话与焦点有效时调用内置语音 `finish()`；正常路径先发布 `phase=transcribing`，再 `MediaRecorder.stop()`，等待停止后释放音轨。下一次灯目标计算不再满足 `phase=recording && preparing=false`，因此K1目标从2变0；取消和错误路径同样退离录音态，没有发现松手专用type2/闪灯指令，或停止过程中准备态反弹重新点灯。

但停止后的实际灯事务不只是K1 type0：Host语义状态或向量变化会触发全事务，Native先重写全局auto，再每隔80ms顺序写四通道，最后GET。当前K1使用type-only 0x04，发生旧闪灯观察时使用0x7C；两者不能混为同一版本。客户端poll先采样/发送目标，后处理返回的松手事件，后续轮询间隔200ms；Native是8项FIFO串行队列，单事务有至少400ms固定间隔和回读等待。因此旧目标延后到达是代码允许的机制，但不是已证明的旧闪灯根因。

尤其既有记录 request53 在相对21.410s发录音 `[2,0,2,1]`，21.934s已verified；30.489s才观察到转写，30.501s发 `[0,0,2,1]`、31.008s verified。开启配置已提前约8.57s确认，足以否定“该长按期间软件一直没发开灯、只在松手才发”这一解释。旧记录没有物理松手、USB流结束和每个HID包的同步时间戳，用户肉眼闪亮也没有逐次同步时间，所以不能把闪亮唯一归给某一包或武断称为固件自动反馈。

**剩余最小分离**：原情景同时变化了物理按键、麦克风流和停止灯事务。若继续实物定位，应在已知配置下把这三者拆开：例如经新授权，保持同一呼吸配置不变，只做K1按下/松开、不录音且松手不下发关灯/全局重写，再观察是否闪亮。须保存原配置、独立确认恢复，只针对K1，不扩大到协议值扫描。此段没有执行该对照，K1修复仍未完成。

#### 2026-11-01：K1按下／松开分离对照执行，未取得完整有效结论

**执行后端**：隔离PowerShell工具复用冻结Native构帧／解析，默认17项FakeStream纯测试；经用户授权暂时关闭语音并断开DSH设备连接，只保持一次既有legacy 0x7C focus0/type2配置，不录音、不在松手时下发关灯或全局重写。只新增／修改忽略目录内的隔离工具，生产Native、Host、客户端未改。首次30秒窗口，随后用户两次明确要求重来，观察窗口延至60秒；没有自动重复试验。

| 已授权执行 | 实际输入与时间（相对工具启动） | 结论与恢复 |
| --- | --- | --- |
| 30秒首次 | 配置288ms回读；完整保持30012ms，输入0次 | `input_not_observed`，不是物理失败或K1协议不支持证据；30301ms开始恢复、30363ms原配置严格回读成功 |
| 第一次重来，60秒窗口 | 配置266ms回读；K1 down15464ms、up17327ms；第三个未记录类别的额外输入触发中止；18809ms才开始恢复 | 松手到恢复约1482ms没有灯光／全局写，但窗口未完整走完，用户没有给出这段可对应的实体观察，不能据此定闪灯根因；18865ms恢复回读成功 |
| 第二次重来，60秒窗口 | 配置268ms回读；44756ms识别K2 down，44786ms识别K3 down；K1 down/up均0 | 保护中止，44757ms开始恢复、44811ms恢复回读成功。用户明确确认自己不小心按到了K2/K3，因此不是输入映射错误的证据，也不是有效K1对照 |

三次均只有一次K1配置写和一次原K1恢复写，各三次GET；各自独立确认恢复，reader停止、stream关闭、Offline写完成、cleanupFailed=0。每次结束先确认隔离进程退出，再正常连回DSH；最后界面为已连接／运行中·配置回读一致，语音关闭、实验性K1关闭、灯光反馈开启。这里的恢复是配置回读与连接证据，不额外宣称实体灯验收通过。

**操作澄清与范围收缩**：分离对照不需要启用DSH语音或实验性K1开关，它刻意不经过录音流程；用户指出此前说明不清，并在最后明确要求停止空白对照、加快处理。已停止该类试验，不再自动重复或要求反复配合按键。K1录音灯及松手闪灯根因仍未修复／确认；其他已通过的按键、语音流程与任务灯生产逻辑没有改变。后续仍只限最小K1修复，不重启固件、SN查询或其他功能扩展。

#### 2026-11-01：仅内置语音K1的软件修正与当前安装重载

**用户范围**：直接检查并修复内置语音K1灯控，其他功能不动；停止空白设备对照。此轮没有再运行隔离灯效探针、录音对照或固件／身份查询。

**代码修正**：
- 客户端实际内置录音开始（非准备态）、结束／取消／错误造成K1目标变化时，立即唤醒原有串行poll，不再固定等待额外200ms。正在进行RPC时只标记待刷新，不另开并发请求。poll在调用sync前占用请求槽，避免sync触发录音取消时形成第二条poll链；sync内已采样的状态不重复唤醒。K1开关／灯反馈开关改变时仅在实际K1目标改变才加速。语音采集、转写、插入、按键动作、其他灯目标与Studio／外部语音行为未改，原实验性K1显式允许条件及默认关闭保留。
- Native仅在上一笔全向量严格GET verified后缓存可信向量；下一笔只有K1类型变化且其他三通道不变时，只发送已有focus0 type-only帧，再进行原严格GET，不重写全局auto或其他三通道。首次、其他任务通道改变、没有可信基线、上次未知／mismatch后，保留原完整事务及原恢复逻辑。事务开始即撤销旧缓存，只有本笔严格verified才重新建立，失败不会冒充可信。没有新协议值、通道扫描、0x24或未知控制入口。

**回归**：客户端／Host／设备／内置语音／快捷键／Studio客户端215项模拟测试全部通过；Native19项合成测试全部通过；插件声明及已安装DSH运行时离线加载／渲染3项通过，合计237项、无失败／跳过。新增Native测试运行真实Session配合SyntheticStream，使用独立JS TEA编码器逐帧核对K1开／关只写focus0、未知／不匹配基线回退、任务通道变化仍走原事务以及停止精确恢复；不是实际硬件灯效证据。源码检查158项通过，内联语音适配器保持同步。

**交付到当前安装**：正常断开后，仅将已有AU05组件切至Off再On。EnableDirect自动后验曾超时；重新读取该组件详情明确为On，没有盲目重复切换。随后面板已自动连接，额外手动Connect被禁用按钮保护拒绝，未执行第二次连接。最终只读核对：Native进程1个、预期本地源码路径、启动晚于源文件写入、SHA256 `1455cd78f7a282e48574999632b241ca97de81282f0de4b5c9a2042048ed88f9`；界面已连接／运行中·配置回读一致，语音Off、灯光反馈On，实验性K1仍默认Off。未自动开麦克风、未改变语音模式或用户偏好；正常连接仍执行既有在线／心跳／任务灯流程，不能将交付阶段称为零HID写入。旧开发ZIP没有重打包或发布。

**验证边界**：此轮修复了可证明的软件状态下发等待、串行边界及K1与其他灯事务耦合；既往type-only回读成功但实体K1不亮的事实没有被这些合成测试推翻，不能据此宣称实体呼吸已恢复、正确物理入口已完全核实或所有根因已解决。实际内置语音仍需用户开启既有语音和实验性K1开关；不再安排空白对照，不动其他功能。

#### 2026-11-01 22:27：开启内置语音与K1后，正常录音实体复验仍未通过

用户明确要求开启语音和K1开关并验证实体灯效。本轮仅给既有本地UIA助手增加幂等voice-on／k1-on操作，先核对唯一AU05面板、DSH内置语音已选、复选框类型／可用状态并重新定位核验On；没有修改产品代码或其他模式。实际确认设备已连接，语音On、灯光反馈On、实验性K1 On，界面“按住按键1说话”。运行中Native源码SHA仍为 `1455cd78f7a282e48574999632b241ca97de81282f0de4b5c9a2042048ed88f9`，预期路径且进程启动晚于源码写入。用户准备后，按提示正常长按K1约5秒再松开，无需说话、不按K2，不是空白设备对照。

第一段60秒状态采集因诊断视图不可见返回target_missing、0记录；它是观察器未取到字段，不是未录音或灯控失败的证据。用户实际实体观察明确为**全程不亮**。随后不重按、不重新录音、不重连，只重新展开面板／诊断，从同一连接已有32项限长灯控日志中补取1条现存快照：[只读元数据记录](../.local/k1-sync-1a9e6afe-ef79-4b33-945c-063c8ce7ce0c.jsonl)。补取时语音已ready，不冒充同时捕获到录音phase；该快照保留如下本轮历史请求／结果：

| 历史事件 | 请求时间（Unix毫秒） | 请求向量 | 结果时间 | 回读 |
|---|---:|---|---:|---|
| request55 recording | 1793543269865 | [2,0,2,1] | 1793543270351（486ms） | verified；GET1、matched1、timedOut0 |
| request56 running／K1结束 | 1793543274258 | [0,0,2,1] | 1793543274396（138ms） | verified；GET1、matched1、timedOut0 |

两条请求间隔4393ms，其他三通道相同；配置回读期间没有头部拒绝／模式拒绝。补取时observation为DSH／ready／voiceEnabled=true／experimentalK1Lamp=true／focused=true；没有记录音频、转写文本或其他会话内容。结束后依用户本次开启要求保留语音与K1开关开启，设备正常连接，未自动再做录音或隔离探针。

**判定**：本轮实体复验失败，K1修复仍未完成。日志已经证明本次确实下发了K1录音2与结束0并回读一致，不能再用“开关没开／没发指令”解释该次全程不亮，也不能把软件加速／仅K1事务修正称为实体执行入口已确认。补取历史日志没有建立逐帧HID写入与光学时间同步，不从配置verified推导发光；不安排重复空白对照。

#### 2026-11-02：尝试直接旧版K1发包录音复验，未进入实际写灯，已撤回临时源码

用户要求更直接的实体测试。父提出仅临时恢复旧版K1发包组合，用真正内置语音长按／松开验证，而不再空白写灯。准备前界面为内置语音ready、语音On、灯光反馈On、实验性K1 On，未正在录音。普通断开后，仅临时改Native写灯的三处：禁用仅K1快速分支、四通道事务中的K1恢复既有ChannelsFrame（0x7C）、回读使用原MatchesLights。其他通道的编码／目标、语音／按键／客户端即时poll均未改，因此不是恢复历史整份程序。临时源码SHA256为 `0659fd6b3d6c8355e508511484112bb3bf6ddc2a0a3bf7033ff28510fa6116e4`；新增本地compile-only助手仅抽取C#并编译，确认hardwareStarted=false，没有执行SelfTest／Connect／探针。

正常连接后界面显示“未取得原灯光快照，未写灯”。父明确告知这不是有效实体测试，并请求用户唤醒；用户确认已唤醒、允许立即重连一次。该次重连仍显示同一快照缺失，未绕过原配置保护，也未让用户做录音或对灯光下判断。**本轮没有形成正常录音灯效样本，没有新的实体“不亮”结论；不能把准备失败算作旧版发包组合失败。** 原始配置不可用可能来自初始化或应答路径，单凭此界面信息不能断言设备睡眠、用户未唤醒或协议控制码错误。

随后三处临时源码逐字撤回，恢复正常K1代码SHA256 `1455cd78f7a282e48574999632b241ca97de81282f0de4b5c9a2042048ed88f9`，通过正常断开／重连加载；保留用户要求开启的内置语音和K1开关。没有加入未知命令、0x24／MicEnable、固件操作或新参数扫描。最终只读后验：组件已连接、内置语音ready／On、灯光反馈On、K1 On；Native唯一进程、预期路径、启动晚于源码恢复写入，SHA与正常基线一致。灯光状态仍显示原快照缺失，未宣称任务灯实体恢复。K1受控呼吸的实际执行入口仍未确认，不能宣称修复完成。

#### 2026-11-02：修正初始化顺序与首次失败锁死，保留原快照护栏

用户明确要求直接修初始化阻断后实测K1。本次正式仅修改 `packages/dsh-plugin/native/au05.ps1` 和 `test/au05-native.test.js`：

- 初始化改为必要认证→既有SoftwareOnline与Heartbeat→连接状态读取；不再先查询连接状态、之后才宣告在线。用独立 `onlineAuthenticated` 区分未确认认证时保留输入的fallback Online，避免恢复认证成功后错误跳过必要的在线宣告；正常路径不双发Online。恢复查询前清空旧 `linkReady`，不能超时后沿用旧true。
- 仅每次连接第一次真实 `recording` 且K1目标为2、尚无原快照且未改过灯时，允许一次有界恢复认证／连接查询／严格原配置GET。闲置、其他任务、错误K1值均不触发；失败不定时重试，已有快照绝不替换。仍须取得严格匹配的原配置后才能写任何灯，未放宽回包、回读或恢复条件。
- 恢复等待结束时，只在队头为更新requestId、合法state、K1 Off且其他3通道相同时替换迟到On；包括录音仍进行但用户关闭K1的 `state=recording/K1=0` 情况。旧ID只报failed，其他任务变化或旧ID不消费，避免松手／禁用后补亮。

最终Native SHA256 `df459e69870c62d0e1118b18d30f02d3eee8c8a7711ae04927b30c6900b04b80`；测试SHA256 `4601288e73d8ce3c64492bb4aa20dd09fa5c411a94091eb02f014969b205c017`。Native全量20/20、0失败、0跳过、190181.7ms；新增16组Synthetic包括Online前后状态、一次恢复、禁止无限重试、认证失败仍可输入、快照不伪造／不重基线、心跳／取消、旧On替换、禁用K1、其他任务不丢。首次纯编译曾遇新增Synthetic字段CS0649，显式默认值修正后全量重跑通过；不是设备故障样本。父另跑客户端／Host／设备／语音／快捷键／Studio 215项通过，浏览器语音适配器build --check未变，158项源码检查通过。

没有修改Host、客户端、语音和其他按键逻辑、K2/K3/旋钮编码及目标、K1编码、SDK、协议参数、快照解析或cleanup；没有空白灯效隔离探针、未知命令或自动录音。以上证明软件初始化修正与纯回归，不证明K1实体已亮。父随后正常断开／重连加载，实际发包与实体结果另记，不能用纯测试或GET代替现场观察。

#### 2026-11-02 16:41：初始化修正后的正常录音K1实体闭环通过

最终正常连接已核实加载Native `df459e69870c62d0e1118b18d30f02d3eee8c8a7711ae04927b30c6900b04b80`，设备已连接且灯光配置回读一致。没有接新的隔离探针，没有再次重连或自动打开麦克风；用户手动使用内置语音。

首次反馈“全程不亮”后，仅只读取现存Host追踪，文件 `.local/k1-sync-670e33cf-703f-478d-89f5-90b1d728774b.jsonl`。request133确实为recording，但目标为 `[0,2,2,0]`，未请求K1亮；采集时内置语音／灯光On、实验性K1开关Off。准备到反馈间隔约14小时，开关何时或因何变化未建立因果证据，不能擅自归咎用户或软件。该次不是有效的K1 On实体样本，不能由“verified”推导物理灯已开。

随后只打开并只读核实实验性K1，内置语音／灯光／K1三开关均On，保留原麦克风选择，未修改任何生产源码。提醒此实验开关重连会复位，完成正常录音后直接选择实体现象。用户明确选择 **“按住呼吸，松开熄灭”**。父只读收集同一连接既存追踪，不重录、不再写测试灯，得到 `.local/k1-sync-db9ae1f1-be49-4a53-9e38-4402f870ed15.jsonl`：

| 请求 | 实际时间（Asia/Shanghai） | 目标 | 独立回读 |
| --- | --- | --- | --- |
| 167 recording | 16:40:50.255 | `[2,2,2,0]`，K1 On | verified，16:40:50.772；517ms，GET1／matched1／timedOut0 |
| 168 attention | 16:40:59.913 | `[0,2,2,0]`，K1 Off；其他3通道同值 | verified，16:41:00.056；143ms，GET1／matched1／timedOut0 |

On与Off请求相隔9658ms。采集时ready／focused、内置语音On、灯光On、K1 On；这是事后读取追踪，不能虚构采集器现场拍摄或实时看到recording。实体通过依据是用户现场明确确认，回读只提供独立的软件／设备配置对照。结果是**本轮正常内置录音的按住呼吸→松开熄灭闭环通过**，不是全固件／长待机／全部重连路径已穷尽，也未把此前idle阶段的written超时改称verified，更不能把所有历史不亮归结为唯一已证明根因。

保留当前可用连接和三开关状态，不再要求重测。实验性K1每次重连后需要重新启用的既有行为未改；K2/K3／旋钮、语音流程、Host／客户端及其他任务灯功能未改。本轮正式生产变更仍只有Native及必要测试（Native20＋其他215＝235项自动回归通过），没有固件／身份查询、未知指令、录音内容保存、打包发布、提交或推送；旧dev.2分发包没有自动重打，不能声称其包含这次修正。

#### 2026-11-02：0.6.0-dev.3 打包前完整回归与重启验收分界

用户要求先打包当前修正版，再确认完整重启／重连稳定性。只更新三个配套包／工作区的版本与锁文件和必要说明，正式功能源码不改；正常断开设备后打包，不为更新版本启动录音、强杀应用或启动替代 Web 服务。

- 版本：`0.6.0-dev.3`；本地 ZIP／两个 TGZ，不发布、不提交／推送，不覆盖 dev.1／dev.2 历史包。
- 打包源 Native：`df459e69870c62d0e1118b18d30f02d3eee8c8a7711ae04927b30c6900b04b80`；与已通过 K1 实体的初始化修正版一致。
- 完整离线回归：**480 tests／480 pass／0 fail／0 skip**，34 个测试文件。包括当前安装 DSH `0.2.1-rc.5`（构建 `d4db512a969fccf0c5cc7ec8fe38e9c1d27af916`）提取的真实 loader／React／renderer 隔离夹具、原生纯 SelfTest，以及其他输入／语音／Studio 回归。不是现场硬件自动化，也不是完整重启后的结果。
- 原始测试工件：`.local/dev3-regression-ef3cf241-b644-4413-a17d-6fe7a55cf379.tap` 及同名 JSON 汇总；Native 哈希前后未变。
- 重启前只保存本应用的进程身份与启动时间，用于区别完整应用重启、仅刷新页面或仅组件重载；记录时本应用9进程／窗口1，实时 Native 连接0。没有读取凭据、个人会话或设备身份。
- 此节写入打包源时，独立归档校验与完整 DSH 重启／重连实体验收仍待完成；不能把 480 项离线通过扩大为重启稳定性已通过。实验性 K1 重连复位为 Off 的既有规则保留，验证时须明确重新开启。

#### 2026-11-03：Studio 桥退出原因码与一次静默短测

用户授权增加原因码并做一次短测。仅修改自有输入桥的 [producer](<../packages/ulanzi-dsh-input/producer.cjs>)、[服务](<../packages/ulanzi-dsh-input/service.cjs>)及 [入口](<../packages/ulanzi-dsh-input/service.js>)，增加固定事件／原因枚举和相对耗时；不输出异常正文、配对凭据、按键标识、会话内容或录音。保留首个 producer 失败码，避免后续 `identity_failed` 掩盖先前事件超时等原因。退出仍沿用既有清理、超时和失效即停策略，没有增加自动重连或放宽焦点／会话护栏。stdout 使用受保护的同步写，断管不影响服务清理。

- 定向纯回归：51 项通过、0 失败、0 跳过，其中新退出诊断测试36项；覆盖租约／事件请求错误、SDK关闭／错误、信号、首因保留、日志隐私和EPIPE。不是新一轮完整480项或物理按键验收。
- 安装：先核对自有清单24文件，再仅更新上述3个代码文件与其清单哈希；更新后24项及源文件逐字节一致。未改用户预设或全局配置；短测前的显式私密配对保留旧文件并验证当前用户专属ACL。未改Direct Native、灯协议或既有dev.3归档。
- 真实短测仅一次：重新开始当前会话跟随，连接空绑定的接收桥，使用已安装代码连接真实Studio SDK；不确认动作绑定、不请求用户按键、不启动麦克风。SDK于13ms连接，获得20次有效租约响应，空绑定保持为真；20,004ms由测试截止时间正常关闭，唯一终止码为 **`test_complete`**，进程退出0。
- 原始闭合字段证据：[短测结果](<../.local/studio-exit-short-43762a6e-ad14-4116-b36e-40f543408822.json>)。该忽略目录文件是本机复核材料，不包含在旧归档中。
- 清理：SDK由正常关闭路径退出，随后显式断开输入桥、停止跟随并关闭自有设置窗口；最终Direct Native连接0／自有producer进程0／Studio保留运行1，没有强杀或自动切回Direct。
- **结论边界**：本轮没有复现意外退出，不能据此确定上次无日志退出的原因，也不能宣称Studio按键／语音／审批或长期稳定性已通过。后续异常才可用同轮原因码继续定位；未修改不可变分发包，也未提交、推送或发布。

## 2026-11-03 叭哥说 RightAlt 单击切换与 Direct 采集灯源码集成

用户明确授权实现。当前源码新增 [只读状态 Host](<../packages/dsh-plugin/host/bageshuo-state.js>)、[原生元数据观察器](<../packages/dsh-plugin/native/bageshuo-state.ps1>)，接入既有 Direct 控制器／严格 RPC／中文面板；原 AU05 HID 后端 SHA256 仍为 `df459e69870c62d0e1118b18d30f02d3eee8c8a7711ae04927b30c6900b04b80`，不改已通过的内置长按流程和其他三灯协议。

- 新 K1 down 只请求一次完整 RightAlt，up 和长按重复 down 无追加；只读实际采集变化才清除等待，不用按键次数推断。未知／启动中／错误／未确认变化不自动补按，不自动提交草稿或猜测发送结束。
- 只在本机 Direct＋叭哥说预设＋启用语音＋本次连接明确开启实验性 K1 灯时观察。全局灯反馈关闭只控制灯写入，观察同意由独立 K1 开关撤回。窗口／输入焦点护栏保留，浮窗抢焦点提示应用内停止或切回 DSH 输入框，不宣称已实现任意浮窗安全注入。
- 原生实现沿用已实测只读方案的完整 COM ABI；只枚举采集端点会话的 PID／状态，固定唯一根进程 PID＋创建时间＋全路径以及同映像父子链，禁止重启后自动重绑。stdout 仅 `{state,error}`；Host 限定环境变量、10秒启动期限、2秒数据新鲜度以及 EOF 清理和750ms自有子进程终止兜底。不读取音频、窗口正文、转写、历史或剪贴板，不结束叭哥说进程。
- Host 对未知／过期／失去采集的 K1 做熄灭护栏，不改其他三通道；只允许当前 Client 的有效目标请求点亮。关闭观察或断开设备不保证外部采集结束，界面有明确提示。
- 已完成只含合成输入／状态的控制器、Host、RPC 与默认原生 SelfTest；独立字节级检查也使用真实 CRLF／LF 字节验证帧解析，没有执行 Observe。完整回归首次发现两个测试夹具契约过时（环境白名单和上一轮新增入口原因码），保留生产护栏并更新夹具后重新回归：**563/563 通过、0 失败、0 跳过，39 个测试文件**，包含已安装 DSH 0.2.1-rc.5 的离线 loader／React fixture 和原有原生 SelfTest。原始结果：[完整回归日志](<../.local/dev3-regression-6f16adf2-abd2-40d4-8e33-fd0939870419.tap>)。这些结果均不代替实体灯或真实快捷键验收。
- **当前边界**：源码集成不等于这次 RightAlt 启停＋实体呼吸灯已经通过。真实运行需先正常退出 Studio，重新加载 Host／Client 后由人类操作；不自动开麦、补按或发送消息。旧 dev.3 ZIP 不含本次新增，未重打包、提交、推送或发布。

### 2026-11-03 首轮叭哥说实测未通过；选择题输入框边界

- 重启后实查 Studio=0、Direct 原生桥=1、原 AU05 脚本路径／SHA／加载时间正确。正式界面切至叭哥说预设，明确启用语音、灯反馈和本次 K1 观察后，生产只读观察器实际到达 `idle`，无采集错误；这只证明状态观察可运行，不证明按键触发和实体灯。
- 人类首轮报告 K1 无法启动叭哥说、未见灯亮。保留为**未通过**，不以 563 项离线测试替代，不自动补发 RightAlt。回看界面时实际采集仍为 `idle`；只读查询固定文案计数发现常驻焦点帮助之外还有一条同文案错误，但错误阶段未被持久记录，不能唯一反推原生错误码。
- 随后只做不发快捷键的旋钮聚焦对照：人类确认普通聊天输入框可以被旋钮聚焦，选择题下方的补充框不可以；正式面板保留了 `当前视图没有唯一可聚焦输入`。现有 `conversation.input.left` 锚点仅授权同卡片的唯一普通 composer，不包含选择题补充输入。**此前采用选择题工具收集 K1 实测结果的流程不合适**；该边界能够阻断触发，但未证明这就是首轮的唯一原因，也未证明普通 composer 的完整触发已经通过。未扩大为任意输入框注入。
- 后续运行时 URL 变为 61550，新查本次 K1 开关为 Off、观察为 stopped；不能当作有效灯测试。须明确再次启用后再验证，不自动恢复同意。此次排查没有改生产快捷键／焦点／原生灯协议，也未脚本开麦、按键或读取转写。
- 只读独立审核排除了工具显示转义造成的假线索，15 项快捷键测试（含默认原生 SelfTest）通过，但不覆盖真实原生前台／UIA／管道检查。公共 GUI 资源查询得到 HTTP 401 后停止，未读取凭据或绕过鉴权。**下一步只在普通主聊天输入框进行一次人工启停，不再使用选择题式验收。**

### 2026-11-03 普通输入框实测仍未通过；显式恢复只读绑定

- 人类明确报告普通输入框中也无法启动叭哥说、没有亮灯或呼吸；更新为**实测未通过**，不再归因于选择题输入框。事后正式面板保留 `target_exited`，同时只读进程计数为 1；这说明原绑定已失效而现在有应用进程，足以阻断当前快捷键，但没有按下当时的时间线，不能断言是此前失败的唯一原因。
- 另建独立纯测试，不复用旧夹具的路径／换行期待：正常 Windows 路径、真实 LF／CRLF 和固定授权字节 `[103,111,10]` 均通过。新增 9 项通过，连同既有叭哥说与快捷键 5 个测试文件共 69 项通过；未启动实际快捷键、音频或 HID。没有据工具显示的反斜杠转义修改生产发送代码。
- 经人类明确许可，仅关闭再开启本次只读观察并绑定当前应用；未重连 HID、未发送 RightAlt。自动化首次快速开关未稳定保持 On，后检查发现并改为连续状态确认；最终正式界面三开关均为 On，观察为 `idle`、错误为空。此结果只证明当前只读绑定恢复，**不代表快捷键启动或实体灯已修复／通过**；后续仍须在普通输入框验证，失败不补按。

### 2026-11-03 快捷键发送链路：补齐可留存阶段诊断（未实机通过）

- 用户确认当前叭哥说只支持单击开始／再次单击结束；继续使用一次完整 RightAlt 点按，不改成长按或松开补按。独立只读检查再次通过 9 项 wire 测试，确认正常 Windows 路径、真实 LF／CRLF 和 `go` 加 LF 都进入未改写的真实 Host 模块；没有路径／换行静态缺陷，不能据此宣称实际 SendInput 已成功。
- 确认原有错误显示会在焦点／上下文变化时被清空，导致事后只见准备就绪。新增仅 Direct 第三方模式的 `shortcutTrace`：本次连接内存中最近 16 条 `{at,stage,code}`，覆盖 K1 到达、客户端拦截、发起 Host 请求、Host 返回、过期结果丢弃。阶段及错误码均为封闭集合，不记录输入内容、进程路径、会话／owner／context 标识或原始异常；新连接清空，不存入偏好或磁盘。
- 设备面板新增“快捷键链路诊断（仅阶段与错误码）”。`activated` 仅表示原生发送链路报告 Windows 接受输入，不代表叭哥说已启动；实际录音灯仍由独立采集观察驱动。没有改 Host 授权、原生发送、焦点／期限／单次票据、观察绑定或其他灯／按键行为；没有自动快捷键、录音或恢复授权。
- 新增 3 项诊断回归，叭哥说 Client 共 16 项通过；相关 Client、Host、观察、快捷键 wire 及 Studio 动作回归合计 164 项通过。覆盖错误跨焦点保留、封闭字段与未知异常脱敏、环形上限、新连接清空及过期成功不被接受。均非真实快捷键／录音验证。
- 正式界面自动化尝试只打开自身面板，调用后与后续只读检查均未看到设备面板；因此**尚未确认新增诊断已在正式 GUI 加载**。没有重复切换插件、重连或补按。下一步先人工打开自身 AU05 面板确认诊断入口，再决定一次普通输入框验证；现有快捷键／灯实机失败记录保持失败，不升级为通过。

### 2026-11-03 独立快捷键启动实测通过；未包含采集灯

- 人类确认新版“快捷键链路诊断”已显示。正式界面只读预检为设备已连接、叭哥说预设、语音 On；K1 灯授权 Off、只读采集观察 stopped，诊断基线为空。因此刻意只测试快捷键，不自动恢复采集授权，也不把无灯算作失败。
- 在普通主聊天输入框单按一次 K1 后，人类明确报告“启动了”。同连接保留的三条闭合元数据为 `1793685364637 input/k1_down`、`1793685364637 host_requested/sent_to_host`、`1793685365560 host_result/activated`，Host 往返 923 ms；没有重复输入或 discarded。`activated` 本身仅说明 Windows 接受输入；本轮应用启动由独立的人类结果补足。
- **结论：单次 K1 → RightAlt → 叭哥说启动这一轮通过。** 没有测试第二次 K1 停止、实际采集状态驱动灯或长期稳定性，也没有定位此前全部失败的唯一原因。读取前后没有自动快捷键、开麦、HID 重连或只读观察重新绑定；实体灯仍未验收，旧失败记录保留。
- 闭合证据保存在本地验收记录的 `shortcutChainInvestigation.isolatedShortcutTrial`，总体 `accepted` 仍为 false；旧 dev.3 发布包未修改。

### 2026-11-03 启用采集观察后再次失败：阻断点与进程重建证据

**采集日期**：2026-11-03　**执行后端**：正式面板只读 UIA、固定叭哥说进程的只读元数据、官方 API `web_fetch`；无音频流或自动快捷键。**执行查询数**：0（直接抓取 2 个官方 API URL）。

- 人类确认上轮录音手动结束并授权本轮观察后，正式预检为三开关 On、观察从 starting 到 idle、错误为空；原灯光快照仍未取得。随后人类报告 K1 不能启动、物理键盘可以、没有可见灯光。此轮记为失败，不用上轮“观察关闭时的单次启动通过”覆盖。
- 同连接保留的最近 16 条快捷键元数据包含 8 条 `input/k1_down` 和 8 条 `blocked/capture_not_ready`，范围 `1793685939428`—`1793685941494`，其中没有 Host 请求。事后正式观察错误为 `target_exited`；所以保留输入在客户端采集检查处被挡住，不是本次 Windows 发送报错。记录条数不用于推断人类实际点击次数。
- 仅检查固定应用的进程元数据：当前唯一叭哥说进程在 5 个样本中均为 running，其创建时间晚于本轮预检完成时间，也晚于上轮成功发送。说明当前应用确实重建过进程，未查明由谁或何因重建；旧身份固定观察不能自动绑定到新进程。没有导出 PID、路径、创建时间或音频内容，没有自动重新绑定。
- 独立代码审查还确认两个需要修复的原生观察器缺陷，但未证明它们导致本次进程重建或 `target_exited`：一是把仍运行进程的未定义 exit FILETIME 当作退出证明；二是等待轮询边界时重复读取时钟，可能计算出负睡眠时间。当前只读样本的 exit FILETIME 均为零，不能冒认第一项已在现场复现。
- 官方依据（URL 已实际抓取）：[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes) 明确规定运行中进程的 exit FILETIME 内容未定义；[WaitForSingleObject](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject) 规定零超时立即返回、需 SYNCHRONIZE 权限，可区分进程已结束与仍运行。
- 已仅修改[原生采集观察器](<../packages/dsh-plugin/native/bageshuo-state.ps1>)：用 QUERY_LIMITED_INFORMATION | SYNCHRONIZE 的只读句柄及元数据读取前后两次零超时 wait 判断存活，忽略 exit FILETIME；等待失败仍关闭，身份不变式和不自动重绑保留。轮询用一次 elapsed 样本计算 0 或 1—25 ms，零即退出等待，不再可能负值睡眠。Host、Client、快捷键发送和 AU05 灯协议未改。
- 新增[纯原生存活回归](<../test/bageshuo-native-liveness.test.js>)，以假 Win32 适配器调用真实读取编排，覆盖运行中任意 exit FILETIME、前后退出、失败等待、权限失败、异常时恰好关闭一次、身份变化和跨 tick 等待等 11 组；合并既有观察测试 30/30，通过默认纯 SelfTest 和 COM ABI 校验。父代理独立合并 9 个相邻测试文件，**226/226 通过、0 跳过**。均未调用真实 Observe、音频或发送键。
- 本轮没有重复实机按键、自动重绑或加载新观察实例；当前进程确实重建的证据仍与这两个代码缺陷分开。实际采集—实体呼吸灯、停止熄灯与第二次 K1 停止仍未验收；后续重新绑定新应用身份须显式许可。

### 2026-11-03 叭哥说重绑与 Windows 挂起记录（用户显式授权）

- 用户允许重新绑定当前只读观察，并补充此前曾遇到叭哥说崩溃、手动重启和偶发卡死。仅执行自有设备面板的观察开关关→开；从 `target_exited` 经 `starting` 到 `idle`，无错误，后续再次检查仍为 idle。语音、灯光和 K1 观察开关均为 On。没有自动 RightAlt、录音、重启／终止应用或重连 HID；不能升级实体灯验收。
- **采集日期**：2026-11-03　**执行后端**：本机 PowerShell `Get-WinEvent`，Application 日志最近 48 小时，事件 1000／1001／1002，最多 2000 条（未触上限）；仅保留精确关联 bageshuo.exe 的白名单元数据。父代理独立复核同一查询，结果一致。复现：`pwsh -NoProfile -File .local/bageshuo-crash-metadata-20261103.ps1 -ReadAuthorized`（默认不读取）。未访问应用配置、录音、转写、账号数据、日志文件或转储。
- 查到 **1 条**相关事件：**2026-11-03 13:59:37 +08:00**，Windows Error Reporting 1001，`AppHangTransient`，应用版本 `1.0.41.0`。这证明 Windows 曾报告短暂挂起；在所查询的字段中没有模块、异常码或故障桶，无法定位内部根因。窗口内未查到该应用的 1000／1002；不等于证明没有发生过其他崩溃或卡死。
- 当前唯一进程启动于 **14:05:20 +08:00**，晚于挂起记录约 5 分 43 秒，与用户手动重启的描述相容，但不证明重启的具体原因。`Responding=True` 仅为抽样，不能证明持续健康。旧进程身份固定、退出后拒绝继续发送的保护仍保留，不自动追随新进程。
- **未解决**：偶发卡死的线程／组件根因以及采集—实体灯闭环。下一次卡死若用户愿意，应保留当时现场再做有界只读检查；本轮不启用常驻监控，也不采集可能含录音、转写和账号内存的转储。

### 2026-11-03 叭哥说完整单击启停与 K1 呼吸／熄灭确认

- 用户在重新绑定后的普通输入框试验中确认“启动了，也呼吸了”。父代理没有代按快捷键、重新录音或再次重绑。后续只读检查时已为采集 `idle`、无错误、三个开关 On，灯配置回读一致；不能把较晚的 idle 当成试验期间一直没有录音。
- 同连接保留元数据 [.local/k1-sync-659d2def-2faf-4530-9718-a078be2ccf9d.jsonl](<../.local/k1-sync-659d2def-2faf-4530-9718-a078be2ccf9d.jsonl>) 有四组 K1 `[2,0,2,1] → [0,0,2,1]` 请求和独立 GET 验证：84→85（551／137 ms，间隔 4427 ms）、87→88（136／136 ms，3432 ms）、90→91（134／138 ms，3671 ms）、93→94（131／134 ms，2165 ms）。各次 GET 均一次匹配、零超时，其他三路不变。这是配置证据，不替代用户的实体观察，也不能直接换算实际按键次数或断言每次熄灯原因。
- 用户随后明确确认“再次按 K1 停止，停止后 K1 熄灭”。父代理再次只读检查为 `idle`、无错误、三个开关 On、配置回读一致，随后关闭自有面板，未代按、重录或重绑。因此 **Windows Direct／叭哥说 1.0.41.0 的单击 K1 启动 → 实体呼吸 → 再按 K1 停止 → 实体熄灭，单轮闭环通过**；不是仅从配置回读或点击次数推算。
- 人工停止后执行最终全量自动回归：**577/577 通过、0 跳过、41 个测试文件**，包含已安装 DSH `0.2.1-rc.5` loader／React／slots 离线真实夹具；[完整回归日志](<../.local/dev3-regression-fc336ded-06d7-4d58-a756-c6325d0364b8.tap>)。自动回归不启动真实采集或代按，本轮硬件证据来自上述人工试验。AU05 原生灯脚本与旧 dev.3 ZIP SHA256 均保持原基线。
- 本轮未改 UI 的旧“未验证实体灯”标签或默认授权。已更新当前源码的使用说明；旧 dev.3 ZIP 不包含新增功能，未重打包／发布／提交推送。验收记录标为此范围通过；旧失败和应用挂起记录保留，不据本次成功承诺长期稳定、所有固件、Studio 路线或浮窗失焦下无限制快捷键。

### 2026-11-03 叭哥说采集检测／调度降延迟（未重测实体时延）

- 用户要求继续压缩延迟，保留“确认真实采集再亮灯”。仅调整原生观察名义 cadence 250→125 ms，及 Client 对已授权 K1 切换的短时串行轮询：即时唤醒后，最多 2 秒内等待 50 ms（原 200 ms），真实状态改变即唤醒灯更新并回到 200 ms。没有提前写入 `recording`，不从按键次数、浮窗或快捷键结果推断录音。
- 使用浏览器单调时钟限制短窗口；未知／观察错误、Host 拒绝或 RPC 失败、失焦／上下文更换、撤回观察或关闭反馈均取消加速。2 秒到期只恢复普通轮询，不清除切换未确认护栏，也不重发 RightAlt。保留一个 poll RPC 在途和原输入授权规则；稳定状态不永久 50 ms 轮询。
- 独立只读审查确认无推测亮灯／补按／并发 poll；指出 Host 失败后的短时额外快轮询，本轮选择取消并补回归。纯时钟测试覆盖回拨系统时间、窗口过期、停止请求仍保持真实采集灯、状态变化后立即更新、反馈关开／上下文与观察错误等；四个相邻测试文件 **55/55 通过**，不调用真实 Observe、音频或快捷键。
- 第一次全量为 580/581：仅旧安全边界测试仍写死 `nextTick += 250`。已将其改为同时验证 125 ms 常量和生产循环实际使用常量，其他安全断言未删；随后冻结源码再跑完整回归，**582/582 通过、0 跳过、41 个文件**，包含已安装 DSH 的离线 loader／React 夹具；[最终日志](<../.local/dev3-regression-7d434e6c-9ada-4cfc-8502-ea6875e9e792.tap>)。AU05 原生灯脚本、Host 授权／观察协议、2 秒失鲜阈值、内置语音和其他键灯不改。
- 本轮没有重载运行中实例、自动重绑、录音或代按；旧物理闭环验收不等于此版实体时延已测。125／50 ms 是名义检测与调度参数，不是端到端亮灯承诺；加载优化版及新一轮显式观察后才生效，旧 ZIP 仍未更新。

### 2026-11-03 优化版运行试验失败：观察超时阻断 K1

- 用户报告连接后灯全暗、K1 无响应。只读检查：设备仍已连接，任务灯配置回读一致，叭哥说预设与三个开关 On；但观察为 `error / observer_timeout`。保留的 16 条诊断是 8 条 K1 输入与 8 条 `capture_not_ready`，没有 Host 快捷键请求。事件数不等同用户实际按键次数。
- 15:32 查询仍仅有 13:59 的旧 `AppHangTransient`，当前应用还是 14:05:20 启动的同一进程，单次 Responding=True。不能据此认定新崩溃，也不能仅凭超时认定是 125 ms 频率导致；具体阻塞／调度原因未确定。
- 会话待命时任务灯可熄灭，但不是会话停止后禁用 K1 的设计。本轮 K1 被观察失败护栏阻断，与任务灯待命分开。未重绑、重启、代按或放宽看门狗。此前原节奏的功能闭环仍是历史通过；**本次延迟优化的运行／时延验收失败，没有有效实体时延测量**。

### 2026-11-03 按要求回退 250 ms，并只读排查超时

- 先将原生 `PollDelay.CadenceMilliseconds` 从 125 恢复为 **250 ms**，同步纯夹具与安全断言；保留修复后的进程预／后置零等待、完整身份固定、单次时钟采样和非负睡眠。原生及 Host 状态测试 **31/31 通过、0 跳过**。只回退检测频率，不撤销 Client 已有的有界 50 ms 串行调度；2 秒失鲜、10 秒启动、失败关闭、真实采集后才亮灯均不改。原生观察脚本 SHA256 为 `0e690cbaf2d8da3598620d4d4b1f4cc8ea9c83babfb4afa91a5fc7b059f19be5`。
- 静态路径：`ReadTree`／进程身份查询／`PollAudio` 中的 CoreAudio COM 调用是同步系统调用，名义 cadence 不等于单次调用有 250 ms 上限。Host 在 `snapshot`、数据到达及 watchdog 三条路径检查失鲜；超时锁存后停止本代观察，不会补发 RightAlt。现有失败记录只有 `observer_timeout`，没有上次有效帧时间和原生阻塞阶段，**不能倒推出究竟是系统调用、管道／Host 调度还是时钟变化**。Host 目前仍使用 `Date.now`，墙钟变化是待排除因素；本轮不同时修改它，避免在频率回退时引入第二个行为变量。
- 用[默认无动作的限时探针](<../.local/bageshuo-timeout-probe-20261103.mjs>)，明确授权后调用回退源码和原样生产 Host 观察类，在独立 Node 进程中只读观察 20 秒；不打开录音、不接管 AU05、不重绑产品连接。结果：20012.1 ms，78 帧均为 idle，首帧 747.6 ms，最大管道到达间隔 270 ms，每块最多 1 帧，Host 探针事件循环最大延迟 34 ms，墙钟／单调钟最大漂移 0.8 ms，无未知、无错误／协议异常，结束后自有子进程 close 已确认。不是原生调用耗时、不是光学延迟，也不是实际 DSH Host 负载下的测量。
- 冻结回退后的完整回归 **582/582 通过、0 跳过、41 个文件**，包含已安装 DSH 的离线 loader／React 夹具；[完整日志](<../.local/dev3-regression-05991d14-ebbb-476d-b544-f54ef47e31b2.tap>)。167 个源码文件检查及 diff 检查通过；AU05 灯协议脚本和旧 ZIP 哈希未变。这些均不是实体时延验收。
- **结论与下一步**：回退后的独立只读短测未复现超时，历史超时根因仍未确定；产品中已经失败的观察实例未自动恢复，本轮未作实体启停／时延重测。需要产品侧显式开启新一轮观察，在真实 Host 中保留失鲜时的有效帧年龄、事件循环延迟及原生阶段，才可进一步定位；不通过加大超时或推测亮灯掩盖问题。旧失败记录、此前单轮功能通过及不可变 ZIP 均保留，未重打包／提交／发布。结果保存在[本轮记录](<../.local/bageshuo-cadence-rollback-20261103.json>)。

### 2026-11-03 取消请求残留锁与保守调度优化

- 现场设备已连接、观察为 idle／无错误，但保留快捷键记录包含 `shortcut_voice_cancelled` 后连续 `transition_unconfirmed`；不是本轮观察超时，也不能由会话停止直接推断按键被禁用。此前只确认 idle 就声称恢复可用，证据不足。
- 修复将“确认未发送”和“结果不明”分开：Host 仅在原生 go 授权未提交时提供 `notSent:true`，同时保留连接所有者／代次／按键序号绑定的正常轮询确认，解决取消导致 RPC 回复丢失的残留锁。Client 只解除匹配的原始切换，不补按、不接受旧代次或其他按键确认；提交后取消／不明错误仍保持护栏。面板加入 Host 协议加载标记，不用源码存在冒充当前运行实例已更新。
- 保留原生 250 ms 采集检测和 2 秒失鲜护栏；仅当前输入框聚焦且观察有效、没有未确认切换时，将原有串行按键投递等待由 200 缩为 100 ms。已有最多 2 秒的 50 ms 切换窗口与真实采集变化后的立即灯更新保留。没有改变灯协议、权限、K2／K3／旋钮或 Studio，也没有自动快捷键／录音。
- 冻结后的八组针对性回归 **188/188 通过**，包含取消前／后授权、重复同序号请求、丢失回复后的轮询确认、旧连接隔离、Client 防重复与原生 250 ms 身份／失鲜护栏；浏览器适配器检查、167 项源码检查及 diff 检查通过。没有运行新的真实快捷键或录音。
- 现有 GUI 的官方组件 Off／On 均独立确认；插件详情层仍遮挡胶囊，安全作用域校验拒绝自动关闭，未点通用 Close、未关闭主窗口。新 Host 协议标记、设备连接与显式观察恢复尚待详情关闭后确认，**不将组件开关成功当作当前功能恢复或实体时延验收**。没有重打包、提交或发布；此前失败与单轮物理通过均保留。

## 2026-11-04 官方 AU05 亮度范围及单字段更新

只读核对本机安装文件，不执行官方 EXE／DLL、不抓取录音或写 HID。对象及 SHA-256：`C:/Program Files (x86)/Ulanzi Studio/UlanziDeck.exe`，`85896a993e758689990f64d94c726e2c23234ed0e48c9176e6e9a30b2f8a05ca`；同目录 `Ulanzi_Studio.dll`，`2e37239e7bd6cc7a9bf0395eae05aa9892b1544a6dace45d9f009b7bc131bd48`。地址为各文件 RVA，不冒称官方源码或运行时抓包。

- EXE `0x118a85–0x118ad6` 设置同一滑块 minimum=0、maximum=`0x14`(20)、step=1；`0x11a306–0x11a32c` / `0x11a8a0–0x11a8cd` 的 D100N 分支才改为 100，不是 AU05。`0–20` 有 21 个取值，不能误写为 `0–21`。
- `SettingDialog::onLightBrightnessChanged`（`0x11cde0`）直接传滑块整数：模式 1 调全亮亮度；模式 2 调旋钮常亮亮度（index=3）和三个按键呼吸亮度（index=0/1/2）。wrapper `0xc5e70/0xc60a0` 无缩放，未发现百分比、gamma 或亮度 +1。
- SDK AU05 指示灯族为 `01 0B 88`，mask 位独立：mode=`0x01`、allOnBright=`0x02`、type=`0x04`、time=`0x08`、breatheLevel=`0x10`、breatheBright=`0x20`、alwaysOnBright=`0x40`；索引在 plain[5]。SDK `0x581a0→0x3d070` 和 `0x583b0→0x3d420` 分别只请求呼吸／常亮亮度，直接写入参数低 8 位。单字段 setter 不是请求重写整条工作记录。
- 用户随后要求按此范围及字段策略修改。当前 Direct 始终接管工作模式 2，因此只对齐该模式的亮度映射，不新增全亮 UI，也不修改 `allOnBright`。GUI 采用 `0–20`，Host/native 字节范围继续 `0–255`；保留严格原快照、live 基线及真实回读比较。没有把静态范围推成硬件绝对上限、光学线性或 raw 21 全灭的唯一根因。

可复核的[静态实现报告](<../Temp/studio-brightness-review-20261104.md>)、[SDK 字段报告](<../Temp/sdk-brightness-evidence.md>)与[当前实现／验收边界](<brightness-recovery.md#2026-11-04-按官方亮度逻辑对齐>)。本轮未安装或重启插件、未连接设备、未启动录音或实机试灯；新的实体亮度验收另行授权。

## 2026-11-05 叭哥说频繁超时与同身份监控恢复（源码修复，未加载实机）

- 离线假时钟确定复现旧 Host 的两项问题：`Date.now` 前跳越过 2 秒预算会误报超时，回拨会延长旧 `recording` 的可信期；Host 暂停超过 2 秒后，即使子进程恢复输出，也会先进入永久终止分支。后二者把一次短暂失鲜放大为本代永久不可用，不是“叭哥说必然崩溃”的证据。运行中和启动超时原来都显示“启动超时”，现已分开。
- Host 的启动／失鲜／恢复预算改用 `performance.now`；平台工厂单独注入单调时钟，快捷键票据仍保留原有墙钟与授权逻辑。保留 250 ms 原生检测、2 秒有效状态期限、10 秒首次启动期限。运行中失鲜立即变成 `unknown / observer_recovering`，撤销录音灯可信提示并禁用 K1；在**同一观察子进程／同一完整目标身份**内发送递增 `probe:n`，最多等待 10 秒，超时才终止并要求显式重连。没有自动启动应用、重生观察进程或静默绑定新目标。
- 私有 Observe 管道仅新增闭合的 `{state,error,request}`／`{phase,request}` 帧；公共 RPC 仍只有 `{state,error}`，无 PID、路径、端点、音频或正文。原生每轮在全部身份／进程树／CoreAudio 检查前锁存 request，阻塞期间收到挑战不能给旧结果换标签。旧批量帧、旧 probe、跨失鲜的半行均不能恢复可信状态；启动或恢复阶段每 2 秒作废未完成的挑战，只有本次挑战往返不足 2 秒的完整结果可建立可信状态，**不延长原有 10 秒截止**，因此恢复期间再次暂停后的积压匹配响应也不能重新亮灯。阶段通知不续任何预算；完整采样耗时达到 2 秒也只能报告未知。身份变化／退出／多实例等错误，即使来自旧 request 仍立即终止，不能被恢复过滤吞掉。
- 恢复只更新实际观察状态，不发送快捷键、不重放按住的 K1，不解除结果不明的切换锁；仍只允许相反实际采集状态或原按键的 `notSent` 证明解除。Client 同时撤回自己过期的“正在恢复观察”临时提示，保留其他错误与外部采集风险提醒。仅 K1 可信提示变化，任务灯和其他语音模式不改。
- 新增 Host 元数据诊断前缀 `[au05:bageshuo-observer]`：`sample_timeout / probe_renewed / recovered / recovery_timeout / startup_timeout / clock_changed`，含最后收到的阶段、有效帧年龄、watchdog 延迟和显著墙钟漂移。阶段是 Host 最后收到的诊断，不足以单独证明具体系统 API 卡住；积压或 Host 暂停仍需结合延迟判断。没有输出异常原文、原始管道、进程身份、路径或音频。
- 最后一次针对性八文件 **102/102 通过，零跳过**（[日志](<../.local/bageshuo-recovery-20261105-focused.log>)），含新纯时钟／积压匹配响应／半行／同身份恢复／请求与日志回调重入／失效关闭、Client 防重放和跨应用隔离测试；`npm run build:plugin`、受影响 JS 语法检查、原生默认纯 SelfTest、Win32 假接口测试均通过。完全替换真实元数据／COM 方法的原生循环夹具，用真实 stdin 验证挑战在旧轮询阻塞期间到达时，旧结果仍保留旧标签，并验证耗时过长的匹配样本降为未知；两个场景均使用假时钟，不受测试机调度影响。
- 完整 `npm test` 快照为 **790 项：779 通过、10 失败、1 跳过**（[日志](<../.local/bageshuo-recovery-20261105-final.log>)），不能宣称全套通过。7 项因既有通用 Hooks 测试引用缺失的 `packages/dsh-hooks` 模块而无法加载；[插件静态断言](<../test/plugin.test.js#L30>) 将已有区域滚轮事件计入后得到 `2 !== 1`；两项 [Studio 测试](<../test/studio-action-integration.test.js#L126>) 仍只寻找 200 ms 定时器，与当前区域模式 16 ms 默认值冲突。这些路径未因本次恢复扩权或修改；未为了全绿补造缺失模块、删除滚轮事件或改动 Studio 行为。全套启动后又加固了日志回调重入窗口，随后在最终源码上重跑上述 102 项，全部通过。
- `npm run check` 遇到本轮未修改的 PNG 文件失败：检查器把所有文件按 UTF-8 文本读取，在 [compare-desktop.png](<visual/au05-panel/compare-desktop.png>) 报 `replacement_character`；不是本轮 JS／C# 编译错误，未删除图片或放宽检查器来掩盖。运行中实例未安装／重载，未操作设备、录音或系统快捷键；未做新 UI 目视、真实 Host 长期负载或实体灯验收。**现场频繁失鲜究竟由 CoreAudio、进程查询还是 Host 调度触发仍未确定**；此次确认并修复的是墙钟误判与短暂失鲜无法安全恢复的实现缺陷。

## 2026-11-06 区域滚动复用官方对齐原生链路（源码与隔离验证，未重载）

- 本轮对比的是两条已有路径，不把“滚动不顺”直接归因于设备或桌面崩溃：[原官方滚轮证据](<../Temp/native-scroll-evidence.md>) 记录 `SendInput / MOUSEEVENTF_WHEEL / ±120 delta`，旧“上下滚动”已使用带单次物理手势票据的原生桥；“区域切换”的非选项区域此前仍是 DOM `instant / ±80px`。二者并非同一实现，delta 也不是 CSS 像素；这确认了复用缺口，不证明现场所有卡顿的唯一原因。
- Windows 本机桌面直连的区域滚动现复用同一个 `nativeScroll` RPC、Host 单次票据和原生桥，不另造输入注入器，不改变固定方向、500 ms 时效、32 项请求上限或 16 ms 单路轮询。选定原生后完全接管本次旋转，即使接口失败、超时或结果未知也不发合成 wheel、不写 DOM、不重试。浏览器／Studio 保留显式 DOM 行为；选择题仍只移动焦点，由 K2 单独确认。
- 区域选择每次产生不可复用的元素租约；A→B→A、清除后重选和同名元素替换均不能使旧请求复活。切区立即取消既存滚轮请求；所有 `sync / reconcile` 副作用之后再检查 abort、上下文和租约。按下旋钮的有序物理序号本身就是同批 `right → knob → right` 的切区边界，因此不额外排空事件、不轮换全局 context，也不为切区重启原生桥或新增语音撤销。
- 原生请求前检查鼠标仍在选中区域，排除悬停编辑器、嵌套滚动区、iframe／对象／开放 shadow root 和已知滚动端点；pointermove／pointerout 会撤销不再满足条件的待发请求，失焦、会话／待处理问题变化、模式切换和断开仍沿用原有撤销。原生仍是全局系统滚轮，**不能原子绑定 DOM 元素，已经发出的输入也不能撤回**；这些前置检查不构成严格 DOM 隔离承诺，不移动鼠标或抢焦点。
- 最终构建、嵌入一致性和受影响 JS 语法检查通过，8 文件针对性回归 **300/300 通过，零跳过**（[日志](<../.local/au05-region-native-20261106-focused.log>)），包括完整 Client 178 项、区域模块、原生桥／Host 票据、叭哥说与平台工厂。覆盖独立侧栏／对话／textarea、鼠标和嵌套接收器、正向／反向端点、10 类晚 RPC 撤销、A→B→A、同批切区、选项焦点／K2 分离及持有 K1 不被额外取消。所有设备、RPC、输入注入均为替身，原生只运行默认纯 SelfTest，不执行 `Listen / Observe`。
- 完整 `npm test` 为 **844 项：833 通过、10 失败、1 跳过**，约 401 秒（[日志](<../.local/au05-region-native-20261106-full.log>)）。10 项与修复前已记录的失败一致：7 项缺少 `packages/dsh-hooks` 模块；[旧静态断言](<../test/plugin.test.js#L30>) 的 `dispatchEvent` 数量仍是 `2 !== 1`；两项 [Studio 夹具](<../test/studio-action-integration.test.js#L126>) 仍只寻找 200 ms 定时器而不是区域模式已有的 16 ms。没有为凑全绿修改缺失模块或这些无关断言。回归期间还遇到仓库并行胶囊修改尚未嵌入的瞬态 `ReferenceError: createFloatingCapsule is not defined`；现有构建链补齐后已重新构建，并在最终 300 项与上述全套中不再出现，未改动胶囊实现。
- 按更新后的布局规则补读 [设计规范](<../DESIGN.md>)，没有改面板布局或基线。现有隔离 Playwright 本机预检 **32/32 通过**（[日志](<../.local/au05-region-native-20261106-visual-preflight.log>)，Chromium 145.0.7632.6），覆盖明／暗、窄屏、短窗、设置及状态更新，无设备／网络调用；预检模式不执行截图基线比较，不能当成固定 `v1.58.2-noble` Linux 环境的视觉回归通过，后者本轮未运行，也未更新基线。
- 本次未安装或重载插件、未连接设备、未发送系统滚轮／快捷键、未录音或操作真实审批；未做新 UI 人工目视或实体手感验收。此前叭哥说验证期间已经重载过 AU05，随后桌面 renderer 崩溃，二者因果未确定；旧的监控实机恢复验证仍暂停，不能把本轮离线通过当成已验证桌面稳定或手感改善。

## 2026-11-06 区域模式改为定向滚动、不依赖光标（源码，未重载）

- 用户在上一节方案加载后仍反馈难滚，并明确要求“选中哪个区域就滚哪个区域，不依赖鼠标位置”。因此本节取代上一节的**区域模式**原生方案，而不是继续放宽系统输入的命中检查；旧“上下滚动”模式保留原生桥及全部票据、前台、鼠标与修饰键护栏。
- `regions` 在桌面、浏览器及 Studio 一律调用已有局部 DOM 路径，直接操作当前高亮容器；不再读取光标命中或悬停子容器，也不调用 `nativeScroll`。区域模式的直连 poll 明确发送 `nativeScroll:false`，不为此模式预热系统滚轮进程；Studio 的原有协议字段仍不增加。未添加移动鼠标、全局键盘、系统滚轮或自动确认。
- 每格沿用局部 DOM `±80 CSS px / instant`，不是把官方 wheel delta ±120 当成像素。连续格按实际位置处理，反向和手动滚动后从可见位置继续，不累积过时动画终点；正向、反向 column-reverse 容器分别钳制到自身端点，不串滚祖先或其他区域。本轮没有凭此承诺实机手感已经验收。
- 保留显式选区、独立元素租约、同批物理事件顺序、连接代次、上下文、时效及失焦／会话／待处理问题变更撤销。选择题仍只移动焦点，K2 才确认。对话只在已验证的 `data-conversation-scroll` 外层发合成 wheel 意图以解除宿主自动跟随，随后直接写该容器；这不是操作系统输入。回调若同步清除／切换区域、替换元素或失去目标焦点，旧格不能继续写；重新核验当前目标的 `focused`，并按回调后新尺寸钳制位置。
- 构建、生成物 `--check`、相关 JS 语法与 `git diff --check` 通过；`impeccable detect --json` 无命中。最终冻结源码后的 8 文件相关回归 **314/314、0 skip** 通过（1.39s，`.local/au05-region-direct-20261106-focused.log`），含客户端 190 项、区域模块以及旧原生桥／控制器、语音与平台护栏；先前 35 项基础回归均包含在此范围内。新用例覆盖光标／嵌套控件／修饰键无关、连续反向与端点、物理事件去重时效、同步失焦／切区／节点替换撤销、回调后尺寸钳制、K1 不误取消与选项不自动确认。未为本轮重复运行耗时全套 `npm test`，也不将上一节全套的既有失败记为本轮通过。
- 新增隔离真实 Chromium DOM 回归 `test/visual/au05-regions.spec.mjs`，**6/6** 通过（Chromium 145.0.7632.6，5.0s，输出 `.local/au05-region-direct-browser`）。直接注入当前区域源码，不替换浏览器几何或滚动实现；验证实际鼠标悬停别处／嵌套输入时仍只滚高亮容器、即时连续反向与手动位置、真实负 `scrollTop` 的 column-reverse、端点不串滚祖先、精确外层 wheel 意图、14 类旧租约撤销，以及选择题显式提交。夹具阻止网络、Host/RPC、设备／媒体、键盘及全局 wheel／window 滚动；不访问真实 DSH 页面。
- 当前 Windows canonical `chromium-win32` 截图回归 32/32 通过（29.2s），记录 `.local/au05-region-direct-20261106-panel.log`；未更新截图基线，未改面板布局或颜色。该截图矩阵不等于滚动手感验收。仅源码与替身／隔离浏览器验证，未自动安装／重载插件、未连接设备、未操作真实审批／录音／系统输入；此前监控恢复实机验证仍暂停。

## 2026-11-06 区域模式逐帧平滑、连续合并与反向制动（源码，未重载）

- 用户反馈上一节定向滚动仍有台阶感，并明确要求保留选区语义、改为逐帧平滑，同向合并、反向立即制动。本节替代上一节的 `instant` 视觉表现，不撤回“不依赖鼠标位置”的边界；不是声称复刻官方 AU05 全部协议或实机手感。旧“上下滚动”的原生桥、500 ms 单次物理票据与修饰键／前台限制均未改。
- 先检查已有胶囊／翻页路径并调研 [RAF 时间戳](<https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame>)、[负值／亚像素 scrollTop](<https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTop>) 及 [减少动态效果](<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>)；选择扩展已有[区域模块](<../packages/dsh-plugin/src/regions.js>)，不引入动画依赖。浏览器原生 smooth 的旧翻页累计终点不适合选区租约撤销；通用 tween 库也不能替代会话／焦点／节点护栏。
- 每个导航实例只有一份 motion 和一个待执行 RAF。每格给目标增加 80 CSS px；按时间计算 `to + (position - to) * exp(-elapsed / 45)`，剩余不超过 0.5 px 时落到目标。同向格仅延伸同一目标，不重启缓动或追加循环；反向先撤销旧帧和余程，再从**实际可见位置**建立反向目标。保留理想小数进度与实际 DOM 回读，避免 Chromium 像素取整使动画停滞；本地受控 60／120 Hz 等时推进一致。
- 每帧重新读取当前目标及端口，检查焦点、会话／owner／pending、元素租约／节点和端点；不重用捕获的 textarea 或桥引用。切区、清除、节点替换、失焦或上下文变化取消旧动画；几何信号也使用新端口立即核验。手动滚动相对自身回读偏移超过 1 px、帧间隔超过 100 ms、非法／倒退时间戳或宿主拒绝位置写入时取消，不补播旧路程。首次 RAF 时间戳可能比调用时 performance.now 略早，仅首帧允许不超过 32 ms 的前置时间并重新建立基点、不写位移；已开始后的回退仍取消。
- 对话仍只向已验证外层发合成 wheel 意图解除宿主跟随，写位置前后重新检查租约；这是 DOM 意图，不是系统输入。实际每帧写入使用 `behavior:'instant'`，唯一插值器是自己的 RAF，不叠加浏览器 smooth。减少动态效果、缺少 RAF／取消或计时 API 时使用有界即时路径，媒体设置变化取消当前动画，不自动恢复旧余程。选项仍只移焦点，K2 才确认；K1 与旧翻页／原生模式护栏不变。
- 最终构建、生成物 `--check`、受影响 JS 语法和 `git diff --check` 通过，静态 `impeccable detect --json` 无命中。最终冻结源码后的 8 文件针对性回归 **357/357、0 skip**（[日志](<../.local/au05-region-smooth-20261106-final-focused.log#L367>)，1.57s），含客户端 224 项、区域模块 25 项及原生／语音／平台回归；覆盖同向目标合并、单队列、首帧前置时间、逐帧反向、手动位置、14 类旧租约撤销、同步 Host 回调、反向容器与像素取整。未为本轮重复耗时全套 `npm test`，不将历史 10 项失败记为已修复。
- 隔离真实 Chromium 145.0.7632.6 回归 **13/13** 通过（7.9s），保留原有 6 个安全场景并新增 7 个帧场景。受控时间下单格 `120→144@16ms→161@32ms→200@240ms`，五格合并到 520 且最多一帧待执行，反向 `442→418→401` 不再推进旧方向；13 类撤销后无额外写入。额外原生 RAF／performance.now **不替换时钟**，实测 `120→142@15.3ms→160@31.9ms→…→200@231.9ms`，出现 12 次真实异步 scroll 事件（[原生帧 JSON](<../.local/au05-region-smooth-browser-20261106/au05-regions-opt-in-select-138e2-y-the-selected-conversation-chromium-win32/real-chromium-frame-samples.json>)）。父、子代理均打开核查[中间帧截图](<../.local/au05-region-smooth-browser-20261106/au05-regions-opt-in-select-2e9c7-r-adds-native-CSS-smoothing-chromium-win32/conversation-intermediate-frame.png>)：蓝框选中容器内编号行已逐步移动，无关容器未动；这不是实体设备的运动手感证据。
- 区域夹具显式调用 `page.emulateMedia` 并核验真实 matchMedia，不依赖本机安装的 Playwright 顶层 `use.reducedMotion` 透传；减少动态效果下 `120→200` 即时完成、RAF 请求为零。未顺带改全局配置或截图基线。现有 Windows canonical 面板 **32/32** 截图回归通过（[日志](<../.local/au05-region-smooth-20261106-panel.log#L46>)，29.2s），面板布局与颜色未变。
- 本次仅源码、替身和隔离浏览器验证；没有安装／重载插件、连接设备、发送系统输入、录音或操作真实审批。浏览器帧轨迹不是实体设备延迟／FPS 基准，截图不证明已加载的 DSH 手感或桌面稳定性；叭哥说监控恢复的旧实机验证仍暂停。

## 2026-11-06 RAF 版本重载与实体反馈：手感未通过

- 用户明确要求重载并验证实际设备手感，遂通过官方管理器安装并启用新版 `@abworks/dsh-plugin-au05@0.6.0-dev.3`，结果 `application:applied`；未额外执行停用／启用、DSH 重启或 GUI 自动化。完整备份、归档 SHA256、包管理日志和校验结果见[重载回执](<../Temp/au05-region-smooth-live-20261106-044500/reload-receipt.json>)；26 个发布文件均与工作区一致，客户端 SHA256 为 `2491A20E42B8ACD7CE579C68F067383130A09CE7AF481768132BF8BD0F243A05`，区域源码仍为前节已验证版本 `556694EBF78DA5B967FBC1DC22D33E74475B92CE5DB10F7722939FAE56FD6E22`。安装前相关回归再次 **357/357、0 skip**（[日志](<../.local/au05-region-smooth-20261106-live-reload-check.log#L367>)）。这些是包及离线证据，不是实际 renderer 分支或手感证据。
- 实体旋钮由用户操作；要求区域模式、对话高亮、光标移到别处、避开端点，检查连续滚动／反向／切区。用户反馈 **“仍卡顿或台阶明显”**；进一步仅慢转一格的区分反馈为 **“单格也会卡住、晃动或走走停停”**。因此本次实机手感验收记为**失败／未达标**，不能沿用隔离浏览器通过的结论宣称已解决。反向和切区停止尚未单独获得通过反馈。
- 只读调用 `SPI_GETCLIENTAREAANIMATION`，2026-11-06 05:17:08+08:00 返回 Windows 客户区动画启用；未更改系统设置。尚未直接读取真实 renderer 的 matchMedia、加载分支、帧轨迹或取消原因，不能以此排除页面级减少动态效果、宿主位置校正、主线程时延或动画自身撤销，也不能断言旋钮硬件有故障。源码中可见的 100 ms 取消门槛和全量区域发现只是待测线索，不是现场因果证据。
- 记录反馈后没有再改动画参数或重复重载，也未发送系统输入、触发录音或操作审批。若继续定位，应先取得临时诊断授权，仅采集事件／帧时间、数值位置与取消原因，不采集聊天内容或录屏；此前叭哥说监控恢复的实机验证仍暂停。

## 2026-11-07 临时区域滚动诊断：限时本地数值采样

- 在用户反馈单格也卡住之后，用户另行明确授权“允许诊断并重载一次”。本轮只加取证，不改变 `80 px / 45 ms`、`100 ms` 帧间隔取消门槛、`1 px` 外部位置偏差门槛、RAF 合并／反向或 owner／焦点／租约检查，不以离线通过代替手感验收。叭哥说监控恢复的旧实机验证仍暂停。
- 采样手动开启，最多 `5000 ms`、`240` 行环形缓冲，仅在 renderer 内存保存；不启用服务器日志、网络、持久存储、录屏、音频或聊天内容采集。输入行只复制阶段、方向、序号和年龄；区域名、停止原因均为固定枚举，帧行只含数值时间／实际与目标位置／偏差／回调耗时。结束后只读 JSON 由用户手动复制，没有剪贴板读取。采样前不存行，停止或超时后不补写，重新采样重置缓冲；读取返回防御性副本。
- 在原有 `高级设置` 下提供默认折叠的“滚动诊断”，只在区域模式或已有采样结果时显示。一个 5 秒结束计时器，仅开始、结束及连接／模式撤销时发布快照；不逐帧更新 React。失焦／切会话保留采样以记录被阻止的输入和原有动画撤销；禁用、断开、模式退出或销毁结束采样，不自动恢复。采样停止本身不停止动画。
- 数值行可区分 `external_offset`（帧前实际位置不同于上次回读）、`frame_gap`、`clock_backwards`、`write_refused`、`reduced_motion` 等既有分支，但原因码不是外部写入者身份或系统故障结论。采样有少量观测开销；回调耗时和独立 geometry 回调耗时帮助定位，不能直接外推未采样时的性能。
- 构建及相关 8 文件最终 **366/366、0 skip** 通过（[日志](<../.local/au05-region-diagnostics-20261107-final-focused.log#L376>)）：新增采样隐私／边界／停止与原动画等价测试，原有 25 个区域行为测试不放宽。隔离真实 Chromium **15/15** 通过（[日志](<../.local/au05-region-diagnostics-browser-20261107-attempt2.log#L50>)），验证开关诊断时位置／写入／RAF 数量等价、帧与停止原因可解释、240 行上限和 5000 ms 边界；这不是实际设备手感证据。
- Windows canonical 面板 **33/33** 通过（[日志](<../.local/au05-region-diagnostics-20261107-verified-panel.log#L47>)）。初版在 legacy 模式显示无关诊断行，导致 8 个旧高级设置截图位移；修正为仅区域模式或已有结果可见后，原有 32 例与旧基线均通过、没有更新旧基线。新增窄屏入口／采样禁用／退出模式仍可读结果／键盘焦点及无越界检查；先目视检查实际 ready/result 图，再仅创建并核验这两份新增基线。不以更新基线掩盖既有差异。
- 按授权只通过官方管理器额外重载 **1 次**，`application:applied`、包管理退出 0；26 个发布文件与工作区哈希一致，原安装完整备份并逐文件校验，见[重载回执](<../Temp/au05-region-diagnostics-live-20261107-054900/reload-receipt.json>)。未额外停用／启用、重启 DSH、自动操作 GUI／设备／录音／系统输入／审批。包管理器已有的可选 cpu-features 编译和 inspector 警告仍存在，不据此断言现场因果。重载后等待用户手工回传；随后收到的数值样本及分析见下节。

## 2026-11-07 用户回传数值样本：事件积压与 frame_gap 撤销已出现

- 用户手动粘贴了一份 `5000 ms`、`expired`、缓冲 `dropped:0` 的数值样本；区域始终为 `sessions`（会话列表），不是此前提示的对话区。`reducedMotion:false`，RAF／cancel／单调时钟均可用，且实际出现动画写入：此份不是减少动态效果或缺少 RAF 的即时回退。统计对象是软件旋转 pulse，不据此换算实体旋钮格数。仅在回执保存派生数值和结论，不新增后台采集或原始内容存储。
- 连续序号 `19–55` 共 **37** 条旋转输入，**6** 条 accepted、**31** 条因 stale 丢弃（**83.78%**）。received 时记录的年龄为 `192–1581 ms`；年龄字段在进入处理时采样，而 freshness 在 `sync()` 之后重新读取时间，所以 `ageMs:952/975/985` 仍可能随后判 stale，并非诊断状态矛盾。全部 20 条负向输入均过期，不能把这次样本当作“反向制动已通过”。对应 [输入检查](<../packages/dsh-plugin/client.js#L1443-L1464>)。
- 6 条 accepted 到对应 detent 的同步路径分别耗时 `104.9/107.8/111.8/112.8/107.9/105.2 ms`，平均 **108.4 ms**。代码在 accepted 后同步调用 `regions.rotate()`；该路径仍重复做区域发现及有效性检查。这是这段调用链实际经过的时间，不能仅凭这份粗粒度记录将全部开销归到某一个函数、布局或外部插件。对应 [区域分发](<../packages/dsh-plugin/client.js#L1548-L1556>)、[区域旋转](<../packages/dsh-plugin/src/regions.js#L311-L371>)。
- 出现 **6 次 frame_gap stop**：既有同向 detent 合并前的 `at-motion.at>100` 检查，也有 RAF 内的间隔检查；不是每个 stop 都来自 RAF 回调。记录到的 RAF 间隔含 `183.4/169.762 ms`，最大 callbackLag **170.7 ms**、最大回调 work **65.5 ms**。仅一条成功动画写入，位置 `0→25 px`，随后又撤销；所有已记录 offset 都是 0，没有 `external_offset` stop，故此份没有“位置被宿主拉回”的正面证据。对应 [帧检查](<../packages/dsh-plugin/src/regions.js#L118-L161>)、[合并前检查](<../packages/dsh-plugin/src/regions.js#L358-L362>)。
- 已证实的失效链路为：**处理／调度积压，输入越来越旧；现有 100 ms 策略反复丢掉尚未完成的动画，1000 ms 输入检查继续丢弃事件**。这能解释此样本的卡住与走走停停，但具体拖慢热点、未采样时的耗时及对话区表现仍未独立测出；不能外推硬件故障、鼠标位置错误或唯一外部阻塞来源。下一步应优先减少事件与帧路径中的重复全量发现／同步布局，并在不放宽 owner、焦点、租约与陈旧输入保护的前提下验证；不能只增大超时或补放旧输入。本轮仅记录分析，**没有改生产参数或再次重载，手感仍不记为通过**。派生统计见[更新后的回执](<../Temp/au05-region-diagnostics-live-20261107-054900/reload-receipt.json>)。

## 2026-11-07 区域滚动热路径：减少重复发现与布局失效（未重载）

- 用户要求定位瓶颈并优化重复区域发现／同步检查。本轮针对前节现场积压线索，进一步确认源码中的冗余工作：每次 `rotate()` 先 reconcile 全量候选再重复发现，选中会话列表或对话时仍读取其他区域；现代树已足以辨识列表，却同时枚举全局行；每次 poll／scroll 无条件重写高亮框样式和标签，下一次几何读取又可能强制布局。只据此确认可消除的重复工作，不把它等同于现场 108.4 ms 的完整 CPU 归因。
- [区域发现](<../packages/dsh-plugin/src/regions.js#L211>)现在只有切换区域时发现完整有序列表；校验、旋转和 RAF 只重新发现选中那一类。现代树只找首个合法标记，确认唯一可见滚动容器后不再扫描全局行；旧宿主回退和多容器歧义检查保留。内部 [resolveRegion](<../packages/dsh-plugin/src/regions.js#L297>) 返回本次已验证对象，旋转／选择直接复用，避免同一调用重复扫描；不跨调用缓存节点、可见性、owner 或目标。Host wheel 同步回调后的撤销检查仍重新执行。
- [可见性读取](<../packages/dsh-plugin/src/regions.js#L175>)复用同一次矩形结果；[高亮框绘制](<../packages/dsh-plugin/src/regions.js#L270>)静态样式仅创建时设置，位置、标签、属性只有变化才写。仍在 resize／scroll 和每次校验读取真实几何，没有节流或延后安全检查。未选中区域时不扫描 DOM。客户端另在已确定两个 owner 或滚动端口歧义后尽早拒绝，避免读取剩余无关记录／布局；这些早退只优化拒绝路径，正常目标仍按原规则实时读取。
- 隔离 Chromium `145.0.7632.6` 在相同 **1000 行现代会话树 + 4000 个无关节点**下，分别注入 SHA256 校验过的改前源码和当前源码，统计真实 DOM API 调用（不是模拟延时）：24 次选中列表校验返回给 JS 的节点数由 `48024→48`，行属性读取 `24024→0`；对话 19 个有效动画帧的矩形读取 `152→19`、computedStyle `342→95`，不再扫描侧栏；另直接选中会话列表旋转 5 次并推进 RAF，行属性读取 `19019→0`、帧矩形读取 `152→38`、返回节点数 `38019→38`，最终列表位置两版均为 `400 px`，对话仍保持 `520 px`；24 次 geometry 的无意义高亮 DOM 变更 `72→0`。计数包含 `querySelector` 和 `querySelectorAll`，不是只替换 API 隐藏开销。两版每帧位置、最终 `520 px`、非目标位置和撤销行为完全相同，后加入第二个列表仍立即 fail closed。[最终数值证据](<../.local/au05-region-hotpath-20261107-counts-final.json>)、[可复现测试](<../test/visual/au05-regions-performance.spec.mjs>)；A/B 通过 `AU05_REGION_PERF_BASELINE` 显式指定改前快照，未提供时仍运行当前版本的几何／归属保护检查。
- 构建与相关 9 文件 **378/378、0 skip** 通过（[日志](<../.local/au05-region-hotpath-20261107-focused.log#L388>)），原有节点替换、失焦、owner、租约、同步重入、边界、反向、陈旧输入及诊断隐私测试保留；新增不扫描无关区域、列表 detent 不重复发现、未变高亮零写入和歧义早退计数；对话 Host wheel 回调后仍另行重新校验。原有面板与动画隔离浏览器 **48/48** 通过（[日志](<../.local/au05-region-hotpath-20261107-visual.log#L89>)），新大列表性能／新鲜性测试在增加实际列表旋转轨迹后显式 A/B **2/2** 通过（[日志](<../.local/au05-region-hotpath-20261107-performance-final.log#L17>)）；未更新任何截图基线。完整 `npm test` 再次运行：**923 项，912 pass、10 fail、1 skip**，约 401 秒（[日志](<../.local/au05-region-hotpath-20261107-full.log#L1084>)）。失败仍是此前已记录的 7 项缺失 `packages/dsh-hooks` 模块、1 项旧静态 `dispatchEvent` 计数断言 `2 !== 1`、2 项 Studio 固定 200 ms 定时器夹具断言 `one scheduled action poll`；未为求全绿改动无关测试、模块或保护条件。构建一致性、语法、差异检查和 impeccable detector 均通过。
- 动画 `80 px / 45 ms`、`100 ms` 帧间隔、`1 px` 外部偏差、输入 `1000 ms` 年龄保护均未放宽；不补放旧事件，不依赖鼠标位置，也不缓存旧授权。保留手工诊断以供以后获准重载后的相同现场采样。本轮没有安装、重载、重启 DSH、操作真实设备／GUI／系统输入／录音／审批；没有新的实机帧轨迹，所以这些 DOM 工作量降低不是实机延迟、FPS 或手感验收。

## 2026-11-07 热路径优化版：用户授权重载与安装核验

- 用户另行明确要求重载扩展并验证滚动响应。重新构建及一致性校验通过，安装前客户端／区域／应用适配器 **270/270、0 skip**（[日志](<../.local/au05-region-hotpath-20261107-reload-check.log#L280>)）。完整备份原安装的 26 个文件并逐一校验后，通过官方管理器仅安装／启用新归档一次，`application:applied`、包管理退出 0；未额外停用／启用或重启 DSH。
- 管理器确认扩展已启用，来源为本轮新归档；26 个已安装文件均与工作区哈希一致，客户端 SHA256 为 `489551692ABD391D63721576F3F9CA09ABFBD2D2FEF4C659632EE2624990C56A`，区域源码仍为 `C77DD46474C9F449F181DC22F6771E6E6D72711395D61A2350C3FBF037F13BCC`。备份、归档校验、安装文件清单与验证边界见[重载回执](<../Temp/au05-region-hotpath-live-20261107-230600/reload-receipt.json>)。现有可选 cpu-features 编译及 inspector 警告仍出现，不据此推断现场因果。
- 安装成功不代表真实 renderer 分支、设备连接或手感通过。由用户手动连接（如需要）、选择会话列表并操作实体旋钮，观察单格／连续／反向；随后手动采样 5 秒、回传纯数值 JSON，对照前份 37 pulse 中 31 stale、accepted→detent 均值 108.4 ms 和 6 次 frame_gap。安装时尚未收到新实体反馈或轨迹，未据安装成功宣称响应改善；随后回传结果见下节。未自动操作 GUI／设备／系统输入／录音／审批；旧叭哥说监控实机恢复测试仍暂停。

## 2026-11-08 优化版实体回传：响应明显改善，尚未达到滚轮平滑度

- 用户反馈“好很多了 但是好像没有滚轮丝滑？”，并手动粘贴新一份 `5000 ms`、`expired`、`dropped:0` 的会话列表数值轨迹。序号 `255–283` 共 **29** 条输入全部 accepted（正向 15、负向 14），**0 stale**；上一份为 37 条中 31 stale。两次不是相同工作负载的受控实验，不能由此换算实体格数、全链路加速倍数或所有场景通过，但确实记录到本次没有因超龄丢弃，并接受了反向输入。
- 逐一配对 29 条 accepted 和紧接的 detent，平均同步间隔 **1.607 ms**，范围 **0.8–2.4 ms**；上一份相同标记段均值 108.4 ms。这是插件 accepted 后进入旋转处理该段的改善，不是从硬件到屏幕的总延迟。接收时年龄仍为 `10–724 ms`，且存在同批集中处理，不能说积压完全消失。
- 剩余不连续有直接数值证据：回调等待最高 **215.1 ms**，相邻两次已记录位置写入 `3784.8→4004.2 ms` 间隔 **219.4 ms**，位置从 `3456→3255 px` 跳变；出现 **2 次 frame_gap**，dt 为 `116.8/222.1 ms`。最后一次停在 `3255 px`、目标 `3073 px`，仍有 **182 px** 未完成。相关帧回调自身记录约 2–4.4 ms，说明不能再将这些百毫秒等待全算进已优化的局部处理；具体 renderer 长任务／宿主／调度来源仍未测出，不能凭此指定某个外部插件或唯一阻塞者。无 external_offset stop，亦无宿主拉回的正面证据。
- 样本途中到达 `4189 px` 下端点，序号 `261–269` 的 9 条正向输入虽被接受，位置和目标仍相等；这是边界截断，不是丢输入。不能用这 9 条评判平滑度。无过期丢弃也不代表每条输入都产生完整 80 px，端点、合并和取消仍按原规则执行。
- 结论记为 **响应改善、滚轮般平滑度尚未验收通过**。当前仍是定向 DOM 的 `80 px / 45 ms` 自定义动画，不等同于系统原生滚轮链路；现有帧调度停顿也不可能只靠曲线消除。下一步应定位剩余长等待，再独立比较运动曲线，而不是增大超时或补放陈旧事件。本轮反馈后未改生产源码／动画参数、未再次重载或自动发送系统输入。仅在[回执](<../Temp/au05-region-hotpath-live-20261107-230600/reload-receipt.json>)保存派生统计，不另存原始采样内容；旧叭哥说监控实机恢复测试仍暂停。

## 2026-11-08 调度停顿：实际投递时间保护、限步推进与无变化轮询去重（未重载）

- 用户要求继续调查剩余等待并改善平滑度。本轮确认两处可在离线环境复现的缺陷，而不是声称已找到现场 215.1 ms 的唯一阻塞者：一是每次 16 ms 轮询即使业务数据不变也通知订阅者；二是 RAF 时间戳属于该次渲染机会，回调实际执行已迟到时仍可能拿旧时间戳写位置，然后下一帧才取消。隔离 Chromium 的改前复现：5 格目标从 120 到 520，首帧到 240；第二帧时间戳 32 ms、实际投递 182 ms，旧实现仍写到 324，之后才停止。
- [动画实际执行保护](<../packages/dsh-plugin/src/regions.js#L160>)在读取当前目标、端口、归属和真实几何后再次取单调时钟，分别核对 RAF 间隔、实际投递间隔和回调迟到，任何一项超过原有 **100 ms** 就在写入前取消。相同迟到样例现在停在 240，写入数不增加，不再补写过时的 84 px；第一帧迟到、同步 DOM 检查本身超时及已出队旧回调同样不能绕过。未增大旧预算或恢复旧动画，主线程阻塞期间仍无法动画，恢复后须新的有效旋转。
- 及时但不均匀的帧使用 `min(RAF 间隔, 实际投递间隔, 32 ms)` 积分，不按停顿时间追赶；每格目标仍为 **80 px**、指数时间常数仍 **45 ms**，没有增加 RAF 循环。受控 80 ms 抖动样例的第二次位置由旧版 473 改为 382，随后继续达到完整目标 520；正常 16 ms 轨迹仍为 240、324、382。反向制动、端点、减少动态效果、手动移动和目标／owner／焦点／租约／元素新鲜性保护保留，输入 **1000 ms** 年龄未放宽。
- [无变化轮询比较](<../packages/dsh-plugin/client.js#L1219>)仅对闭合协议字段做有预算的语义比较；完全相同就跳过整次 publish，保留已发布快照对象和原 `lightObservation.at`，不暗改快照或伪造最新采样时间。仅忽略该 observation 时间，其他 trace 时间、请求标识、状态、灯光、错误和诊断变化仍立即发布；未知字段、访问器、超限数组或比较预算耗尽则照常发布，不执行未知 getter，不做全量 stringify 或延迟通知。回归中 **100 次相同轮询产生 0 次额外订阅通知**，真实 mismatch／新 requestId／错误各立即通知；轮询、实体事件处理及所有同步检查照常执行。该计数不能换算为现场 React 渲染或全链路延迟倍数。
- 既有手动 **5 秒／240 条／内存内**诊断增加排队时间、实际帧间隔、积分步长及目标／端口／校验阶段耗时。浏览器支持时，仅采样窗口内启用 `PerformanceObserver` 的 `longtask`／`long-animation-frame`，只记录相对起点、耗时、阻塞时长和固定类型；不读取脚本、URL、attribution、DOM 文本、会话标识或音频。停止、到期、重采样及销毁断开观察器，旧回调不能混入新采样。隔离原生 Chromium 的受控 75 ms 任务确实产生数值 longtask／longframe；停止后再产生任务，结果保持完全不变。此任务是测试注入的，不是对真实现场阻塞来源的归因，观察器也有自身开销。
- 构建、生成一致性、语法、diff 和 impeccable detector 通过；相关 9 文件 **383/383、0 skip**（[日志](<../.local/au05-region-scheduling-20261108-focused.log#L393>)）。原 33 个面板、15 个区域浏览器测试及新增 5 个实际调度／原生观察器测试 **53/53** 通过（[日志](<../.local/au05-region-scheduling-20261108-final-visual.log#L111>)），没有更新任何截图基线。[新增调度复现](<../test/visual/au05-regions-scheduling.spec.mjs>)使用真实 Chromium DOM 几何，受控帧时间与原生 observer 分开验证，拒绝网络、Host、设备、媒体和系统输入。完整 `npm test`：**928 项，917 pass、10 fail、1 skip**，约 404 秒（[日志](<../.local/au05-region-scheduling-20261108-full.log#L1089>)）；仍为此前相同的 7 项缺失 `packages/dsh-hooks` 模块、1 项旧 `dispatchEvent` 计数 `2 !== 1`、2 项 Studio 定时器夹具 `one scheduled action poll`，未修改无关模块或测试来求全绿。
- 本轮只修改源码、文档与隔离测试，未安装／重载插件或重启 DSH，没有真实 GUI／设备／系统输入／录音／审批操作。当前安装仍是上节已核验的热路径版；要判断新保护、轮询去重及剩余全局等待在实机的影响，需另行获准重载后由用户再次采样。**尚未宣称达到原生滚轮手感，也未确定现场长等待的全局阻塞来源。**旧叭哥说监控实机恢复测试继续暂停。

## 2026-11-08 调度优化版：已重载，现场仍有长任务停顿

- 用户明确要求重载并验证平滑度和剩余调度等待。重新构建／生成一致性通过，安装前客户端、区域和应用适配器 **275/275、0 skip**（[日志](<../.local/au05-region-scheduling-20261108-reload-check.log#L285>)）；完整备份原安装的 26 个文件并逐一校验，再通过官方管理器安装／启用新归档一次，`application:applied`、包管理退出 0，未额外停用／启用、未重启 DSH。现有可选 cpu-features 编译及 inspector 警告仍出现，不据此归因。
- 管理器确认已启用，来源为本轮新归档；26 个安装文件与工作区哈希均一致。客户端 SHA256 `810BFA72E2B5BB45BAE8BA1A008FAA37F78767EFE83087C476400F0A24789DA4`，区域源码 `B9F084C54C5B5ED84CC589620D686596D22A2ABAB5D8C1EE0A210512D17A2901`。备份、归档及安装清单见[回执](<../Temp/au05-region-scheduling-live-20261108-045700/reload-receipt.json>)。安装核验不代表 renderer 的实际分支、设备连接或手感已通过。
- 用户反馈“有改善，但仍会卡顿或突跳”。回传配置含 `maxFrameStepMs:32`，确认页面运行新分支；实际采样为 **conversation**，不是上一份 sessions，不能直接做同场景前后性能对比。5 秒采样保留 240 条、覆盖前 212 条，现存时间仅 `3737.9–4908.2 ms`；全部统计仅适用于保留片段，不声称完整 5 秒无丢输入或无更长卡顿。
- 保留片段有 18 个 accepted 输入（sequence 288–305）、103 条 frame，无拒绝记录；实际投递间隔最高 **65.6 ms**、回调迟到最高 **61.5 ms**，回调自身 work 最高 **2.6 ms**。四处投递间隔超过 32 ms：`50.1/61.7/46.9/65.6 ms`。其中观察到主线程 longtask：起点 `3933.7 ms`、持续 **61 ms**，以及起点 `4324.9 ms`、持续 **65 ms**，分别与 `61.7/65.6 ms` 投递间隔时间重合。主线程长任务是已测到的停顿因素，但数值脱敏记录没有脚本归属，不能指定唯一函数、宿主或其他插件为根因。
- 保留片段所有 integratedMs 均不超过 32（实际最高 16.5 ms），包括迟到后也没有按整段等待时间追赶；没有 external_offset 或 frame_gap stop，正向于 `4057.9 ms` 完成到 1052，反向于 `4903 ms` 完成到 0。未出现 >100 ms 的保留样本，因此本次不能验证该现场分支的拒写动作；也不能把目标多次为 1052 单凭日志认作已证实的底部边界。
- 结论为 **重载完成、用户感到改善，但滚轮般平滑度未通过**。下一步需要能定位来源的有界性能追踪，而不是继续放宽超时或补放旧运动；本轮未追加采集、源码修改或重载。仅在回执保存派生数值，不另存原始 JSON。未自动操作 GUI／设备连接／系统输入／录音／审批，旧叭哥说监控实机恢复测试仍暂停。

## 2026-11-08 长任务来源只读审查：尚无现场调用栈

- 用户要求继续追踪主线程长任务。通过已安装浏览器 CLI 的绝对路径可运行工具，但其现有任务空间不是发生卡顿的 DSH 窗口；现有 DSH 进程参数未发现开放的远程调试端口。没有新开页面冒充现场，没有接管其他任务空间，也没有为调试重启 DSH。用户选择暂时无法录制 Performance，故本轮没有获得新的现场调用栈，不能补全 61/65 ms 长任务的脚本归属。
- 第一候选是[客户端事件批处理](<../packages/dsh-plugin/client.js#L1779-L1830>)：一次 poll 最多取 256 条事件并同步循环处理，事件会再次 sync；[旋钮反馈](<../packages/dsh-plugin/client.js#L1569-L1615>)另有同步 publish，订阅者随后更新 React。无变化 poll 去重并不取消这些真实输入通知。代码允许批量放大，但没有证据证明现场取满 256 条、产生多次 React commit 或耗时达到 60 ms。
- 第二候选是[区域输入到宿主的同步 wheel 处理](<../packages/dsh-plugin/src/regions.js#L388-L425>)和[document scroll 监听](<../packages/dsh-plugin/src/regions.js#L468-L484>)带出的宿主处理、布局与绘制；这不都包含在已测的 RAF workMs 中。保留样本 RAF work 最高 2.6 ms，不支持将该帧自身同步函数直接认作 61/65 ms 阻塞者；也不排除丢失片段或其他执行阶段。
- 排除一个具体疑点：诊断不是逐帧发布 React 状态。[诊断开始与结束](<../packages/dsh-plugin/client.js#L1985-L1993>)只发布初始快照和 5 秒终态，[数值环形记录](<../packages/dsh-plugin/src/regions.js#L61-L105>)逐条留在有界内存中，录制期间不 stringify 区域 JSON。因此未发现“每帧采样→UI 重绘→继续采样”的直接反馈环；仍不能据此排除其他界面渲染或布局成本。
- 后续需要当前窗口 5–10 秒 Performance 调用栈，关闭截图／内存采集，区分 poll/processEvent、宿主 wheel/scroll、React/render/layout 与无关任务。本轮没有修改生产代码、追加安装／重载、自动操作设备／系统快捷键／音频；来源仍未定因，待用户可录制时继续。

## 2026-11-08 区域滚动改用现有原生滚轮链路（源码变更，未重载）

- 用户明确改为原生滚轮手感优先，并接受鼠标位置约束。区域切换保留选区与选项焦点／K2 确认；可滚动区域改走与“上下滚动”相同的 `requestNativeScroll`，不是另外模拟 80 px 动画，也不发送合成 DOM wheel 来取消宿主跟随。
- 桌面直连的区域模式允许现有 Host 原生桥准备票据；实际发送仍需有效选区、鼠标悬停、当前 owner／上下文／连接代次。共享原有 500 ms 过期、最多 32 条待处理、每张实体票据至多一次与取消路径。请求持有选区 lease，切区后再切回同一元素也不能恢复旧请求。Studio／浏览器拒绝原生滚动，不回退到 DOM。
- 导航模块的生产实例使用 `scrollBackend: 'native'`，非选项的 `rotate` 入口额外拒绝 DOM fallback；旧 DOM 引擎仅保留作独立兼容实现及回归测试，不再由产品滚动路径调用。诊断配置标识 native／120 wheel delta，不再把 80 px／45 ms 参数显示为当前产品配置。
- 原生发送不能原子锁定网页中的某个区域，鼠标移动／切窗与异步发送仍有竞态；同一选区内的原生滚动链与系统设置也由应用处理。它不是消除宿主主线程长任务的证明；前述长任务现场归属仍未知。
- 验证：构建同步、源文件语法及 diff 检查通过；客户端 185 项、区域导航与原生桥 57 项通过；隔离 Chromium 55 项通过，包含新增浅色窄屏／深色悬停提示检查，已目视查看两张截图，未更新既有视觉基线。全量回归 884 项：873 通过、10 失败、1 跳过；失败与此前基线相同，分别为缺失 hooks 模块的 7 项、插件 slot 数量断言 `2 !== 1` 的 1 项、Studio 轮询计时断言 `one scheduled action poll` 的 2 项，未顺带修改这些无关问题。旧 DOM 动画用例仅验证独立兼容引擎，不作为产品原生手感证据。只做源码和隔离测试；没有安装、重载、连接设备、注入真实滚轮、录音或操作审批，不以离线通过宣称实体手感已通过。

## Ruled out / Unresolved

- 不移植 VibeWand：当前是 Mac 项目、许可边界另需审，本仓库不含其实现/资产；不宣称 Windows 移植。
- 不打包优篮子/Kehwin 私有 SDK/固件；不把 D200 的 Codex Micro 接口外推 AU05。
- 不从社区同名 ChatGPT/WorkBuddy 市场条目推断公开 HID SDK：准确条目未核实，且不属于本路线依赖。
- 2026-10-27 初始记录中的 GUI、连接与灯控均未验证；后续有限实机结果见 [产品检查记录](<product-guide.md#7-当前实机检查记录2026-10-28>) 及本页 2026-10-29 focus 配置对照。仍未完成所有灯效的物理可见／持续效果、固件差异和完整端到端验收，不能把配置读回或历史记录当作完整硬件通过证据。下一步见 [roadmap](<roadmap.md>)。
