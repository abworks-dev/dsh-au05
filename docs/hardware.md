# Windows AU05 硬件实现方案

**状态：协议事实调研，零实体设备操作；本仓库未实现任何真实 HID I/O。** 不将社区源码一致视作多个独立硬件实验；固件差异必须验证。固定出处见 [sources.md](sources.md)。

## 先识别正确的 collection

| 字段 | 已查参考中的值 | 使用限制 |
|---|---|---|
| VID / PID | `0xFFF1 / 0x00DD` | 同复合设备有多个 collection，不能打开第一条路径 |
| UsagePage / Usage | `0xFFFC / 0x0001` | vendor 通道，排除 keyboard/consumer/mouse |
| Report ID | `0x55` | Output/Input，不能以 Feature Report 代替 |
| descriptor payload | 63 字节 | WebHID 参数不含 report ID |
| Windows API buffer | 64 字节：ID + 63 字节密文 | 不能混成 65 字节；枚举 caps 后校验 |

Windows VibDock 在其 2026-10-19、固件 4.4.0 记录中见 MI_03、64B IN/OUT，不代表所有设备都相同；不硬编码 MI_03、完整路径或默认选第一台。多设备要求用户选择，设备被替换重新确认。不得在日志公开完整设备路径/序列号。

## 编解码设计（后续原创实现，当前无 encoder）

已审 MIT Windows/Swift 参考与社区协议描述：LE32 标准 TEA、32 轮、delta `0x9E3779B9`，固定公开协议 key words `[0xCAA5BACA, 0xBC2A8A6D, 0xCA5A9EBA, 0x9BB88BCA]`。这是协议常量，不是用户凭据，不提供身份安全。

明文按 64B 零填充，header 四字节为 route/subsystem/command/direction；加密 64B 后只发前 63B。接收 63B 只能完整解密前 56B（七块），不得把末尾残块解释成有效参数；header 后有效参数最多 52B，超长拒绝而非静默截断。需要独立 KAT、捕获向量、长度与 malformed/fuzz 测试后才能加进发布代码。

协议中的 nonce 回显握手不是本机 IPC 认证：dongle 请求/回复 route 可能都是 06，mic 01 回复可为 81；不能一律强制 route|0x80。一个设备一个 reader，一个串行 writer，一个在途请求；matcher 核 route、subsystem、command、direction、slot、nonce，事件单独分流。重连增加 generation，旧回包不能匹配新请求。

初始化差异：Swift 做 auth/softwareOnline/heartbeat；Windows shortcut provisioning 在未做整套 auth/online 时也有成功记录。不要盲发整套命令。软件 online 仅连接阶段一次，heartbeat 独立；反复 online 可能触发灯/watchdog。先用诊断矩阵确认各固件要求。

## 输入优先 vendor，保底不伪装硬件隔离

社区与 Swift 有 vendor input callback 的真实代码：`8B/0B 10 [logical] [phase] [physical]...`，phase 在 `[3]`、physical 在 `[4]`；三键 0..2、旋钮按 3、右 4、左 5，旋转是脉冲。**这不是 Windows vendor 路径已验收的证明。** 社区 shortcut 槽 4/5 的左右顺序不同，不能共用 enum。

P0 诊断只读枚举及被动监听，记录三键 down/up、长按、旋钮快转、重复包、是否同时输出标准键盘事件。若必须初始化写才能出事件，停止并先请求实验授权。若无法确认事件序号，不采用“同帧 1.5 秒去重”这种会吞真实旋钮刻度的策略；采用实测窄窗/状态机，并声明计数限制。

路线 A：Windows 真机证实 vendor 事件可靠后，使用 vendor callback；不全局键盘 hook。若依旧有标准键盘输出，需用户选择 neutral profile 或确认冲突，不能偷偷清原映射。

路线 B（显式 opt-in 保底）：RegisterHotKey 注册可配置无冲突组合，先成功注册再备份/写设备映射/读回验证；例如 Ctrl+Alt+Shift+F7/F8/F9，仅为示例，不保证无冲突。**F12 被 Windows 保留给 debugger，不能照抄参考的 F10/F11/F12。** 该路径可能被其他键盘同弦触发，只支持单次按下，不声称 AU05 设备级来源、不承诺 hold/double/旋钮。VibDock gesture 的 Windows 先例实际为 GetAsyncKeyState 轮询，非已经完成的 low-level hook。

低级 keyboard hook 的结构没有 hDevice，不能声称只抑制 AU05；Raw Input 可区分来源但不是设备级全局抑制器。首版不引入任意全键监听。

## 有限灯控，不等同任意 RGB

参考中的指示灯命令 `01 0B 88` 与泛灯效 `01 06 11` 不同。已审 Swift 的 `01 0B 88 04` 中 `01 00 00/01/02` 表示 off/solid/hardware-auto；breath 参数更复杂。其 brightness 参数未实际用于某些写法，solid/off 也不能据此承诺按 channel 独立。

首个受控写实验只允许 off/solid/auto，确认不会持久破坏原模式，并给恢复路径。breath/多路/颜色独立/亮度待额外实验。`01 0B 89` hooks 模式不能外推为独立 thinking/error 命令。

每项区分 desired/requested/applied/readbackUnsupported/error。若无可靠读回，不能把 WriteFile 成功标作已应用；可附人工目视验收记录。断线/退出恢复 auto 也必须先实证，不用未经验证的“复位包”兜底。

## 首次配置与恢复

1. 标准用户运行，不要求管理员/内核 driver；Studio 先退出，检查设备是否忙。
2. 只读列出 descriptor/caps，用户确认设备与固件。
3. 只有明确授权后才读取原映射、脱敏备份到本机 `.local/`（不入 Git）；无法读回时禁止自动写。
4. 白名单单项写入、等回复、读回比对；失败标 unknown 并停止后续配置，保留恢复资料，不循环盲写。
5. 退出/崩溃/USB 拔插/休眠恢复时释放 I/O，若使用 Win32 async I/O 必须取消并等完成再释放缓冲区。Studio 共存、发射器关闭但 dongle 仍在、唤醒首键丢失都分别测试。

禁止接口：固件升级、宏、休眠/复位参数、任意原始 payload、自动改所有键、USB 音频录制。恢复原配置是未来的用户授权事务，不是当前原型功能。
