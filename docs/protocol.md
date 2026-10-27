# 本机桥协议 v1（开发原型）

本协议与 AU05 线缆协议完全不同。代码已实现 mock 路由；浏览器消费端、真实硬件适配、生产配对尚未实现。

## 传输与认证

仅 `127.0.0.1` HTTP；原型端口默认 17375，可配置。每启动 32 随机字节 hex token，所有非 OPTIONS 请求需 `Authorization: Bearer <token>`。Host 精确匹配本机端口，浏览器 Origin 精确 allowlist，不含通配、不接受 `null`；无 Origin 的 CLI 仍需 token。CORS 不是身份认证；同用户恶意进程可窃取开发 token，原型不宣称隔离它。

`POST` 必须 `Content-Type: application/json`，请求体最多 8192 字节；无路径参数执行、任意 HID 或 raw packet endpoint。token 不进 URL、日志、会话内容或 Git。HTTP loopback 不是跨网加密通道，禁止转发给公网。

## 路由（当前代码）

| 方法/路径 | 数据/结果 |
|---|---|
| GET `/v1/health` | protocol=1, mode=mock, hardware=false, status；仍需 token |
| POST `/v1/lease` | `{owner}` → 随机 id、until；仍有效时其他 owner 返回 409 |
| POST `/v1/heartbeat` | `X-AU05-Lease` 延长 5 秒 |
| POST `/v1/release` | 撤销租约，终止 stream，清快照/待执行票据 |
| POST `/v1/snapshot` | 最小状态快照，revision 必须严格递增 |
| GET `/v1/events` | 带租约与 Bearer 的 SSE；目前仅一个 stream |
| POST `/v1/mock/input` | `{eventId,action}` → 临时 ticket，同时向 SSE 推送 |
| POST `/v1/mock/consume` | `{ticket}` → 模拟 intent，**executed=false** |

mock 路由不是生产命令端口。将来生产构建必须删除 `/mock/*`，事件只能来自已确认硬件 adapter；客户端本来持有 token，不能把这些路由当验证真人按键的安全边界。

## 快照和意图

```json
{
  "sessionId": "opaque-session",
  "revision": 1,
  "focused": true,
  "running": true,
  "completionUnread": false,
  "pending": {"kind": "approval", "key": "opaque-request", "answerable": true}
}
```

`running` 允许省略表示 unknown；`pending` 必须显式为 null 或以上结构。不传 transcript、工具参数、文件路径、完整序列号、凭据。request key 不可当日志调试内容，生产应只保留内存。

租约 until 与票据 expiresAt 基于桥进程单调时钟，不是 Unix 时间；客户端不能直接与 Date.now 比较，重启后全部作废。票据含随机 id、leaseId、sessionId、revision、requestKey、action、expiresAt。有效期 1 秒、消费一次、字段必须与服务器原对象一致；每次快照更新即撤销所有旧票据。4096 个 eventId 达到预算后 fail-closed，重获租约，不淘汰旧 ID 后接受重复动作。当前策略保守：快照更新即使同一会话也可能丢一次操作，优先防错而非偷偷重试。

允许动作只有 `allow_once / reject / cancel / scroll_up / scroll_down`，目前只是模拟。`allow_once/reject` 必须 approval 且 answerable，cancel 必须 running=true。真实插件仍需读取 DSH 的实时对象二次验证，不信桥给出的“可以批准”。状态更新/租约变更和 HID generation 在生产实现中需串行化。

## 事件、错误与断线

SSE `event: input` 的 data 是 ticket，id 单调递增；每秒注释心跳，连接背压关闭慢客户端。原型不支持 Last-Event-ID 重放；生产也不得重放危险事件。租约到期关闭 stream。

错误：401 unauthorized；403 invalid_host/invalid_origin；409 controller_busy/lease_expired/stale_snapshot/not_focused/not_answerable/duplicate_event/stale_revision/invalid_ticket；413 body_too_large；415 json_required；404 not_found。内部异常仅返回 internal_error，不返回栈和请求内容。

生产待补：连接数/请求速率限额、严格 schema 拒绝未知字段、SSE parser 的分包/UTF-8/大小限制、配对 UI、Windows ACL、桥进程单实例/设备互斥、锁屏/休眠撤销、端口发现与版本协商。网络健康不等于设备健康，dongle 存在不代表发射器在线。
