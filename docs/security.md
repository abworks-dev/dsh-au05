# 安全模型

## 资产与信任边界

保护 DSH 权限请求、会话目标、用户草稿/附件、桥 token 与 AU05 原配置。输入链不可信：RF/USB 设备可能被替换，其他键盘可发相同 shortcut，浏览器可跨站请求，旧标签页可保有连接。同用户恶意进程可能读开发 token；当前原型不抵御已控制本机账户的攻击者。

实体按键只表达意图，不证明批准者身份，不授予沙盒/Host/工具权限。桥不提供 shell、文件执行、原始 HID 包或全局“自动批准”API。

## 已在 mock 实现

- loopback 启动入口；精确 Host 校验，随机 32B Bearer，timingSafeEqual。
- Origin 精确白名单，不接受 `null`/恶意站；无 Origin CLI 仍须 token。默认示例 Origin 不是用户当前 DSH 地址。
- JSON 8KiB 上限，5 秒 header/request timeout，有限 header 数，内部异常不回显栈。
- 单控制租约 5 秒、快照 2 秒有效、单调时钟 TTL，单次 1 秒意图票据；session/key/revision 固定，重复 eventId 拒绝。
- 换 owner 立即关闭旧 SSE；发布前逐个校验 stream 对应 lease；慢客户端背压关闭，不对危险事件断线补发。
- 状态未知/失焦/换会话/替换审批时 fail closed。无真实 HID、无 DSH 控制执行；所有 consume 结果为 `executed: false`。

这些是模型保障，不是已完成的生产级安全认证；输入快照是测试方自报，真实插件必须重新核 DSH 对象。

## 真实接入前必须补齐

- 配对 UI、Windows 当前用户 ACL，token 不写公开配置、不使用 URL query、不持久存浏览器明文；`mode: 0600` 在 Windows 不能充当 ACL 验收。
- 单桥进程和单设备 reader、设备 handle 争用、I/O 取消、有界队列、速率/连接数预算、严格 schema/未知字段拒绝。
- OS 锁屏/睡眠检测，页面 visible/focused 与目标 session 绑定，所有异步任务/dispose 清理，host 与浏览器不同用户场景拒绝。
- 严格验证真实 `PendingApproval` 当前对象与 `answerable`；一次允许/拒绝，不能抢答第三方 owner、不能提供 always/persisted allow。用户先在 UI 启用此能力，默认不开启。
- 硬件变更先备份/确认/读回，不信 VID/PID/序列号为认证。不可自动关闭 Studio、改设备快捷键、改注册表、安装自启动。
- 浏览器 CORS/CSP/HTTPS/local-network 权限逐部署验收；不通过降低浏览器安全设置来“修复连接”。
- 不记录 token、prompt、审批参数、完整 session/request key、设备路径/序列号或全键流。生产诊断限额、脱敏，用户手动导出；原型当前不输出上述内容。

## 安全测试

拒绝错误/缺 token、错误/null Origin、伪 Host/DNS rebinding、body 洪泛/未知命令、旧 lease SSE 获取新票据、重复 input、过期 snapshot、会话切换时释放按钮、请求 replacement、锁屏/断线/重启重放。按键、bridge accepted、DSH accepted 和工具实际完成必须是不同事件。

## 默认运行策略

默认只读插件 + mock bridge。完成 mock 测试不解锁真实驱动；完成硬件诊断不解锁写配置；完成灯控不解锁审批。每一能力要独立、显式、可撤销的 opt-in。未知/过期时 GUI 显示 unknown；硬件恢复 auto 只有在该固件验证可恢复后才启用。无高频闪烁默认值，考虑光敏风险。
