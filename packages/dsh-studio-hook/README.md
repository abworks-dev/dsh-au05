# AU05 Studio 协作模式 · 0.6.0-dev.4

> 本包是 AU05 / Studio 硬件协作桥，不是通用脚本钩子管理器。无需硬件的本地自动化请使用独立包 `@abworks/dsh-hooks`，见 [DSH Hooks 文档](https://github.com/abworks-dev/dsh-hooks)。为避免破坏已有绑定，本包不重命名、不迁移配对配置。

正式显式启停的持续会话跟随，加上当前公开审批投影与可选三键动作桥。只有在中文设置中手动开始才转发；加载、打开设置、恢复偏好不启动输入、麦克风或发送 Hook。**代码/离线回归不代表本版实体灯和三键已通过真机验收。**

## 使用

同时通过 DSH 插件管理器安装本包与 `@abworks/dsh-plugin-au05`，启用并刷新现有 GUI。要求 Windows 本机 DSH、PowerShell 7、已安装的官方 Studio/CLI。不打包官方二进制，不改 Codex 配置或安装 AI Hooks。

1. 断开直连，正常打开 Studio。
2. 选择唯一主会话，打开 **设置 → AU05 / Studio → 开始跟随当前会话**。
3. 关闭设置仍运行，没有 120 秒总时限；换会话、绑定变化、卸载或 8 秒租约失效即停止，不自动恢复或重绑。

## 任务与真实审批

公开 Host 事件校验准确的 Session 注册对象、generation、起始游标与工具调用关联。真实用户消息、工具开始/结果、回合结束映射至官方 Hook；保留 `dsh` 身份和随机不透明 wire 标识，不发送用户正文/会话 ID/工具参数。

公开 Client `sessionStatus.pendingInteraction` 仅同会话、`kind=approval`、`answerable=true` 且仍有回答函数时，向 owner-only RPC 提交带单调 revision 与短期 observedAt 的最小投影，同 key 只发一次 `PermissionRequest`。函数和审批内容不跨线，不自动回答，不把 `approval/asked` 当作可回答证据。官方 CLI 固定路径/哈希，串行有界发送、超时、失败不重试；成功计数不是实体灯确认。

停止跟随不伪造 idle/Stop，不删除 Studio 队列。Stop 后旋钮常亮与此前官方 Codex 对照一致。

## 可选三键输入

额外的本项目 Studio 输入插件使用自己的 UUID，官方 3906 WebSocket 只接官方动作回调，另经独立本机短租约能力桥传递有限事件。先手动连接捕获模式，明确读取配对 JSON，放至已安装的自己的服务旁并重启该服务。自己的 add/setactive/输入回调只能发现候选实例 ID，不能授权执行；用户检查最近候选并明确确认之后，才接受新输入。manifest UUID 不等于实例 ActionID；不枚举个人配置或历史、不猜填、不全局改映射。

输入复用伴随控制包的焦点/会话/上下文/代次/时效与单次审批引擎。K1 语音需本次明确启用，K2 允许一次/发送，K3 拒绝/取消；所有动作仍在当前 Client 执行。Host 不回答审批，不回退 HID/全局快捷键。配对三个密钥只经明确 owner-only 读取，不进入普通状态/事件/日志；停止后失效。

**监听桥不等于设备连接或完整动作验收。** 此前 120 秒受控试验已收到 K1/K2/K3/旋钮真实回调，但该轮没有确认绑定以执行 DSH 动作，也没有单独记录左右方向。不能把回调通过扩为全部模式／真实审批专项通过；当前模式不派发就停止，不用保存过绑定补齐证据。

## K1 与依赖边界

Studio 任务接口没有已证实的 K1 控灯入口，因此此页不显示无效灯控开关。伴随直连包在本轮内置语音中有 K1 单轮实体通过，但不是 Studio K1 控制通过；本 Studio 包只作版本配套，功能没有随本轮改变。第三方快捷键请求不等于应用录音。

完整设置、密钥保管与统一验收见 [快速使用](<../../docs/quick-start-dev.md>)；输入生产者见 [插件说明](<../ulanzi-dsh-input/README.md>)；历史硬件证据见 [实测报告](<../../docs/studio-cooperation.md>)。历史参考运行时为 DSH `0.2.1-rc.3`；本次配套直连客户端已通过安装的 `0.2.1-rc.5` 离线 loader／React 夹具，但这不是 Studio 全流程或硬件验证。根目录命令 `npm test`、`npm run check`、`npm run pack:plugins` 不会安装、发布或自动进行硬件测试。
