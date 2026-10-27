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
