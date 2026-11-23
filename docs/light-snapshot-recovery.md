# 原灯光快照恢复

原灯光快照用于断开或释放灯光控制时恢复原配置。读取不到有效快照时不得写入灯光；连接成功、按键可用不代表灯光快照成功。

## 故障区分

- 接收器认证未确认：尚不满足读取前提，不应伪记一次 GET。
- 设备在线状态未确认：同样可能没有发送 GET。
- GET 已发送但超时：区分完全没有回复与收到但未通过外层、消息头或模式校验的回复。
- 原灯光快照恢复成功：仍保留之前失败的诊断，不能用最后一次成功覆盖故障现场。

认证或在线门控失败时，原生端内部 initial 统计可能为 `attempts=0`；现有线协议会省略未实际尝试的 readback，不能据此断定它会造成协议异常。门控失败原因通过独立诊断历史传递，不伪造 GET 次数，也不放宽既有 readback 校验。

## 安全边界

- 初始读取最多两次额外恢复尝试（含既有录音恢复共用预算），分别延迟 250ms、500ms；耗尽后，仅本体联机/开机通知可触发一次独立的事件恢复，合并等待 300ms。每次连接最多一次事件恢复；不随 poll 无限重试，不自动断开重连。
- 仅连接仍有效且从未写灯时恢复；等待及 I/O 必须可取消。
- 恢复后重新检查最新灯光请求，不得因重试延迟执行已经显式释放的旧请求；启用期间 idle 的全零目标不是释放。
- 诊断仅记录固定状态、计数和有界历史，不记录设备身份、原始 HID 报文或语音内容。

在现有高级设置的“灯光诊断”JSON 中，`snapshotDiagnostics` 保留本次连接最初三条尝试记录；字段为尝试序号、结果、认证状态、在线查询状态、超时数与拒绝数。后续成功不会抹掉之前失败，重新连接开启新历史。为兼容运行中的宿主解析器，事件恢复不追加第四条历史；该数组不是全部物理尝试次数。事件恢复是否成功，应查看该请求后续的真实结果和 `post_write` 回读；没有回读的失败结果不能视为恢复成功。

更改本身不会自动安装或重启插件。2026-11-04 经用户授权，确认官方管理器安装来源为本仓库 `packages/dsh-plugin` 的本地链接，构建后通过官方启用开关停用、重新启用插件。自动连接随后启动真实原生进程，新诊断字段在实际桌面面板中可读取。

本轮真机三次尝试均记录 `outcome=link_not_ready`、`auth=matched`、`link=linked_false`、`timedOut=0`、`rejected=0`。这是设备链路未就绪，不能误报 GET 超时或认证失败；没有灯光快照，未写灯。00:09:27 至 00:09:53 的六次采样中历史始终为三条，未发生无限重试。证据保存在 `Temp/hardware-snapshot-diagnostics-20261104.txt` 与 `Temp/hardware-snapshot-history-stability-20261104.jsonl`。

本轮验证了真机失败重试上限和诊断链路，未验证失败后恢复成功或实体灯光效果；未录音、发送快捷键或操作审批。`linked_false` 的物理原因尚未确认，不据此判断设备损坏。

验证：插件构建及宿主/客户端/灯光相关回归通过。全量回归曾报告原生测试旧断言与冗余自测超时（已调整测试，最终定向复验 7/7 通过），以及通用 hooks 测试所引用的独立模块缺失；没有为本次任务恢复或改动该独立模块。

## 2026-11-04 固定源码协议对照

本节是独立静态审计证据，不改变上文历史真机结论。读取日期：2026-11-04（Asia/Shanghai）。社区参考固定为 `ihavespoons/vibed@f7c89385416e626a9c6c0c9d674153a9f4af6112`；已将完整、未修改源码保存在 协议参考目录说明（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/README.md`）。只读取远端源码和本地二进制字节，不加载官方 DLL、不操作设备。

### `deviceActive` 是本体与接收器的链路，不是录音活跃

- Requests.swift:98–99（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Requests.swift#L98-L99`） 的原注释是 “Reports whether the microphone is currently linked to the dongle.”；VibeKey.swift:91–94、113–115（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/VibeKey.swift#L91-L115`） 将它命名为 `isMicLinked()`，为 false 时 `requireMic()` 抛出 `micOffline`。它不测宿主录音、CoreAudio capture、听写状态或按键映射是否启用。
- Requests.swift:50–68、98–99（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Requests.swift#L50-L99`） 构造 `06 03 0A 01`，默认 payload 是空数组，补零至 64 字节。Protocol.swift:61–67（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Protocol.swift#L61-L67`） 定义 read=`01`、replyFlag=`10`；Requests.swift:30–41（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Requests.swift#L30-L41`） 对此读请求要求回复 operation=`11`，仅写操作允许裸 `10` 回执。因此没有证据支持更换查询模式、添加默认 payload 或为此查询放宽 operation。
- Frame.swift:50–65（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Frame.swift#L50-L65`） 明确 type=`plain[0]&1F`、group=`plain[1]&0F`、command=`plain[2]`、operation=`plain[3]`；Messages.swift:147–161（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Messages.swift#L147-L161`） 对 `(group=03, command=0A)` 读取 `plain[4] != 0`。这与审计时 [原生查询、匹配器](<../packages/dsh-plugin/native/au05.ps1#L368-L372>) 和 [回复取值](<../packages/dsh-plugin/native/au05.ps1#L609-L611>) 一致。查询值 `00` 为 false，任意非零为 true；不要把下面 notice 的 bit0 规则错用于查询值。

上游完整 URL（均为上述固定提交，本节读取日期同前）：

- https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Requests.swift
- https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Messages.swift
- https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/VibeKey.swift
- https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Frame.swift
- https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/Protocol.swift

### 链路/开机通知只作为重新查询的触发

Messages.swift:136–143、222–240（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Messages.swift#L136-L240`） 和 Protocol.swift:45–52（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Protocol.swift#L45-L52`） 的实际解析条件是：

| 通知 | 精确字段 | 取值/作用 |
| --- | --- | --- |
| `linkActive` | `(plain[0] & 0x1F) == 0x0B` 且 **完整** `plain[1] == 0x0B` | `plain[2] & 1 != 0` 为 linked；bit0=0 为 unlinked，其他位不参与。不要将 `plain[1]` 先掩成 group 低四位。 |
| `powerOn` | `(plain[0] & 0x1F) == 0x0B` 且 **完整** `plain[1] == 0xF0` | 直接生成开机事件；该分支不验证额外 payload。 |

`notice` 没有查询回复的 operation/payload 布局，不能去 `plain[4]` 取 linked。社区 VibeSession.swift:294–296（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/VibeSession.swift#L294-L296`） 的注释概称认证前丢 notices，但实际代码只丢 `keyEvent`；其他通知仍被发给 listener。这不是允许原生端绕过认证的依据。

Daemon.swift:93–99、136–141（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Daemon.swift#L93-L141`） 在 authenticated、`linkActive(true)`、`powerOn` 时调用 `scheduleApply`；`linkActive(false)` 只记录，不调度。Daemon.swift:158–169（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Daemon.swift#L158-L169`） 用 300ms 可取消等待、替换 `applyTask` 并取消旧任务来合并连续触发。Daemon.swift:172–194（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/Daemon.swift#L172-L194`） 的 `apply` 随后重新调用 `isMicLinked()`，false 就返回，异常只记录；没有“收到开机通知就视为链路 true”，也没有 false 后定时无限重试。

这里的上游完整 URL（读取日期同前）：

- https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/VibeKit/VibeSession.swift
- https://github.com/ihavespoons/vibed/blob/f7c89385416e626a9c6c0c9d674153a9f4af6112/Sources/vibed/Daemon.swift

### 可以定论的差异与仍不能定论的部分

- 审计时原生实现的恢复预算为连接级两次额外尝试，耗尽后 `snapshotAttempted` 仍为 true；[CaptureSnapshot/RetrySnapshot](<../packages/dsh-plugin/native/au05.ps1#L792-L816>) 不再刷新 linked。[原生输入分类](<../packages/dsh-plugin/native/au05.ps1#L198-L210>) 只识别 `notice=10` 按键；[输入循环](<../packages/dsh-plugin/native/au05.ps1#L603-L627>) 没有解析链路/开机通知，[心跳循环](<../packages/dsh-plugin/native/au05.ps1#L848-L855>) 不刷新 `linkReady`。所以**若本体稍后才联机，同一连接不会因该事件自动恢复灯控**。这是代码可证的恢复触发缺口，不是对初始三个 false 物理原因的证明。
- 若据此做最小事件驱动修复，社区证据只支持“通知触发新一次查询”；仍须沿用已有认证确认、fresh linked read 和严格原灯光快照作为写灯前提。不能根据通知直接置 `linkReady=true`、伪造 snapshot、放宽 GET 匹配器或无限重试。如何安排有界事件恢复预算属于本仓库设计，不是上游协议事实。
- VibeSession.swift:41–45、249–264、288–292（本机临时证据，未入库：`../Temp/au05-protocol-reference-20261104/VibeSession.swift#L41-L292`） 默认为 3s 超时、100ms 未匹配时重发；本地 linked 查询为 750ms 单次写入。这是差异，但上游一旦收到匹配的 false 回复也会完成请求，并不持续重发到 true；本次收到三份 matched false，不能归因为“超时太短”。
- 本地先 auth、SoftwareOnline(03)、heartbeat、再 linked；当前社区会话实现只直接证明 auth 后 heartbeat/请求队列的顺序，未证明 SoftwareOnline 的必要顺序。已有官方在线写入/持续发送审计见 [来源记录](<sources.md#L546-L567>)，但不能从这些静态差异认定在线顺序造成本次 false。
- 初始 false 是否来自待机、未完成无线联机、固件/连接模式、时序或其他物理状态，上述三份聚合诊断不能区分；本节静态审计不据此声称实体灯已恢复。

## 2026-11-05 空闲灭灯规则

Direct 启用灯光反馈时，idle 四零向量继续接管并请求全灭；只在显式关闭反馈（Host 生成 native `release:true`）、断开或正常退出时尽力恢复首次严格读取的原配置。浏览器 RPC 不接受 `release`。晚联机恢复需跟随最新 idle 目标，不能误把四零当作撤销；原快照、恢复预算和取消护栏不变。规则开发阶段仅做源码与离线验证；后续经用户授权的安装、USB 回读结果单独记录如下，下方旧版历史实机确认不替代本规则的验收。

- 唤醒合并窗口内切换按键短亮时，以最新请求同时更新任务目标和短亮开关，不沿用旧授权。
- 原生恢复结果 `preserved`／`restored`／`restore_written`／`restore_mismatch` 通过封闭枚举回传 Host，保留请求 ID、回读阶段与原有诊断限制；不是仅在测试内记录结果。只有完整原配置回读一致才报告 `restored`，未知或不一致仍留待断开清理重试，不新增循环恢复。
- 本规则最终离线验证：5 个原生测试文件 **32/32 通过**，包括 idle 接管、快照恢复、亮度、短亮、唤醒期间开关双向切换及恢复结果回传 Host（日志（本机临时证据，未入库：`../Temp/au05-idle-dark/native-tests-20261105-2208.log`））。Host／界面相关 215 项通过，7 个独立真实 React 场景通过并目检；待机预览（本机临时证据，未入库：`../Temp/au05-idle-dark/lamp-idle-dark-panel.png`）不是已安装界面或实机验收。构建、生成文件校验与 `git diff --check` 通过。
- 同一全量测试文件集分两批执行：727 通过、36 失败、1 跳过。36 项失败与改规则前一致：27 项 Bageshuo 客户端轮询夹具、2 项 Studio action 轮询夹具、7 项缺失 `packages/dsh-hooks` 模块；没有把全仓结果报告为全绿。

## 2026-11-05 授权安装与设备回读

用户另行授权安装更新并测试设备后，通过插件管理器安装本轮固定 tar 包，版本仍为 `0.6.0-dev.3`，不再链接可编辑源码目录。设备测试结束后插件已重新启用并应用。

- 已安装包与工作区的 26 个发布文件逐一 SHA-256 一致，见 安装记录（本机临时证据，未入库：`../Temp/au05-install-20261105-2235/installation-report.json`）。移除旧链接包时管理器意外清空了源码目录；26 个发布文件由安装前打包副本恢复，3 个可编辑适配器从最终嵌入源码重建。生成文件一致性检查及恢复后 224 项相关测试通过；不声称恢复后所有未发布源码的原始空白字节完全相同。
- 初次连接认证成功，但三次 linked 均为 false，快照保护阻止写灯，保留 首次失败结果（本机临时证据，未入库：`../Temp/au05-install-20261105-2235/device-check.json`）。用户确认设备已唤醒、Studio 已关闭后重新连接，未绕过 linked 或快照门控。
- 使用已安装包的真实 Host 控制器独占 USB、无动作上下文执行检查：启用 idle、重新启用 idle、重连后 idle 三次均 `verified`，`post_write` 返回 mode 2、四通道类型全 0；两次关闭反馈均 `restored`，完整原配置严格回读一致。两次断开原生进程均以代码 0 结束，未强杀。见 设备回读记录（本机临时证据，未入库：`../Temp/au05-install-20261105-2235/device-check-1793889823262.json`）。
- 没有录音、发送快捷键、合成按键或操作真实审批。配置回读不是光学验收；本轮没有实体灯目视确认。自动浏览器访问当前 GUI 得到 HTTP 401，未读取认证凭据、未启动替代服务器，尚未在已安装 GUI 中目视验收新增状态显示。

## 2026-11-05 跨应用任务灯安装与回读

用户授权安装最新构建后，管理器更新到新的固定 tar 包并启用，版本仍为 `0.6.0-dev.3`。本次直接更新已有固定包，没有移除链接包或重建源码。已安装的 26 个发布文件与工作区逐一 SHA-256 一致。

- 实机策略回读记录（本机临时证据，未入库：`../Temp/au05-crossapp-install-20261105-2304/device-policy-check-1793891488659.json`）使用已安装客户端控制器、已安装 Host 与真实 AU05 USB；会话运行状态和窗口焦点由隔离夹具提供，不是对已登录 GUI 的真实切窗测试。
- 9 项策略状态匹配严格配置回读：跨应用前台运行／返回运行时 K3 呼吸、旋钮常亮；失焦时任务灯关闭；后台任务结束后返回仍关闭；关闭跨应用时后台保留任务反馈；后台重新启用跨应用立即请求关闭。不变目标允许复用已确认配置，不声称每项都新发 GET。
- 关闭灯光反馈完整原配置回读 `restored`，正常断开进程代码 0。未录音、发送系统快捷键、合成实体输入或操作真实审批；真实输入不投递给夹具会话。测试后插件已重新启用。
- 构建及相关 247 项离线测试通过。自动浏览器仍受 HTTP 401 限制；自动记录中的焦点是夹具输入、`opticalVerification:false` 保持不变，不将配置回读冒充光学验收。
- 随后用户在真实 DSH 界面切窗并目视确认“两种模式都符合”：跨应用开启时后台任务灯熄灭、返回跟随当前任务；关闭跨应用时后台保留任务反馈。此结论来自用户确认，不是代理浏览器截图；不扩大为录音、审批或其他灯效的实物验收。见 用户目视确认记录（本机临时证据，未入库：`../Temp/au05-crossapp-install-20261105-2304/human-confirmation-1793891488659.json`）。

## 晚联机恢复修复与本轮验证

初始重试耗尽后，旧实现会缓存空快照；本体后来联机也不会再查询。现在输入 reader 仅将上述精确的 `linkActive(true)` / `powerOn` 通知记录为原子 hint，由原有单 writer 消耗一次独立恢复预算。保留最新未释放的失败灯光意图，是因为宿主对不变状态去重，不一定再发送请求。

- 通知不是写灯许可。重新初始化仍保留接收器认证确认，重新查询本体 linked，再严格读取原灯光快照。已确认的 dongle 认证不无故重做，不反复发送 Online。
- 合并等待、查询和快照读取后均检查最新请求；显式灯光关闭（native `Release=true`）清除暂存意图，后到的新请求覆盖旧请求，stop 可取消等待。启用期间的 idle 是四灯关闭目标，恢复成功后继续执行，不释放接管。原快照和断开恢复逻辑不变。
- false 通知、其他 route、完整通知字节 `0x1B`、普通 poll 不触发；重复通知不补充预算。
- `powerOn` 可能早于无线联机完成并消耗唯一机会。若这次重新查询仍 false，随后通知不会无限重试，仍需用户确认本体状态后显式重连；不承诺一次开机事件必然恢复。

03:51（Asia/Shanghai）经用户本轮授权，在面板受控断开原 native owner 后执行一次独占诊断：auth=`matched`，linked 查询得到有效 false；即使诊断中绕过 linked 布尔门控、实际发送一次严格快照 GET，仍在 3000ms 内没有灯光配置回复，只收到四份不匹配的 dongle 报文。故当前不能归因为“只因 false 门控挡住了本来可读的灯光配置”。诊断没有发送 LED SET 或恢复帧；单 writer、reader 结束、stream 关闭、Offline 清理均确认。

证据：单次实机探针结果（本机临时证据，未入库：`../Temp/hardware-link-snapshot-probe-20261104.json`）。探针默认仅 synthetic，真实运行需显式 `-RunAuthorized`；固定源容器只提取 C# 文本、不执行脚本。该诊断没有证明本体未联机的物理原因，也没有证明实体灯已恢复。

03:55 完成授权的一次受控断开/重连对，native owner 从 PID 45300 变为 PID 50620；没有安装、停用或重启插件，没有录音、发送快捷键或操作审批。重连后最初三次仍为 `linked_false`，请求 57 失败，未伪造成功。用户随后确认已开机/唤醒本体；**同一连接**的请求 58 从 `failed`（1793735736569）转为 `verified`（1793735744199），其 `post_write` 期望与实际配置完全一致。后续运行请求 59 的 `[0,0,2,1]` / 亮度 2 也 `verified`（1793735745064）。初始三条失败历史完整保留，没有追加第四条或重启控制器。

证据：重连后现场（本机临时证据，未入库：`../Temp/hardware-after-reconnect-20261104.json`）、用户唤醒后的同请求恢复及后续回读（本机临时证据，未入库：`../Temp/hardware-after-body-wake-20261104.json`）。用户在本轮目视验收中确认“示意图和实体灯都恢复了”；这是用户对页面与实物的确认，不是代理截图或由配置回读推定的光学结果。没有再进行第二次断开来测试实机恢复原配置；恢复逻辑由合成回归覆盖。

构建 `npm run build:plugin` 通过；native/快照恢复/wire/宿主/客户端定向回归 202/202 通过。新增 [晚联机恢复测试](<../test/au05-wake-recovery.test.js>) 的 14 个纯合成场景通过：晚到链路/开机事件、去抖 burst、早期/false/错误通知、仍未联机、严格快照拒绝、去抖及 GET 期间 idle/新请求、取消，且真实序列化结果能被现有宿主接收。没有改写 production writer/initializer 来“证明”恢复。

全量 `npm test` 已执行：697 项，689 通过、7 失败、1 跳过。7 组失败均为现有 `generic-hooks*` 测试加载缺失的独立 `packages/dsh-hooks` 模块时出现 `ENOENT` / `ERR_MODULE_NOT_FOUND`，不是 AU05 灯光断言失败；本轮没有创建、删除或恢复该模块。晚联机恢复、原生生命周期和原快照恢复测试在全量运行中也通过。不能据此声称全量通过，详见 完整回归日志（本机临时证据，未入库：`../Temp/lamp-repair-full-tests-20261104.log#L848-L885`）。

