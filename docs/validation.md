# 验证记录与验收

## 本次交付状态（2026-10-27）

范围：官方源码契约核对、原创 mock 原型、目录/链接/许可/敏感信息检查。本地 Windows、Node v24.22.1：`npm test` **13/13 通过**；`npm run check` **31 个源文件检查通过**；`npm run demo` **通过并返回 executed=false**。Node 22 与 Linux 由 CI 待核验。首次测试中的伪 Host 用 fetch 被运行时重写，改成 node:http 真正发送伪造 Header 后确认返回 403；不是跳过安全断言。**从未在真实 DSH 安装/渲染此插件，从未打开 AU05 HID，从未写灯或执行审批。**

API 形状测试使用 VM + 手写 doubles，不代表 React/官方 module loader/真实 DSH GUI 已通过。mock demo 的 `executed: false` 是范围边界，不是硬件驱动失败。

## 自动化覆盖

- 正常/过期租约、第二控制器、focus 丢失、快照过期、session/request replacement。
- 单次 ticket、重放、action 篡改、超时、只允许当前 answerable approval、cancel running 检查。
- HTTP 缺/错误 token、Host/Origin（含 null）、CORS preflight、8KiB body、未公开任意 HID 路由。
- SSE lease 隔离、官方 lazy-module 形状、selector 必填调用、状态优先级、发布包文件。
- 全项目 JSON、UTF-8 replacement 字符、本地 Markdown 链接与基础敏感模式检查；不是完整供应链或密钥扫描。

## 必须人工验收（均未执行）

| Gate | 测试 | 通过证据 |
|---|---|---|
| DSH UI | 测试 profile 安装/刷新/卸载，两个会话状态，未知 running，pending 类型 | DSH 版本/commit、截图、卸载后无残留 |
| 本机通信 | Browser/Electron、当前端口 Origin、CSP/CORS/HTTPS/local-network、token ACL | 环境矩阵及失败路径，不降低浏览器安全设置 |
| 多窗口 | foreground/visible/锁屏、两标签抢租约、旧 SSE、切会话放开按钮 | 旧窗口不获取新事件、不误答新请求 |
| HID 只读 | vendor TLC/caps、按下释放/旋钮/重复包、是否同步键盘事件 | OS/固件/接收器版本，日期化脱敏捕获 |
| 设备可靠性 | 断电/拔插、dongle 在但发射器关、唤醒首键、Studio 冲突/多设备 | 不默认选错设备、不循环写、不重放旧事件 |
| 灯白名单 | off/solid/auto 及恢复、仅经同意写、读回/目视 | requested 与 applied 分离，失败 unknown |
| 快捷键保底 | 注册冲突、F12 拒绝、备份写读回/恢复、其他键盘同弦 | 明确不是设备级来源，无全局键流日志 |
| 审批 opt-in | 现有 PendingApproval、answerable、一次允许/拒绝、过期/换会话/owner | DSH 原权限仍生效，无 always/no-op 假成功 |
| 草稿 | 附件/chips、busy queue/steer、用户异步编辑、局部滚动 | 不全局 Enter，不覆盖新草稿 |
| 发布 | 标准用户、签名/依赖审计、升级回滚、自启动 opt-in、卸载恢复 | 原始配置可恢复，无用户凭据入包 |

## 后续线缆测试清单

标准 TEA KAT、64B 加密仅发 63B、有效参数 <=52B、ID/长度错误、残块不解密、reply-route 差异、nonce/slot/乱序/超时、重连 generation、按钮重复 down/up、1.5 秒内连续相同方向旋钮多刻度。当前没有 encoder/HID，因此这些测试尚不存在，不能把 core 的票据测试当协议覆盖。

## 发布结果

本地/公开仓库 commit、远端可见性与 CI 状态以发布核验为准；不把推送成功写成远端 CI 已通过。这里不记录真实 token/会话标识。
