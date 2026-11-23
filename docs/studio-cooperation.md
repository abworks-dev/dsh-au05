# Studio 协作模式与 DSH Hook：分阶段可行性验证

**首次采集日期**：2026-10-29。第一轮使用 agent-reach GitHub／gh 只读源码核查、本机安装脚本及 DSH 实现核对、Node 限时启动官方 CLI；该轮未进行二进制逆向。后续增加已安装厂商二进制的静态解码及经授权的本机有界运行试验，分别在各轮注明。没有安装／卸载用户 AI Hooks、修改用户 Codex 配置、录音或审批。复现探针保留在本机 `.local`，不作为发布运行入口。

## 当前结论（更新至第十轮，Studio 3.4.8）

- **已实测**：临时插件的 AU05 旋钮按下／松开、双向旋转；`dsh` 专属订阅／退订；官方 CLI 为一个隔离的人工 `dsh` 测试会话发布五段状态，Studio 逐条推送同一会话和状态的通知。
- **新增有限实机通过证据**：第七轮沿官方 CLI 入口发送修正后的六组事件／状态配对，用户确认中间 K2／K3 都呼吸，后续均熄灭。发送侧仍为 `dsh` 和单一随机隔离会话。第四轮“旋钮始终亮、K2／K3 未变化”保留为修正前的历史失败；本轮没有插件 NOTIFY 回执，不把 CLI 返回当作灯态确认。
- **已定位具体分歧**：官方 `PermissionRequest/notification` 走先检查、后入队分支；原探针自造事件名走先入队、后检查分支，新通知会命中自身而跳过灯更新。还确认 3.4.8 的普通状态映射不是先前假定的逐灯语义表。详见第五轮；第七轮的新实机反馈只确认本次 K2／K3 的呼吸与后续熄灭，不泛化为全部灯效或生产可靠性。
- **离线修正及一次人工事件序列复验已完成**：独立适配器采用官方六组事件／状态配对，固定 `agent_id:dsh` 和不透明单会话标识；普通审批日志不冒充 `PermissionRequest`。第六轮的相关 31 项回归、全仓 297 项测试属于离线证据；第七轮人工观察单独记录，不冒充真实 DSH 会话自动驱灯验收。
- **真实工具事件自动转发首次取得有限实测证据**：修正版服务显示 `session_contract_vthree`，GUI CLI 成功 0→2→3；另一有效窗口中用户确认旋钮在开始时亮起、最近事件随后变成 Stop，但灯仍常亮。真实工具事件转发已获程序证据，Stop 与该次灯态按人工证据记录。第十轮用户补充确认**官方 Codex 任务结束后旋钮也一直常亮**，因此该现象与官方行为一致，不再以“必须灭灯”判定官方对齐失败；自动全灭属于另一项尚未实现的定制需求。仍不扩展为完整生命周期、真实待审批接线、K1 或完整协作后端验收。试验结束后已按用户选择卸载 DSH 临时验证组件。
- `getAiAgentSessions`／`getAiAgentProjects` 是本地历史目录查询，不是活跃灯态读回；未读取用户 Claude／Codex 历史。
- 第七轮的 Studio 临时插件已删除并正常重启清理队列；原 8 个预设文件、直连 15 个文件及 3 个 Hook 配置路径未变。第八轮另行安装的是 DSH 限时验证组件，不是原 Studio 输入探针；其设置页迁移在第八轮记录，第九轮已按用户选择卸载并完成正常重启清理。

## 第一轮结论（历史记录）

| 环节 | 本轮证据 | 结论 |
|---|---|---|
| DSH 真实生命周期接入点 | 已安装实现与提取缓存校验一致；真实消费者使用 session/agent 事件 | 可做独立 DSH Hook adapter |
| 独立适配器 | 新增默认禁用、单会话、限时、元数据原型；13 项模拟上下文测试通过 | 实现可用原型，尚未安装到当前 GUI／捕获真实事件 |
| Studio 接受 DSH 身份 | 官方 CLI 1.0.24 用 `--agent dsh` 的隔离实验返回空 JSON 对象 | 未取得有效状态确认，不能算接入成功 |
| Studio 控制 DSH 任务灯 | 没有可验证的 DSH 状态进入 Studio 的证据 | 未验证 |
| AU05 按下／抬起／旋转回传 | SDK 有通用 API，但当前文档设备名单没有 AU05 | 未验证，不等于不可能 |

所以本轮**没有把现有插件切换成 Studio 协作模式，也不提供“伪装 Codex”兜底**。全仓离线回归 279/279 通过、0 跳过（含既有直连插件的已安装 DSH loader／React 隔离 fixture），新增 Hook 的 13 项使用模拟上下文；源码／本地文档检查 76 项通过。两者都不替代新适配器在真实会话中的运行或实体灯验收。

## DSH Hook 的实现边界

独立代码在 [原型目录](<../packages/dsh-studio-hook/README.md>)。只观察显式目标会话和同一挂载代次，输出不含会话原文、工具参数、审批理由或原始会话 ID。`session/created` 是内存会话挂载／恢复事件，不能直接冒充首次持久化创建；`approval/asked` 可能被策略自动处理，不冒充 GUI 待确认灯态。需要准确焦点和待交互状态时，后续还要增加独立 Client 投影。

DSH 已安装 `0.2.1-rc.3` 的 `dsh-api-session-controller/lib/index.js:2980–3003` 使用 `session/created`、`session/disposed`、`agent/status`、`session/event`，且其 SHA256 与当前 ASAR 对应条目一致：`a9801acb577b03053c5d5a3191ff555c5f1d791d0acddec113bea4511e33b386`。这是入口可用的源码证据，不是原型已经在真实会话运行的证据。

## Studio 身份探针实测

测试前后均观察到 Studio 进程 1、Studio 自己持有回环端口 3906、AU05 原生直连采集器 0。

官方安装 manifest 指向 CLI **1.0.24**。被测可执行文件 SHA256：`7364b7d15b0a7de22faaae950876f5f6bf6372947c3bd9c34f9dc16d67d0797c`。使用随机 `dsh-coop-probe-…` 实验标识与仅含 `session_id`、`hook_event_name` 的人工测试 JSON；**不是伪称真实 DSH 会话事件**，也不使用 Codex 身份。每个进程超时 3 秒，输出只记录形状，不记录任意正文。

先后两轮 `SessionStart`／`Stop` 探针均退出码 0、输出 4 字节；第二轮解析确认两者均为 `{}`。这只证明进程可执行并返回，**不能证明事件被 Studio 接受、建立 DSH 会话或改变实体灯**。所用 stdin 是最小实验输入，不宣称已得到官方编译 CLI 的完整契约。没有直接打开 HID；Studio 是否产生了间接设备写入不在本轮测量范围内。

安装器 `installers/install.js` 的 Agent 表仅列 `claude-code`、`codex`、`gemini-cli`、`cursor-agent`、`codebuddy`、`kiro-cli`、`kimi-cli`、`copilot-cli`；未知 Agent 在安装器层被拒绝。`hooks/mappings.js` 中也没有 DSH 映射。安装器限制不能推导编译 CLI 一定拒绝任意 Agent，空响应同样不能当作支持。

特别排除：`device-hook.js` 的 HTTP／设备直发代码是另一条路径，不能把其 JSON 格式拿来宣称 USB AU05 的 Studio CLI 已支持。

## 公共 SDK 与输入回传

- [官方 SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK/tree/550ab80c69285ecf259bd494a7fff767c14f0c0f)，取到日期 2026-10-29。其内嵌 `ulanzi-api/libs/ulanziApi.js:741–868` 有 `onKeyDown`、`onKeyUp`、`onDialRotate` 等通用回调；未证明 Studio 对 AU05 派发这些回调。
- [官方 Codex／Claude 状态说明](https://docs.ulanzistudio.com/vibekey/faq/codex-claude-status.html)，取到日期 2026-10-29。说明 Hooks 与焦点灯态，但未公布自定义 Agent 状态发布协议。
- [社区 Studio 链路记录](https://github.com/MrCroxx/olanzi/blob/eb78f88f973d4d28f1d6d3369cdfb65881b1e1c6/docs/01-ulanzi-studio-scope.md)，此前已取正文、本轮复核引用。记录了订阅命令名称，但缺少可验证请求形状；且是 macOS／特定版本逆向，不可当作当前 Windows 的正式发布接口。

## 现有直连模式保持不变

开始前对 `packages/dsh-plugin` 全部 15 个文件记录 SHA256，结束后逐一复核一致，新增／删除均为 0。未改变该插件的源码、配置、偏好、注册或设备连接。新原型不在原插件 import 路径内；没有添加自动回退、自动连接或替用户回答审批。

## 第一轮的下一步与未解决项（历史记录）

1. 获得 Studio 自定义 Agent 注册／状态发布的可验证接口；否则保留 dry-run，不继续猜 JSON 或换成 Codex 身份。
2. 在独立 DSH 测试会话启用原型，核实真实事件，再做 Client 焦点／待交互投影；这不需要接管 HID。
3. 单独验证 AU05 是否能绑定插件动作并提供 keydown/up／rotate；如只能用快捷键，按住说话、设备来源识别和安全审批需要明确降级，不能宣称与直连完全等价。
4. 以上入口打通后，才进行真实 DSH 状态→Studio→实体任务灯的有界验收；K1 的既有未解决问题仍单独保留。

## 第二轮：显式状态与动作绑定契约（2026-10-29）

**采集日期**：2026-10-29。**执行后端**：agent-reach／gh 固定 SDK 提交源码读取、已安装官方 CLI／Studio 静态分析、官方 CLI 限时执行与本机回环 WebSocket 限时观察。**执行查询数**：关键词检索 0；按固定路径及已知源码位置核查。没有冒用已有插件或 Codex 身份，没有安装 AI Hooks、打开 HID、录音或审批。

### 自定义 Agent 不是只能依赖内置映射

已定位 CLI 1.0.24 的实际分支：读取并校验 stdin 的显式 `state` 在已知 Agent 映射查找之前；未知 `dsh` 又未给 `state` 时进入跳过发布分支。标准输出 `{}` 独立于发布逻辑生成，不能作接收回执。这比第一轮“未证明”的结论更进一步，但仍不证明 Studio 会保存任意 Agent。

修正本机实验脚本的换行转义后，以**合法 JSON 加真实 LF 字节 10** 重测最小 `SessionStart`／`Stop`，结果仍均为退出 0、4 字节 `{}`；不将修正前的错误输入算作有效接口阴性证据。另已确认官方 `--help` 明确区分 Hook 模式原始 stdin 与 `--stdin` 的完整消息信封。

静态确认 Hook 模式可构造的发布骨架如下；这是已安装二进制实现事实，**不是公开稳定 API 承诺或实机接收证明**：

```json
{
  "type": "event",
  "action": "hook-fired",
  "params": {
    "type": "state",
    "agent_id": "dsh",
    "hook_source": "ulanzi-studio",
    "session_id": "dsh-coop-probe-example",
    "state": "idle",
    "event": "SessionStart"
  }
}
```

校验器允许的状态为 `idle`、`thinking`、`working`、`notification`、`attention`、`sleeping`、`sweeping`、`error`（修剪空白后匹配小写）。`sleeping` 仅是状态，**不等于删除会话**。尚未证实删除／过期机制，因此没有仅凭该分支就在真实 Studio 内批量投递实验会话。

二进制证据：CLI `resolveState` RVA `0x2A640`，显式状态检查 `0x2A7E1–0x2A842`，有效返回 `0x2A850`，映射回退 `0x2AAFC`；空状态跳过发布 `0x284A9–0x284C5`。信封构造 `0x15EA0`、Hook 包装 `0x15E00`、事件包装 `0x15D50`。文件哈希同本页第一轮记录。

### AU05 与插件输入

已安装厂商 `device_type_source.json` 的 AU05 布局为 1 列、4 行、1 旋钮；厂商默认配置使用 Keypad 的 `0_0`／`0_1`／`0_2` 和 Encoder 的 `0_3`，走通用动作绑定结构。部分其他厂商动作却通过 `Devices` 明确排除 AU05，所以不能由这一结构推导所有自定义动作可绑定。

固定 SDK 提交的 `ulanziApi.js:23–51` 确认最小 WebSocket 注册帧为 `{"code":0,"cmd":"connected","uuid":"自己的插件 UUID"}`。主服务按四段 UUID 区分；事件名包含 `keydown`、`keyup`、`dialdown`、`dialup`、`dialrotate`，旋转方向位于顶层 `rotateEvent`。**不得注册厂商或现有插件 UUID，以免抢占其路由。**

本机使用随机四段 UUID 建立过一次 5 秒连接，按 SDK 形状发送注册与只读 `getAiAgentSessions` 查询；连接成功、正常关闭，但收到 **0 字节**，无注册或查询确认。没有安装和匹配动作绑定时的静默，**既不证明注册成功，也不否定 AU05 能回传**。该查询在 Studio 静态实现中还明确限制为插件主服务，不能用 CLI 的本地历史 `ai-sessions` 命令代替。

用户随后明确允许新增独立临时测试插件及测试配置，临时绑定 K1／旋钮，结束后切回原配置并移除测试插件。此授权不改变本页“未验证”的验收口径；接收回包、真实输入与清理结果必须分别记录。

## 第三轮：独立插件的真实旋钮回传与 DSH 过滤订阅（2026-10-29）

**采集日期**：2026-10-29。**执行后端**：本机 Node／Studio 内置 Node `v20.12.2` 的有界回环 WebSocket；Windows UI Automation 与仅作用于 Studio 窗口的鼠标操作；已安装 Studio 静态解码。**执行查询数**：网页关键词检索 0；一个 120 秒真实输入窗口、一个只读错误分类连接、一个 `dsh` 专属订阅／退订连接。另有两个不注册身份的握手比较。没有打开直连 HID、发送系统快捷键、录音、处理 DSH 审批或发布 Agent 状态。

### 1. 部署与绑定：已实际完成

仅向 Studio 用户插件目录新增自有 `com.ulanzi.au05coopc7d41a.ulanziPlugin`，主 UUID 为 `com.ulanzi.ulanzistudio.au05coopc7d41a`；未使用厂商或其他已安装插件身份。Studio 界面实际列出了该动作。通过 Studio 自己的“创建默认预设”界面新增 **AU05 COOP TEST c7d41a**，没有修改原配置。

Studio 保存的新预设页明确包含：Keypad `0_0` 和 Encoder `0_3` 均绑定自有 `.input` 动作、各有独立 `ActionID`。这是 AU05 能保存该插件动作绑定的实机证据，不只是根据 SDK 设备名单推断支持。它仍不保证每个物理输入都会分发。

首次临时服务在 5 秒内握手失败，未获得真实输入，不算有效功能验收。恢复后分别用 Node `v24.22.1` 与 Studio 内置 Node `v20.12.2` 比较，仅做握手即正常打开并关闭（约 12ms／10ms）；未据此认定首次失败的根因。

### 2. 真实输入窗口：旋钮通过，K1 未通过

用户确认 AU05 已连接后，启动一次自有 120 秒服务。原生直连采集器为 0；服务不打开 HID、不生成按键、不录音，只有 Studio 的回环 WebSocket。报告只保留允许的命令、按键位置、方向、相对时间及计数，不保存原始报文或会话正文。

| 收到的 Studio 事件 | 实测计数 |
|---|---:|
| `add`／`setactive` | 各 2 |
| `dialdown`／`dialup`，`key:0_3` | 各 1 |
| `dialrotate`，`right`／`left` | 4／6 |
| K1 `keydown`／`keyup`／`run` | 0 |

旋钮事件均发生在启动后约 37–41 秒，明确处于窗口内。用户按要求执行了 K1 与旋钮操作；窗口未收到 K1，**不写成 K1 已支持，也不据此断言硬件不可能支持**。后续 K1 重试与窗口到期重叠，未获得独立、时序明确的阳性证据，不累计成第二次有效阴性试验。旋转计数是回报数，不等同于已验证每个物理刻度精度。

此服务未收到单独的 `connected` 成功回执；但实际动作激活、输入分发和后续状态订阅成功，已分别提供更具体的协议证据。到期正常退出，`stopReason:120s-deadline`，无自动重连。

### 3. 查询契约纠正：不能拿历史目录 API 读回活跃状态

三个原始 `getAiAgentSessions` 查询均返回 `code:400`，没有读取项目／会话内容。另一个有界诊断只确认错误属于“缺少或无效参数”分类，未记录错误正文。

独立静态复核确定，handler RVA `0x3CF4C0` 首先检查连接侧 UUID 是否存在于内部主服务 map；不通过返回 `403`。随后读取顶层 **`payload`**，要求 `payload.project_id`（别名 `project`），缺失走 `Missing project_id.`／`400` 分支。`payload.agent_id`（别名 `agent`）无默认 Agent。这里是静态原文，不冒充运行时已保留的错误文本。

进一步确认 `getAiAgentSessions` 调用本地历史 catalog（RVA `0x1DFB10`），只分支 `claude-code` 和 `codex`，其他 Agent 返回 `Unsupported agent.`；`getAiAgentProjects` 属同族历史目录查询。因此停止以此验收 DSH 活跃灯态，也没有为了让查询成功而访问用户 Claude／Codex 历史或改用 Codex 身份。

### 4. `dsh` 专属订阅／退订：运行时确认成功

静态订阅 helper 不限制为内置 Agent 表，可以对 `dsh` 设置过滤。只对自有主服务执行以下请求；没有使用无过滤订阅、`include_raw:true` 或任意已有 Agent 身份：

```json
{"cmd":"subscribeAiAgentState","uuid":"com.ulanzi.ulanzistudio.au05coopc7d41a","payload":{"agent_id":"dsh","include_raw":false}}
{"cmd":"unsubscribeAiAgentState","uuid":"com.ulanzi.ulanzistudio.au05coopc7d41a","payload":{"agent_id":"dsh"}}
```

实际两个回包均为 **`code:0`**，随后关闭连接。独立推送计数为 0，自有实验会话匹配数为 0；没有将空结果或订阅确认写成状态发布成功。未解决自定义测试会话的删除／过期规则之前，没有注入“假 DSH 会话”来制造灯态阳性。

### 5. 清理与保留边界

- 服务已正常到期；结束检查自有服务进程为 0。
- 自动清理遇到 Windows 前台权限限制，停在删除前；随后由用户删除上述唯一测试预设并切回原预设。文件核验：原 8 个预设文件全部 SHA256 未变，额外预设目录／文件均为 0。
- 删除前核验临时插件目录身份、非重定向路径和全部原始文件哈希；只移除该自有目录。当前 GUI 的插件分类可能仍有缓存，本轮没有为消除缓存擅自重启 Studio。
- 直连插件全部 15 个文件与第一轮基线逐一一致；没有修改其偏好、切换后端、增加自动回退或提交／推送。

**本轮结束时的下一步**：先明确自定义状态发布的真实订阅读回与测试会话清理规则，再进行单个隔离 DSH 状态→Studio→任务灯的验收；K1 回传需另做时序明确的专门验证。以下第四轮继续此项，不将上述结果当作完整直连替代品交付。

## 第四轮：单会话发布已确认，实体灯映射未通过（2026-10-29）

**采集日期**：2026-10-29。**执行后端**：官方更新页实抓、本机 Studio／CLI 静态解码、限时 CLI `--stdin` 发布、自有插件的回环 WebSocket 过滤订阅、用户人工观察。**执行查询数**：关键词检索 0；按已知官方页面和安装路径核查。只发 `agent_id:dsh` 的人工测试元数据，不使用 Codex 身份，不接入真实用户会话，不打开直连 HID、麦克风或快捷键，不自动操作审批。

### 1. 新版与权限开关的边界

[官方更新页](https://www.ulanzi.cn/software/ulanzi_studio)（取到日期 2026-10-29）列出 2026-10-28 的 V3.4.8：偏好设置／通用中新增 Agent 状态同步权限控制，Codex Micro 更新到 0.5.1。Jina 后端实际返回鉴权错误，改用官方页面直接获取；没有将错误页当证据。

实测运行版本为 **Studio 3.4.8.0**，可执行文件 SHA256 `85896a993e758689990f64d94c726e2c23234ed0e48c9176e6e9a30b2f8a05ca`；CLI 仍为 1.0.24、哈希同前。静态检查发现新权限开关会管理现有 AI Hooks 的安装／卸载，关闭还关联设备 Hooks 模式；它不是已验证的“仅允许自定义 DSH 状态”的开关。因此只读查看，**没有替用户切换开关或更改原 Codex／Claude Hooks**，也没有把物理灯失败直接归因于权限。

### 2. 发布与接收：同一测试会话逐条匹配

临时插件仅恢复上轮自有目录，核对原 UUID 和全部 20 个文件哈希；没有新建预设或绑定。恢复后最初订阅无回包，经用户正常退出并重开 Studio 后，过滤订阅和退订恢复为 `code:0`。

一次早期 CLI 首个 `idle` 请求退出 1、输出 69 字节，未收到目标通知；只保存错误形状，没有把它算成发布成功。之后扩展非敏感 Windows 身份环境变量，并确认本地 IPC 已就绪，发布成功；初始化时间和环境同时变化，**没有独立隔离出首次失败根因**。双方静态端点均为 `ulanzistudio_cli`，与单例端点不同，不能归因于版本改名。

有效探针先等 `dsh` 订阅确认，再通过官方 CLI 发送完整 `event / hook-fired` 信封，携带 `type:state`、随机 `dsh-coop-probe-…` 会话 ID、固定测试事件 `DshCoopLightTest`。每轮仅一个人工会话。接收方只接受自有 UUID、`didReceiveAiAgentState`／`NOTIFY`，且 `agent_id`、会话 ID、预期状态全部相等；不保存原始推送或会话正文。订阅确认本身不充当状态回执。

| 顺序 | 发送状态 | 第一轮匹配通知（相对毫秒） | 重测匹配通知（相对毫秒） |
|---|---|---:|---:|
| 1 | `idle` | 55 | 63 |
| 2 | `thinking` | 3111 | 3116 |
| 3 | `notification` | 38162 | 63173 |
| 4 | `attention` | 73223 | 123223 |
| 5 | `idle` | 108281 | 183291 |

两轮各 5 次 CLI 均退出 0，Studio 均逐条确认，最终退订 `code:0`、连接正常结束。第一轮约 113.3 秒；用户错过观察，不计实体灯验收。用户要求重测后先正常重启清掉第一轮内存会话，第二轮每个活动阶段延长至 60 秒，约 188.3 秒结束，240 秒硬上限、无自动循环。没有把两轮会话同时堆在内存中继续试验。

### 3. 实体灯：明确的未通过结果

用户重测反馈：**“旋钮一直是亮的，但是K2，K3没有亮过，也没有呼吸。”**

因此只确认了 CLI 发布到 Studio 推送链路。旋钮没有随阶段发生可归因的变化；K2、K3 未达到预期。**不宣布旋钮受本探针成功控制，不宣布任务灯映射完成，也没有在失败后继续猜灯控报文或冒用 Codex 重试。** 这仍是人工测试状态，不是独立 DSH Hook 原型已自动捕获真实会话的证据。物理分发／模式门控与官方 Hook 语义之间的差异留待后续定点复核。

### 4. 清理已实际完成

- 两轮探针均有明确结束记录，退订成功；不残留发布循环，也没有创建原生 HID 采集器。
- 尚未确认单会话删除或 TTL 契约，`idle`／`sleeping` 不冒充删除。按用户授权及实际手动操作，Studio 正常退出；核实进程为 0 后才继续，没有强制结束。
- 校验目录身份、非重定向路径及文件哈希后，仅移除自有临时插件。没有新预设需要删除；原 8 个预设文件未变，额外目录／文件为 0。
- 正常重开同一哈希的 Studio 3.4.8：新进程创建，3906 监听和 CLI pipe 就绪。旧进程的内存队列随退出释放；不借此声称已验证未知持久化／TTL 行为。
- 直连后端 15 个文件哈希未变；3 个 Hook 配置路径的存在性／内容哈希未变。没有切换 DSH 后端、改动语音偏好、安装／卸载用户 Hooks、提交或推送。
- 本机 `.local` 中的只含允许元数据的测试报告与部署收据保留用于复核，不是已安装的用户配置；没有清扫厂商日志或用户历史。

**本轮结束时的后续边界**：自定义 `dsh` 状态能进入 Studio 已得到运行时证据，但到物理任务灯的映射仍失败。以下第五轮定点比较官方 Hook 与这个显式状态事件，不泛化研究 K1、不盲试灯报文，也不把现有直连插件改成不完整协作模式。

## 第五轮：直接对照官方 Codex Hook，定位事件门差异（2026-10-29）

**采集日期**：2026-10-29。**执行后端**：agent-reach 开发路由下的本机官方已安装 JS／CMD 只读核查；复核现有 Studio 3.4.8 静态证据，仅补读少量固定代码／常量字节，不执行厂商代码。**执行查询数**：网络关键词检索 0。没有运行 CLI、连接 Studio、发布状态、试灯、改用户配置或读取会话历史。

### 1. 可直接参考的是事件与状态成对的适配，不是 Codex 身份

本机官方 `hooks/mappings.js:18–25` 明确为：

| Codex Hook 事件 | 官方语义状态 |
|---|---|
| `SessionStart` | `idle` |
| `UserPromptSubmit` | `thinking` |
| `PreToolUse`／`PostToolUse` | `working` |
| `Stop` | `attention` |
| `PermissionRequest` | `notification` |

安装器 `installers/install.js:281–298,330–351` 按事件生成包装器调用。`ustudio-cli-hook.cmd:3–21` 只处理 UTF-8、安装目录 PATH、包装器标记和 EXE 参数透传；没有选择设备、窗口焦点或灯模式。正常 Hook 的完整 stdin 筛选／封装仍在编译 CLI 中，不能用另一条 `route:device-direct`／HTTP `/events` 辅助路径的字段代替。

本机可复核源码根目录（不作为跨平台 CI 的外部文件依赖）：

```text
C:/Users/ASUS/AppData/Roaming/Ulanzi/UlanziDeck/ustudio-cli/
```

因此 `notification`／`attention` 没有拼错，但它们只是语义状态，不能单凭名称推导实体灯模式。原人工序列没有覆盖 `working`，也没有保留真实 Hook 事件上下文；这与正常 Codex 链不等价。

### 2. 最具体分歧：`PermissionRequest` 会改变通知队列的检查顺序

Studio 3.4.8 的可见非 D100N 路径先广播状态，再走灯处理：RVA `0x167C9E` 调用通知函数 `0x3DC800`，随后检查当前设备类型，非 D100N 于 `0x167D43` 调用 `updateIndicatorLightByState`（`0x1B9670`）。所以广播确认不等于已经执行灯更新。

`0x1B973A–0x1B9817` 的通知处理可简化为以下控制流；这是静态重建，不是声称拥有厂商源码：

```text
if state == notification and (event == PermissionRequest or permission_suspect):
    had_notification = hasNotification(current_device)
    updateQueue(current_device, session_id, state)
    if had_notification: skip_LED
    else: map_and_send
else:
    updateQueue(current_device, session_id, state)
    if hasNotification(current_device): skip_LED
    else: map_and_send
```

固定小函数 `0x1EA80–0x1EAEF`、`0x1F110–0x1F17F` 分别确认比较常量为 `PermissionRequest` 与 `notification`，没有猜事件名。原探针发送 `event:DshCoopLightTest` 且没有发送 `permission_suspect`；在无该特殊标志的普通分支中，新写入的通知本身会使后续通知存在性检查成立，跳过灯更新。官方 `PermissionRequest` 在此前无通知时则可以进入映射／发送分支。

**这是能解释第四轮结果的具体实现差异，不是“自定义 Agent 一定被拒绝”，也不是已经完成实机修复。** 尚未用修正事件的新试验排除所有其他设备／模式因素，不把 `permission_suspect` 当作应该随意添加的绕过标记。

### 3. 设备、模式和焦点分别能证明到哪里

- 当前这段分发与队列处理没有可见的 `agent_id` 白名单比较，不能归因于 `dsh` 名字被拒绝。也没有在可见调用链读取 OS／窗口焦点，不把其他函数的 `focusTime` 当作这里的会话选择证据。
- 目标设备来自 `UlanziDeck + 0x778` 的当前设备 UUID，设备类型来自 `+0xA30`；队列按设备 UUID 与会话 ID 分组。没有证明要在事件中补某个设备 ID，也没有核实该 UUID 的完整赋值／激活时机。
- 3.4.8 非 D100N 状态映射函数 `0x182790` 把 `idle/attention/error/sleeping/thinking/working/sweeping` 映成 task indices `1/2/3` 的原始值 `(0,0,1)`，`notification` 映成 `(2,2,1)`。依据是常量 RVA `0x63FDE0/0x63FDF0` 和调用方 `0x1B981D–0x1B98F3`。这轮只确认原始数值和索引，未重新确认 SDK 内枚举与物理灯对应，不能把旧版本灯表直接套用。
- `DialDeviceManager::onSetIndicatorLightWorkModeType`（`0xC62D0`）先校验当前 UUID、SDK 函数指针和设备解析结果，再间接调用 SDK。可见 Host 包装器未读 Hooks mode；SDK／固件内部是否再做模式过滤仍未知。新增 Agent 同步开关没有被改动。

静态证据在本机临时取证目录的 `studio_cleanup_initial.txt`、`studio_cleanup_queue.txt`、`isolated_studio_setting_store.txt`；函数均按第四轮记录的 3.4.8 文件哈希复核，不套用旧 3.4.4 RVA。

### 4. 最小修改方向与本轮边界

应保留 `agent_id:dsh` 和既有单会话隔离，参考官方事件／状态成对映射：真实用户输入对应 `UserPromptSubmit/thinking`，真实工具生命周期对应 `PreToolUse`／`PostToolUse/working`，真实且当前可回答的权限审批对应 `PermissionRequest/notification`，回合结束对应 `Stop/attention`。不能将挂载已有会话冒充新 `SessionStart`，也不能将普通提问或自动处理的权限请求冒充可审批事件。

先补纯离线适配回归，再在单独授权下做一次修正后的有界实体灯验收；不伪装 Codex、不复制用户 Codex 配置、不重打包厂商闭源 EXE、不新增 HID 猜测写入。**本轮只定位并记录差异，未修改发送器或直连代码，未新建临时 Studio 配置，也没有再试灯。**

## 第六轮：按官方事件配对修正独立适配器（2026-10-29）

本轮依据用户授权修改代码并离线验证，没有重新运行 Studio 发布、试灯、录音、发送快捷键或操作真实审批。未修改既有直连后端、用户预设、Codex／Claude Hook 配置，也未部署临时插件。

### 1. 固定官方配对，保留 DSH 身份

新增[纯映射模块](<../packages/dsh-studio-hook/mapping.js>)，统一构造 `type:event`／`action:hook-fired` envelope。六组配对与第五轮官方表一致：`SessionStart/idle`、`UserPromptSubmit/thinking`、`PreToolUse/working`、`PostToolUse/working`、`Stop/attention`、`PermissionRequest/notification`。

身份始终为 `agent_id:dsh`；wire 会话使用随机不透明 `dsh-…` 标识，不复制真实会话 ID，不允许调用方注入其他 Agent、自由状态或 `permission_suspect` 绕过标志。对象和映射冻结。构造器拒绝未知事件及不符合 `dsh-…` 格式约束的标识，状态只由映射决定；观察器默认生成随机标识，不将真实会话 ID 传入构造器。

### 2. 真实 DSH 元数据投影与隔离

[观察器](<../packages/dsh-studio-hook/core.js>)保留会话注册表当前对象、对象相等性与代次检查，新增严格递增的事件序号去重及工具调用关联：

- `session/created` 仍只表示挂载；不伪造 `SessionStart`。`agent/status` 不伪造工具开始。
- 真实用户消息投影 `UserPromptSubmit`；真实 `tool/call` 投影 `PreToolUse`。
- `tool/result` 必须通过 `data.message.source.callId` 对应同代次已开始调用；显式 surface 重写、重复、孤立结果和过期序号不产生 `PostToolUse`。Host 未附 surface 元数据时，也必须满足调用关联和序号检查。不猜 PTC 等其他结构。
- 同会话真实 `turn/end` 投影 `Stop`；重复结束及结束后迟到的工具／审批回调失效。卸载不伪造回合结束。
- `approval/asked`／`approval/decided` 仍仅为诊断元数据，不触发 `PermissionRequest`。
- 新增纯本地 `syncPendingApproval(session, expectedGeneration, pending)`，只接受当前代次、同对象同会话、`kind:approval`、可回答且有 answer 方法的投影；从不调用该方法。每项去重，结算项不得复活，提问／计划审阅不得冒充权限审批。

**待审批投影入口尚未绑定真实 GUI或注册公共 RPC。** 不能据此声称已经自动捕获真实待审批；序号／调用关联的模拟验证也不替代真实 Host 事件流验收。

### 3. 默认仍关闭，不自动向 Studio 发送

插件入口仍只允许 `transport:dry-run-only`，默认 `enabled:false`；生成的 envelope 只是日志中的纯数据，不启动 CLI、WS 或 HID。适配器未安装进当前 DSH。

本机人工发布辅助脚本已改为导入同一映射器，移除手工拼接自造事件作为实际发布入口，按六个官方事件生成序列；状态确认同时核对自有 UUID、`dsh` 身份、同一不透明会话、事件及状态，避免将旧通知认作当前事件成功。该脚本仍须显式授权运行并安排正常退出／重启清理；**本轮只执行语法检查和 12 项零资源分类自测，没有启动发布或重建临时插件。**

### 4. 验证结果与未完成项

- `node --test test/studio-hook.test.js test/studio-hook-mapping.test.js`：31/31 通过。新增 18 项覆盖官方配对、身份／隐私、序号、工具关联、审批真实性及跨对象／跨代次拒绝。
- 全仓：297/297 通过、0 跳过，包含既有直连插件的已安装 DSH loader／React 隔离 fixture；不把该 fixture 当成新 Hook 已在真实会话运行。
- 源码／本地文档检查 78 项通过，构建一致性与空白检查通过。

本轮修复的是确定的事件映射与隔离逻辑。**修正后的实体灯尚未复验，第四轮物理失败记录保持有效。** 下一步如获授权，才重建自有临时插件并做一次独立会话的官方事件配对发布，随后退订、正常退出／重开 Studio 清理内存队列、删除自有插件，并核验原配置基线。不得用 `idle` 冒充删除或用状态 NOTIFY 冒充实体灯确认。

## 第七轮：官方配对、独立 DSH 会话的实体灯复验（2026-10-30）

**用户授权**：连接 Studio 实机验证灯效，保持 DSH 身份和会话隔离；开始前确认设备已唤醒、Studio 显示已连接，允许测试后正常退出／重开以清理临时会话。没有冒用 Codex、读取会话历史、打开麦克风、发送快捷键或操作真实审批。

### 1. 先释放直连，使用实际可用的官方入口

开始时发现 DSH 原生直连采集器 1 个，通过自有 GUI“断开设备”正常释放，随后核实为 0；未更改持久语音／自动连接偏好，也未强制结束进程。

按历史收据和全部文件哈希恢复自有临时订阅插件后，用户正常退出 Studio，再启动已复核 SHA256 的 3.4.8。Studio 显示已连接，官方 CLI pipe 就绪，但本机 3906 无监听，Studio 没有其他 TCP 监听。最初的 WS 就绪检查因此失败；**此时尚未发布状态，未反复连接或修改 Agent 同步设置。**

改用同一官方 CLI 的 `--stdin` 入口，不依赖插件 WS。新增本机限时辅助脚本默认不运行；显式授权开关、固定 CLI 1.0.24 哈希、禁用 shell、单子进程、3 秒单次超时／32 KiB 输出上限、180 秒总上限；只在内存使用一个随机 `dsh-…` 会话标识，并导入第六轮的同一纯映射器。发送侧 `agent_id` 始终是 `dsh`，没有 Codex 兜底。脚本语法和 4 项零资源自测通过后，才经再次确认开始。

### 2. 本轮发送记录与人工观察必须分开

唯一一次发布任务正常结束，耗时 **148473 ms**。下表为相对任务开始的 CLI 完成时间，均退出 0、无超时、输出 0 字节；这些不是 Studio 接收或灯控 ACK：

| 相对毫秒 | 事件 | 状态 | 后续观察窗口 |
|---|---|---|---|
| 65 | `SessionStart` | `idle` | 3 秒 |
| 3127 | `UserPromptSubmit` | `thinking` | 15 秒 |
| 18190 | `PreToolUse` | `working` | 5 秒 |
| 23354 | `PermissionRequest` | `notification` | 60 秒 |
| 83412 | `PostToolUse` | `working` | 5 秒 |
| 88468 | `Stop` | `attention` | 60 秒 |

用户在针对整轮的观察问题中明确选择：**中间 K2／K3 都呼吸，最后均熄灭。** 这是修正后首次明确的 K2／K3 物理变化证据，不能只写成“CLI 成功”。由于 `PostToolUse` 在 `Stop` 前已切换状态，不单独断言熄灭只能由 `Stop` 引发。

本轮没有状态订阅／NOTIFY 回执，因此不声称经读回核实了 Studio 内部会话状态。程序报告中的 `physicalLampsConfirmed:false` 表示程序本身没有物理传感确认；上述人工反馈在本报告单独记载，不篡改原始程序报告。没有单独确认旋钮在每一阶段的具体变化，也未验证 K1。

### 3. 清理已完成

发布任务已正常结束并收集退出码，没有自动重试或常驻发布循环。本轮没有成功建立订阅，所以没有需要退订的连接。

用户再次从托盘正常退出 Studio；核实进程数 0 后，按 UUID、目标目录、非重定向路径和完整文件哈希，仅删除自有临时插件。原 8 个预设文件无变化、额外预设目录／文件为 0，既有直连 15 个文件及 3 个用户 Hook 配置路径的基线均未变。

随后正常启动同一已复核 Studio，CLI pipe 就绪、Studio 1 个、原生直连采集器 0。未要求当前未使用的插件 WS 端口就绪；没有强制结束或启动参数注入。退出释放了旧进程内存中的本轮测试队列，不将 `Stop`、`idle` 或未验证的 TTL 当作删除机制。临时插件目标目录确认不存在；只保留本机忽略目录中的源脚本、收据及不含会话 ID／正文的复核报告。

### 4. 本轮结论与边界

**可确认：在这一轮人工隔离序列中，保持 DSH 发送身份的官方事件配对，能够通过 Studio 使 K2／K3 出现呼吸并随后熄灭。** 这与修正前失败结果不同，但不能单次试验排除所有其他环境因素或证明长期可靠性。

真实 DSH 会话事件自动接入、GUI 待审批投影接线、K1 回传／语音灯、所有旋钮灯态、多会话竞争及长期稳定性仍未完成验收。适配器仍默认禁用／只记日志，既有直连后端未切换成 Studio 协作模式。

## 第八轮：真实会话验证器、事件类型修正与设置页入口（2026-10-30）

**执行后端**：已合法复制的官方 DSH `0.2.1-rc.3` SDK 源码、模拟上下文回归、官方插件管理器和自有 GUI 控件检查。没有绕过 ASAR 的 no-follow 限制，没有伪造会话事件、审批或灯态回执。

### 真实窗口的结果不是通过

新增独立的 owner-only `start/poll/stop` 服务与固定官方 CLI 发送器：显式选择唯一主会话，随机不透明 `dsh-…` wire 身份，校验真实 Session 对象、注册表、代次和起始序号；硬上限 120 秒、失去心跳最多 5 秒停止，不自动重启或跟随其他会话，不读正文／参数／审批理由。

第一轮真实窗口到期时显示 **CLI 成功 0**；后续用户反馈旋钮一直常亮，这不能归因为本验证器驱动。又发现提问时输入区被替换，原输入区贡献随之不可见，后来看到“未启动”而不是原状态；不能把这个现象当作事件已经发送或单独确定全部重挂载原因。尚未取得真实会话自动发送成功或其实体灯态验收证据。

### 已按公共类型修正两处确定错误

- 公共 `SessionEvent` 有 `type/seq/time/data`，**没有必填 sessionId**。现在使用回调 Session 对象与注册表作为权威边界；缺少该字段不再被丢弃，若显式携带矛盾 ID 仍拒绝。工具结果使用 `data.message.toolCallId`，不再取旧的 `message.source.callId`。
- 公共消费者使用 `{ global: true }` 接收跨插件作用域事件；验证器采用同一方式，但后续仍以所选精确对象、序号与代次过滤，不接受其他会话。

依据为复制件 `dsh-api-session-controller/lib/typert.host.js:2799/2807/3167` 与 `lib/index.js:1529–1545`。新增真实形状及反例回归；离线通过不证明已安装 Host 的 ESM 缓存已经更新，GUI 的 `session_contract_vthree` 校验码用于区分实际服务版本。

### 根据用户反馈迁到设置页

通过官方 `settings.section`（list/root）注册 **设置 → AU05 / Studio**，不再注册 `conversation.input.dock`。官方设置壳只传 `{ close }`，不传 sessionId，所以组件订阅公开 `uiSession.current` 和会话列表，按钮点击时重新检查唯一主会话并锁定绑定。选择题替换输入区不会移除这个设置贡献；关闭设置、切换设置分区或目标会话仍会停止，不后台续跑。安装、启用组件和打开设置都不会发送事件。

公开契约依据：复制件 `dsh-client-ui-settings-general/lib/client.js:1264–1267,1299–1309` 及 `:335–337`。本次不修改原 AU05 直连插件、原 Studio 预设或用户 Codex／Claude Hook 配置。真实待审批仍未接线，不从普通审批日志制造 PermissionRequest。迁移前已停用临时 DSH 验证组件，完成后通过官方管理器重新启用待命服务，没有点击验证。本机原生设置导航的自动化定位不稳定，按用户同意改为手动打开设置；用户明确反馈 **设置里已经看到了 AU05 / Studio**。这是入口可见的人工确认，不是自动化完整渲染断言，也不代表 Host 版本校验、真实事件计数或灯态通过。

本轮最终离线回归 **329/329、0 跳过**（其中本原型相关 63 项）；源码检查 85 项通过。新增实际验证器状态经严格 RPC codec 的集成检查，版本标记采用允许字符内的 `session_contract_vthree`，避免数字被诊断码白名单拒绝。直连 15 文件、原 8 个 Studio 预设（额外目录／文件 0）基线复核未变。临时 DSH 组件仍安装、已启用但未启动观察；后续只有用户明确点击设置页按钮才会开始真实事件验证。该次只获准检查入口，因此没有继续自动启动或制造事件；后续真实会话试验另记如下。

## 第九轮：首次真实工具事件自动转发（2026-10-30）

用户再次授权继续真实会话验证。先只读确认 Studio 1 个、DSH 原生直连采集器 0；直连 15 文件、原 8 个预设（新增目录／文件 0）及 3 个用户 Hook 配置路径基线未变。没有使用人工状态序列、Codex 身份、录音、按键或审批。

第一段 140 秒只读 GUI 观察始终为“未启动 · CLI 成功 0”；用户随后明确表示忘记点击，不能记作真实事件丢失试验。下一次显式 GUI 启动因当时界面条件不满足被保护拒绝，未调用按钮；重新只读确认唯一面板、唯一主会话及可用启动按钮后，再执行一次启动。

### 首次有效窗口

本机设置页通过唯一按钮明确启动，观察脚本只读取该自有面板的封闭状态、计数和校验码，未输出会话 ID／正文。实际服务先显示 `session_contract_vthree`，证明本轮确实加载了修正版 Host，而不是仅源文件更新。

| 观察器启动后约 | 实际 GUI 证据 |
|---|---|
| 1.4 秒 | 运行中、剩余 120 秒、CLI 成功 0，修正版校验码 |
| 9.4 秒 | CLI 成功 2，最近 `PostToolUse`，`cli_returned_not_lamp_ack` |
| 15.3 秒 | CLI 成功 3，最近 `PreToolUse` |
| 121.5 秒 | 已到期、CLI 成功 3，启动可用、停止禁用 |

观察器共运行约 135 秒并正常退出，相关后台任务均已收集。窗口内执行了真实的基线核对工具与等待观察器的工具调用；没有直接调用映射器来伪造这些事件。等待工具的结果在 120 秒上限之后才返回，所以不能将本轮称为完整工具前后及回合结束验收，更未取得 `UserPromptSubmit`、`Stop` 或真实 `PermissionRequest` 的本轮自动发送证据。

**可确认的新增结论：真实 DSH 工具事件 → 单会话隔离适配器 → 官方 Studio CLI 已首次取得 3 次成功返回的 GUI 证据。** CLI 返回不是设备确认；用户表示没有观察灯态，故本轮物理灯态仍未验收。

### 安全时限与清理

“到期”仅指显式验证的 120 秒硬时限，不是任务完成或授权到期；到时停止观察和发送，不伪造 `Stop/idle`，也不保证 Studio 灯会熄灭。用户请求再次观察，并已正常从托盘退出 Studio。核实 Studio 0 个后正常重开已复核程序，CLI pipe 就绪；未强杀、未改启动参数，3 个 Hook 配置基线仍未变。旧进程退出释放了上一窗口队列；这不等于临时 DSH 组件已经卸载。

### 第二个有效窗口：自然结束与人工灯态反馈

用户确认正在看设备并允许直接启动。设置页唯一按钮再次明确启动；约 1.4 秒时显示剩余 120 秒、CLI 成功 0、`session_contract_vthree`。随后执行一个真实只读基线检查工具，设置页显示剩余 104 秒、CLI 成功 1、最近 `PreToolUse`、`cli_returned_not_lamp_ack`。助手没有等待到期，而是正常结束本次回复，让真实 `turn/end` 有机会发生；没有人工调用 Stop 或在停止观察时补发 Stop。

用户下一条反馈明确表示：**出现时间时旋钮灯亮起，最近事件变成 Stop 后仍保持常亮。** 这是启动与真实结束事件的人工目视反馈；不能改写成 Stop 后灯已熄灭。程序没有在回复结束后继续采样，因此用户看到的 Stop 与灯态按人工证据记录，没有伪称存在未采集的程序回执。

后续只读检查时设置面板已不在可见 UI 树中，故不能从该次检查读出最后计数；Studio 1 个、原生直连采集器 0，直连 15 文件基线仍未变。没有因面板不可见而重新启动验证。

**本轮边界：真实工具事件自动转发已有程序证据，正常回复结束后的 Stop 和旋钮亮起有人工证据；任务结束灭灯仍未通过。** 这一常亮结果与此前 Studio 对普通状态（含 attention）的相同输出映射相符，但未进行同环境官方 Codex 对照或设备光学测量，不能据此排除其他队列／固件因素。保持官方 `Stop → attention`，不为追求熄灯擅自换成自造事件、idle 或 sleeping；K1、真实审批 K2/K3 和全生命周期仍非本轮验收范围。

### 用户确认后的最终清理

用户选择**卸载临时验证组件**，并确认已从托盘正常退出 Studio。核实 Studio 为 0 个后，通过 DSH 官方插件管理器停用且只卸载 `@abworks/dsh-studio-hook`；确认对话框严格匹配该包名，没有卸载原 AU05 直连插件。异步卸载后在插件列表复核：临时包的“查看”入口与组件控件均不存在，原 `@abworks/dsh-plugin-au05` 包仍可见。设置中的临时 AU05 / Studio 验证入口随组件卸载移除；仓库源码、离线测试和本机忽略目录的复核收据保留，不声称已删除研究资料。

随后正常启动同一已复核的 Studio，CLI pipe 就绪；没有强杀、加启动参数或修改 Agent 同步权限。旧进程退出清掉了第二个窗口的内存队列。原直连 15 文件、原 8 个预设（新增目录／文件 0）与 3 个用户 Hook 配置路径 SHA 基线均复核未变。完成本轮有界验证和清理，不将它称为完整 Studio 协作后端或结束灭灯修复。

## 第十轮：Stop 后常亮与官方行为对照（2026-10-30）

**采集日期**：2026-10-30。**执行后端**：agent-reach 开发路由下的本机官方映射源码、已保存的 Studio 3.4.8 静态片段、独立适配器源码只读复核，以及用户对既往官方 Codex 体验的补充确认。**执行查询数**：网络查询 0；未重新运行官方 Codex、CLI、Studio 状态探针、HID、录音或审批。临时验证组件继续保持已卸载，没有为本轮重装。

### 1. 官方基线纠正了验收预期

用户在“官方 Codex 任务完成后旋钮是什么表现”的对照问题中明确选择：**“任务结束后也一直常亮”**。这是对用户先前实测的补充反馈，不冒充本轮新的程序采样或同环境同步光学对照。

本机官方 `hooks/mappings.js:18–25` 的 Codex 配对确为 **`Stop → attention`**；其 `SessionStart → idle`，而 Codex 表没有 `SessionEnd → sleeping`。部分其他 Agent 的表有 SessionEnd，不能直接移植来假装 Codex 的 Stop 等价于退出会话。独立适配器仍采用同一 Stop 配对，没有伪装 Codex 身份。

因此，第九轮“最近 Stop 后仍常亮”的现象与用户确认的官方体验一致，**不能再单凭不灭灯认定 DSH 适配失败**。第九轮没有取得自动全灭证据的历史事实保留；现在明确“官方行为对齐”与“结束后自动全灭”是两个不同目标。

### 2. 静态证据支持常亮，但不夸大运行时路径归属

对已保存片段的独立复核确认：非 D100N 映射中，attention 与 idle、sleeping、thinking、working 都读取同一常量（RVA `0x63FDE0`）；此前已核对的原始向量为 `(0,0,1)`，不是全零。调用方依次组装 task indices 1、2、3 并传给 SDK 包装器。这与旋钮常亮相容，但本轮没有重新解码常量字节或测量物理索引／固件枚举。

设备分支依赖运行时 `UlanziDeck + 0xA30` 字段是否包含 `D100N`，不能仅凭产品名 AU05 断言已证实进入哪一支。也未证明全程序不存在额外灯态定时器。关键已保存取证文件及行号如下，仅作本机定位，不作为跨平台文档链接依赖：

```text
C:/Users/ASUS/AppData/Local/Temp/au05-official-voice-trace-20261029/studio_cleanup_initial.txt:55–94,547–565,593–611
C:/Users/ASUS/AppData/Local/Temp/au05-official-voice-trace-20261029/studio_cleanup_queue.txt:260–272,304–307,350–354,433–698
C:/Users/ASUS/AppData/Local/Temp/au05-official-voice-trace-20261029/studio_cleanup_mapowners.txt:25265–25429
```

队列函数在所核查路径只新增或更新同会话的状态与时间；notification 检查未依据时间过期，没有找到该路径的 attention 定时全灭或单会话删除契约。**sleeping 不等于删除，而且上述普通映射中 sleeping 也不是全灭**，不能把它当修复指令盲发。

### 3. 发送顺序和证据边界

[观察器](<../packages/dsh-studio-hook/core.js>)只在真实 turn/end 产生一次 Stop，进入终态后拒绝迟到工具结果，直到真实新输入／新回合；[发送器](<../packages/dsh-studio-hook/sender.js>)逐条串行，保持同一不透明 DSH 会话标识，不在 Stop 后补发伪造 idle、SessionStart 或睡眠事件。停止或到期只撤销本机观察与排队发送，不宣称清掉 Studio 会话。

GUI 最近事件在失败回调时也可能更新；**仅看到 Stop 名称不足以证明 CLI 成功，更不是 Studio 或实体灯的确认**。CLI 成功计数、Studio 状态确认、人工灯态观察继续分别记录。本轮源码复核和离线回归不补造上一轮缺失的接收回执，也不声称已经排除了所有运行时队列／固件因素。

### 4. 本轮处理

保留官方 `Stop → attention`、DSH 身份与会话隔离，不改发送或直连行为。只更新报告和当前结论。若后续明确要求“任务结束自动全灭”，应作为可选择的非官方策略另行设计，并先取得受支持的设备／单会话清理契约；不能用重启 Studio、冒用其他 Agent 或猜测 sleeping 来伪装成功。

本轮 63 项独立适配器回归通过、0 跳过，85 项源码／文档检查通过。直连 15 文件及 3 个用户 Hook 配置路径仍与旧基线一致。**预设只读校验发现 1 个原预设文件哈希已不同于旧基线**，没有新增目录／文件；本轮没有预设写入操作，变化来源未归因，不假称当前全部未变，也没有为通过校验覆盖、回滚或重录基线。该差异不作为 Stop 灯态原因证据。

