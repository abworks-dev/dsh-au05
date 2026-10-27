# DSH 官方插件形状与接入边界

核对基线 `deepseek-ai/deepseek-harness@22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，固定来源见 [台账](sources.md)。本机安装包的虚拟 app.asar 源码路径不能作为已读取源码证据。

## 包与目录

`packages/dsh-plugin/package.json` 声明：

```json
{
  "exports": { ".": "./index.js", "./client": "./client.js", "./icon": "./icon.svg" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-session"]
    }
  }
}
```

Host 入口 `export function apply() {}` 刻意无副作用。Cordis patch 插入 package name，客户端用 `window.__ModuleLoader__.load({ id, factory(require) { return { inject, apply(ctx) {} } } })` 注册 lazy CJS table；不是直接把 ESM 的 `apply` 丢到浏览器，也不加载另一套 React。

客户端在 `conversation.composer.dock` slot 注册只读装饰，注入 `slots` 与 `uiSession`。slot 是 session scope，不能从全局数组拿第一会话。官方 `SnapshotSelectorHook<T>` 的 selector 是必填参数：

```js
const state = props.useSessionStatus(statuses => statuses.get(props.sessionId));
```

状态源 `SessionStatusSnapshot = ReadonlyMap<SessionId, SessionStatus>`，不要把 `running === undefined` 当 false。也可从 `ctx.uiSession.sessionStatus.getSnapshot()` / `subscribe()` 使用公开投影；订阅必须在 dispose 时清理。

## 已核实的调用形状（尚未接入此骨架）

- PendingApproval 的现有 UI 对象含 `sessionId`、`key`、`answerable`，支持 `answer('allowed-once')` / `answer('rejected')`；须取当前对象，不能长期缓存函数/把对象序列化进桥。
- `ISession.cancel(): Promise<RemoteResult<{ accepted: true }>>`：取消当前 turn，**保留队列，恢复后继续 FIFO**，不是“停止全部任务”。
- `ISession.command(line: string): Promise<RemoteResult<{ matched: boolean }>>`：只允许预定义命令，不给硬件传任意命令行；不是系统 shell。
- `ISession.prompt(content: PromptContentPart[], mode: 'queue' | 'steer', signal?: AbortSignal, requestId?: SessionRequestId): Promise<RemoteResult<{ accepted: true }>>`：提交会话输入。不要直接绕过 composer 草稿、附件、busy queue/steer 策略来模拟发送按钮。

草稿公开 slot props 的 `inputActions` 已核实：`captureInsertion(): TokenSpan`、`insertText(text: string, span: TokenSpan): boolean`、`setDraft(text: string): void`、`persistDraft(): void`、`submit(): void`、`insertQuote(text: string): boolean`。显式发送应复用绑定会话的 `submit()` 并验证 busy/附件行为；异步转写先 captureInsertion，再 insertText 并处理 false，不用 setDraft 覆盖后来用户编辑和引用 chips。语音切换、局部滚动、切会话仍需继续核对可靠公开入口；没有就禁用，不改成全局 Enter/Esc。首版只读装饰不调用这些控制方法。

## 安装、调试、卸载

后续在独立测试 profile 使用官方 plugin manager 的 `install_bundle`，`target` 指向插件包绝对目录；npm/GitHub 安装也交给 manager。manager 的 UI/工具路由随 DSH 版本可能变化，安装前先核其可用帮助。不要求使用者手工编辑 profile，也不修改 DSH 自身安装目录。

此交付 **未安装插件、未重启/替换 DSH 服务、未改真实会话或设备**。发布 npm 包需单独决策，当前包名只是声明，不代表 npm 已发布。

验收流程：测试 profile 安装 → 刷新现有 DSH 页面 → 确认 slot 显示 → 两个会话验证 session scope → pending 类型变化 → 插件禁用/卸载确认装饰和订阅都释放。以 plugin manager 的正式移除操作卸载；bridge 原型 Ctrl+C 退出，不改自启动项。仅修改源文件不保证已安装 GUI 自动更新；本仓库没有运行 DSH 自身 `dev:web` watcher。

## 网络边界

已审 `DshClientManifest` 字段为 `platform`, `inject?`, `immediately?`, `external?`，没有额外 network 权限字段；该源码版本页面未见强制 host 网络代理。但不能推导任意部署都准许本机网络。

必须实测浏览器/Electron、HTTP/HTTPS 混合内容、反代 CSP、CORS preflight、本地网络权限。采用 `fetch` 的流式 SSE 解析以附 Authorization，不用 query token 或原生 EventSource。连接失败保持 read-only/unknown，不把安全限制改成禁用 CORS 或任意 Origin。
