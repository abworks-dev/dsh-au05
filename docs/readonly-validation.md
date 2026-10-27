# 只读插件与 Windows HID 验证

## 范围与不可越过的边界

2026-10-28（Asia/Shanghai）：用户授权继续验证只读插件和 Windows HID 输入，**暂不启用灯控**；两次人工操作测试均先确认准备就绪。

本轮不发送 HID Output/Feature 报告，不初始化 auth/software-online/heartbeat，不查询固件/序列号，不改变按键映射，不监听其他键盘，不接入审批/发送/取消。已有 Ulanzi Studio 的行为不属于本项目，不能把“本项目零写入”写成“系统里没有任何软件写设备”。

## 环境与证据来源

- Windows 本机 PowerShell `7.6.8`，Node `24.22.1`。
- `Get-PnpDevice -PresentOnly` 过滤 `VID_FFF1&PID_00DD`：8 个相关 PnP devnode 均为 `OK`；严格 USB 物理 parent 计数为 1。这不是 8 个接收器。
- 检测到 `UlanziDeck` 进程；未擅自结束它，人工测试也未要求退出。不能由共享读取成功推导长期共存可靠。
- 本机 DSH desktop/runtime `0.2.1-rc.3`，build commit `be72761ee1a6736ebcdf4f3739363b083ae53c98`，React `18.3.1`。真实 runtime 的隔离离线页面通过 13 项断言；详情及复现见 [插件 runtime 报告](plugin-runtime-validation.md)。**不是当前 GUI/profile 的安装验收**。
- 初始 M0 仓库 CI [40533202492](https://github.com/abworks-dev/dsh-au05/actions/runs/40533202492) 已完成且 `success`；它不覆盖本轮新增代码，新增提交的 CI 必须另查。

采集：本机 PnP/进程只读枚举、安装包 manifest/manager 检查、真实 runtime 离线 fixture、下面的限时 HID 读取及 `gh run list`。只保留脱敏元数据和白名单事件报告计数，不保存设备实例路径、序列号、raw 报告、对话内容或认证值。

## 输入协议离线验证

[输入解码器](../packages/core/hid-input.mjs) 只导出 TEA block 解密、完整 Windows input report 解码及事件解析；没有 encoder、设备 handle 或写入接口。

- Windows 输入严格 64B：report ID `0x55` + 63B 密文。
- 只解密前 56B，末尾 7B 不参与解析。
- 只认明文 `[0]` 为 `0B/8B`、`[1] = 10`，`[3]` 为 `0/1`，`[4]` 为 `0..5`。字节使用十六进制表示；索引是完整明文索引，**不是通用命令 header 后的参数偏移**。
- K1/K2/K3/旋钮按键输出 down/up；左右输出 pulse，不对相同旋钮包施加 1.5 秒去重。
- 未知内容只累计 `unknownReports`，不输出原始密文/明文。
- 标准 TEA 零 key/零明文 KAT（LE words `41EA3A0A 94BAA940`）、固定协议 key 合成向量、全部 control/phase、错误 ID/长度、残块污染、未知值及随机 malformed 输入均有测试。合成向量**不是设备实测捕获**。
- Windows C# `SelfTest` 实际编译并校验 TEA、字段、结构布局、过滤和诊断隐私；它在枚举之前返回，不接触设备。

协议字段本轮用 agent-reach GitHub/`gh api` 定向读取 [固定 Swift 协议](https://github.com/patrick-fu/vibekey-elements/blob/c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73/Sources/VibeKeyCore/VibeKeyProtocol.swift) 复核；2026-10-28 取到，新增关键词搜索 0、定向正文请求 1。引用技术事实，不打包第三方实现。

## Windows 枚举：通过，但有一个 metadata 拒绝项

初版对任一 metadata 打开失败立即停止，得到固定安全诊断 `metadata_open_failed / nativeError=5`。故障后只读 PnP 检查仍为 8/8 `OK`，没有保留 reader/writer。**不能仅凭 error 5 认定是 Studio 独占、标准键盘限制或某个具体 collection。**

修正后只对 access=0 的 metadata `ERROR_ACCESS_DENIED(5)` 计数并继续，绝不读取被拒绝项；其他错误仍停止。成功结果：

```json
{"status":"listed","deviceCount":1,"metadataDenied":1,"physicalReceiverCount":1,"devices":[{"alias":"au05-1","vid":"FFF1","pid":"00DD","usagePage":"FFFC","usage":1,"inputBytes":64}],"writes":0}
```

被拒绝项身份未验证，所以 capture 不只检查 vendor 数量：还必须用 `Get-PnpDevice` 确认严格 USB 物理 parent 恰好 1 个，再打开并复核唯一 vendor 的身份/caps。零/多个 receiver、无法取得 parent 计数、多个 vendor 均拒绝，不按 MI_03 或“第一条路径”猜选。此诊断不支持多接收器选择。

## 真机被动采集结果

均使用 [只读脚本](../scripts/windows-hid-readonly.ps1)，`MaxReports=1000`，单次执行结束后关闭 handle；没有后台常驻监听。三次均正常走超时取消并返回 exit 0。所有报告长度均为 64B、report ID 均为 `0x55`；这不表示未知报告已完成协议解释。

| 轮次 | 时限 / 实际 elapsedMs | 报告数 | unknownReports | 白名单输入事件 |
|---|---|---:|---:|---|
| 无人工指令基线 | 10 秒 / 10011 | 10 | 10 | 无 |
| 人工三键/旋钮混合 | 30 秒 / 30006 | 40 | 31 | 旋钮 down 1、up 1；左 pulse 3、右 pulse 4 |
| 人工三键专测 | 20 秒 / 20002 | 26 | 20 | K1 down/up 各 1、K2 down/up 各 1、K3 down/up 各 1 |

这证明本机当前组合下，**三键、旋钮按压及左右旋转六类输入均可从只读 vendor 通道识别**。每轮 `writes=0`、`physicalReceiverCount=1`、`metadataDenied=1`、`otherReportId=0`、`unexpectedLength=0`。

重要限制：

- 输出是**报告计数，不是物理动作计数**，`physicalActionCountsVerified=false`。30 秒轮请求左右各转 3 格但读到右 pulse 4；20 秒轮请求三键各两次但每键只读到一组 down/up。因此不能宣称无丢包/无重复、精确每格或每次按压已验收。
- 尚未通过单独方向/单键定时对照确认物理标识与软件标签一一对应。长按、快转、唤醒首键、拔插重连、发射器关闭、两软件竞争及其他固件均未验收。
- `unknownReports` 不输出或保存内容，未判定其来源/命令；不能把它们说成已识别 heartbeat 或错误输入。
- 这只证明有限时间内读取成功，不证明 Studio 长期共享、请求/回复不会互相消耗或稳定无干扰。
- 最后一次采集后 PnP 复核仍为 8 个目标 devnode、8 个 `OK`。本项目未改变硬件配置，但这不替代 Studio 或硬件持久状态的完整健康验收。

## 复现与安全门禁

要求 Windows、PowerShell 7 / .NET 6+。先只运行离线测试和枚举：

```text
npm run hid:selftest
npm run hid:list
```

确认只有一个 receiver/verified vendor 后，再限时被动读取：

```text
npm run hid:capture -- -Seconds 30 -MaxReports 1000
```

若要手动按键，先把焦点移到空白记事本等安全窗口，不要放在 shell、聊天输入框或可能执行危险快捷键的窗口。设备原有映射和 Studio 仍可能响应按键，本项目不拦截它们。

脚本默认不保存文件；只输出脱敏 JSON。无 Output/Feature/原始 payload 参数、无 write/控制 API。Ctrl+C 请求取消；等待 Win32 异步读取消完成再释放缓冲区和 handle。时限依赖驱动正常完成取消，不承诺内核故障下硬实时退出。只读监听没有目标事件时停止并记录，**不通过初始化写入强行修好**。

## 本地回归结果

- 全量测试显式启用已提取的本机 DSH runtime fixture：**28/28 通过，0 skip、0 fail**，其中包含 Windows C# 编译/双 KAT、9 项 HID safety 及真实浏览器 runtime 检查。
- 普通 `npm test` 不设 runtime 环境变量：27 通过、1 明确 skip；缺安装环境时不伪报 runtime 通过。显式启用方式见 [runtime 复现](plugin-runtime-validation.md#复现)。
- `npm run check`：39 个源文件的 JSON、Markdown 本地链接、UTF-8 与基础 credential 模式检查通过，不等于完整密钥/供应链审计。
- `npm run demo`：通过，模拟意图返回 `executed=false`；没有真实审批执行。
- `git diff --check`：通过。公开 CI 独立于本机结果，以下一轮提交的实际状态为准。

## 当前结论与未验证项

- PnP、严格 vendor caps、有限时间输入读取：通过。
- 三键及旋钮六类输入报告：已观察到；动作精确计数、物理标签逐项映射及长期可靠性：未验证。
- DSH 真实 runtime 离线加载/渲染/fiber 清理：13 项通过；真实 GUI/profile 生命周期：未验证。
- DSH 插件与实体 HID 的跨进程连接、灯控、映射、草稿/审批/取消动作：**未实现或未启用**，不能称为端到端已适配。

下一步应先在单独测试 profile 做真实 GUI 验收，再做单键/单方向、重复/丢包与 Studio 共存对照。任何设备初始化、灯控或会话控制实验都要另行明确授权，不属于本轮自动续做范围。

## 后续实际 GUI 观察：清空 DSH 关联预设后（2026-10-28）

本节补充后续实测，不把前文的历史阶段结论当成当前验收结果。用户明确授权开始只读观察验收；本轮没有实现或启用会话控制、灯控或设备配置写入。

### 准备与方式

- 只读核对 Studio 保存的 DSH 关联预设：Encoder 与 Keypad 的 `Actions` 均为空。K1 原有 `Win+H` 在用户确认清除后再次读取，确认为空；配置清理由用户执行，本项目没有写预设。
- 开始前未发现 17376 端口监听或既存只读采集进程。使用现有的 Windows 限时采集、认证 loopback 观察服务和实际 DSH 插件，不使用合成输入。
- 插件显式连接后，Windows UI Automation 实际读到 `HID observer: receiving (read-only)`，事件初始计数为 0、sequence 为 1；会话装饰仍为 `controls off`。
- 人工指令为 K1、K2、K3 各单击一次，顺时针 3 格、逆时针 3 格、旋钮按压一次，每项约间隔 2 秒。用户反馈已全部完成，搜索框没有额外字符，也没有其他意外操作。此项是用户观察，不是全局键盘监控证据。

### 实际记录

| 输入报告 | 最终数量 |
|---|---:|
| K1 down / up | 2 / 2 |
| K2 down / up | 3 / 3 |
| K3 down / up | 2 / 2 |
| 旋钮 down / up | 3 / 3 |
| right.pulse | 157 |
| left.pulse | 97 |

共 274 条白名单输入报告，最终 sequence 为 276（含 ready 与结束状态）。用户随后明确补充：当时实际做了额外、随意的按键与旋转操作，并未按指定次数执行。因此这批计数不能用于单次输入精度验收，也不构成重复报告或硬件抖动的证据。

结束前，实际 GUI 被读取为 `HID observer: disconnected`、`No input observed`，而桥端保留上述计数。因此本轮只确认了 GUI 曾进入硬件就绪连接状态、桥确实采集到六类硬件输入，**没有确认这些输入在 GUI 中持续可见，端到端验收不通过**。断开发生的时间和原因尚未定位。

### 清理与下一步

- 项目采集与插件路径报告 `deviceWrites=0`、`sessionActions=0`；这不代表 Ulanzi Studio 或系统中其他软件没有写设备。
- 限时采集正常结束，GUI 执行断开、观察服务关闭，内存临时令牌丢弃。事后检查无 17376 监听或该只读采集进程残留。
- 未保存原始 HID 报告、通用键盘输入、真实会话标识、对话内容或令牌。
- 下一步先定位 GUI 观察组件断开的生命周期原因，再做带时间顺序记录的单键、单方向小轮次对照；不应直接启用发送、审批或灯控。方向一一对应、每格/每次动作精度、无丢失/无重复及长期共存仍未验收。

## GUI 生命周期修复与逐项单次输入（2026-10-28，插件 0.2.1）

### 断连诊断及修复边界

旧实现把连接控制器、状态和最后观察值放在输入栏 React 组件内部；组件卸载时主动 abort，重新挂载后恢复 `disconnected` / `No input observed`。真正的卸载重建可确定复现此问题；普通重渲染不会自动清空 React 状态，网络 EOF/错误也分别显示 `stream closed` / `unavailable`，不能直接解释此前的初始状态组合。**此前那次断开的具体触发事件仍未抓取到，不能断言就是问答卡片触发。**

修复将手动建立的只读连接及最后观察值迁到单个插件实例的内存中。视图卸载只取消订阅；重建后订阅同一观察源，不新建请求、不清空证据。主动 Disconnect 清除观察并中止连接，插件禁用/卸载通过 Cordis effect 释放连接；页面或插件整体重载不会自动重连。临时令牌输入清空、不持久化，仍只有显式认证 GET，无设备或会话控制。

离线回归共 **55/55 通过、0 跳过**，包含 8 项独立生命周期测试，以及已安装 DSH `0.2.1-rc.3` / React `18.3.1` 的真实 loader、Cordis、renderer fixture **22 项断言**。fixture 中的会话及 SSE 是合成数据，不能代替下述实体输入证据。

### 实际 GUI 部署与重建验证

- 先备份当前插件配置，再通过官方插件管理器操作，仅更新本地链接的 AU05 插件；未改安装包或手写 profile。官方“添加”入口不覆盖已安装包；禁用/卸载流程曾使组件停用，随后管理器识别版本 `0.2.1`，通过官方开关重新启用。实际 GUI 出现新版本的视图生命周期计数，确认不是只改源码、旧 bundle 仍在运行。
- 同一真实窗口中显式连接，硬件就绪且全部计数为 0。切到官方插件页再返回原会话：`observer views 1 · detachments 0` 变为 `observer views 2 · detachments 1`，仍显示 `receiving (read-only)`，sequence 保持 1。
- 此期间只出现两条 `/v1/events` 请求：一条 GUI、一条验收脚本的只读见证流；视图重建没有增加请求。未使用替代服务器、替代 DSH 页面或开发 watcher。
- 后续问答过程中，UI Automation 有时读到 `observer_view_absent`，仅表示当时无法读取观察视图；问答返回后，同一视图计数下可继续读到接收状态和最新输入，不将暂不可见误记为断连。

### 逐项物理输入结果

每项启动独立、最长 120 秒的实体 Windows 只读采集，初始计数为 0；记录规范化事件顺序及相对时间，以 Windows UI Automation 读取实际插件显示进行对照。没有注入合成事件，也没有记录原始 HID 包或其他键盘输入。

| 操作 | 桥与实际 GUI 的对应观察 | 本轮判断 |
|---|---|---|
| K1 单击 | `k1.down:1`、`k1.up:1`，其他项 0 | 单次对应通过 |
| K2 单击 | `k2.down:1`、`k2.up:1`；按下前 2.095 秒另有 `left.pulse:1` | 按键对应通过；额外旋转由用户确认是另外试动 |
| K3 单击 | `k3.down:1`、`k3.up:1`，其他项 0 | 单次对应通过 |
| 逆时针一格 | 首次 GUI 采样 `left.pulse:1`，其他项 0；约 9.93 秒后又有额外 3 左、1 右 | 首次方向对应通过；用户确认之后又试动过，不把全窗口当纯单次样本 |
| 旋钮按压一次（补测） | `knob.down:1`、`knob.up:1`，旋转及其他键均 0 | 单次对应通过 |
| 顺时针一格（补测） | `right.pulse:1`，其他项 0 | 单次对应通过 |

本轮**六类输入都已在真实 GUI 中逐项观察到正确对应**，修复后的视图重建保留连接与观察值。K2 和逆时针全窗口含用户确认的额外操作，不能把全窗口计数用于“绝无重复”的严格判据。

排除/保留的历史轮次：

- 首次六项连做窗口、首次旋钮按压窗口均为 0 报告；用户确认未及时操作或选择了误触/未及时操作。这些窗口不算硬件功能失败；旋钮随后补测成功。
- 首次单格顺时针窗口：用户选择完成，但收到 0 报告，原因没有独立定位，仍保留此不一致记录；准备确认后补测得到 1 条正确右转。补测成功不等于证明首轮不存在丢失，也不能据此声称长期零丢包。
- 早先 274 报告的混合窗口及本轮额外转动，用户已明确承认含额外试动；不据此认定硬件抖动或解码重复。

### 最终清理及未验证项

所有临时采集均已结束并收集退出结果；最后一次实际 GUI 执行 Disconnect，服务关闭、内存令牌丢弃。事后检查：17376 无监听、对应 Windows 只读采集进程无残留。本项目 `deviceWrites=0`、`sessionActions=0`，未开启灯控、映射、发送、审批或取消动作；不对 Studio 自身的设备操作作零写入承诺。

本轮是**有限次数、人工配合的真实 GUI 只读输入验证**，不是完整控制适配或可靠性认证。仍未验证：大样本单格精度与重复/丢包率、长时间 Studio 共存、设备重连及异常恢复、真实 GUI 插件完整卸载流程、任何设备写入和会话控制。下一步如继续开发，优先补足独立重复性试验及可复用的显式连接/采集启动体验，仍不要直接开启审批或灯控。
