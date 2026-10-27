# 只读插件：已安装 DSH runtime 的离线兼容验证

## 结果与边界

验证对象为 Windows 本机已安装的 DSH desktop **0.2.1-rc.3**，build commit **`be72761ee1a6736ebcdf4f3739363b083ae53c98`**，其 Web shell 内置 **React 18.3.1**。验证使用真实安装包内的 module loader、Cordis Context、React/ReactDOM、UI renderer 与 SlotRegistry，以及本仓库的 [client.js](../packages/dsh-plugin/client.js)。**13 项断言全部通过；不是只用 API-shape doubles。**

但这是 **installed-runtime / synthetic-session / offline-file fixture**：没有把 AU05 注册到当前真实 GUI，没有验证真实 profile 的安装/卸载、GUI CSP/CORS、HTTP 静态资源路由或热重载。`uiSession` readiness、session scope binding、状态数据源由 fixture 提供，不冒充真实会话服务。真实 GUI 的端到端安装验收仍未完成。

未安装 bundle、未修改 profile/配置、未重启 GUI、未启动替代服务器；未读取真实会话内容或回显 boot 凭据。未使用 HID、灯控、发送、取消、审批或任何控制接口。

## 通过的断言

1. 真实 module loader 可以 import 插件；`/client` 与规范化包名解析到同一 memoized exports。
2. 真实 `slots.inject/register` 注册一个 composer dock preview。
3. `unknown`：无状态数据。
4. `unknown`：`running` 未知，不误报 idle。
5. `idle`：`running === false`。
6. `running`：`running === true`。
7. `approval`：待审批优先于 running。
8. `interaction`：其他待交互。
9. selector hook 真正订阅 root status source。
10. dispose 插件 fiber 后删除 slot registration。
11. dispose 后删除已渲染状态 DOM。
12. dispose 后释放状态订阅。
13. **bundle loader 请求数为 0**。

每次状态切换都把另一个 session 放在 Map 首位，且给它不同状态，确认读取 slot 绑定的 session，而不是第一个或隐式当前会话。显示始终为 `AU05 preview · <status> · HID off`。

“0 请求”仅指 fixture 自己计数的 bundle loader，不是对整个 Edge 进程背景联网的抓包结论。fixture 直接禁用 `fetch` 和 `WebSocket`；浏览器使用 `--disable-background-networking`，但这不等于证明操作系统层面绝对无网络。

## 复现

实现：[verify-plugin.mjs](../scripts/verify-plugin.mjs)。无须新 npm 依赖；需要现有 DSH desktop Electron 和系统 Microsoft Edge。

先在仓库根目录用 **DSH 自带的 Electron executable** 运行提取和验证。普通 Node 不会读取 Electron 的虚拟 asar 文件系统。PowerShell 示例：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& "$env:LOCALAPPDATA/Programs/DeepSeek Harness/DeepSeek Harness.exe" scripts/verify-plugin.mjs --verify
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

若 executable 名称/安装位置不同，替换为实际安装的 Electron executable。`--verify [app.asar] [msedge.exe]` 支持显式覆盖；默认 asar 路径由 `LOCALAPPDATA` 或 home 推导，不含硬编码用户名。

已提取的临时目录可用普通 Node 重跑：

```text
node scripts/verify-plugin.mjs --browser <extracted-runtime-directory> [msedge.exe]
```

或显式启用 [plugin-runtime.test.js](../test/plugin-runtime.test.js)：

```powershell
$env:AU05_DSH_RUNTIME_DIR = '<extracted-runtime-directory>'
node --test test/plugin.test.js test/plugin-runtime.test.js
Remove-Item Env:AU05_DSH_RUNTIME_DIR
```

默认测试没有该环境变量时明确 skip 真实 runtime fixture，不把缺少环境误记为通过。普通 unit tests 仍运行。

提取的安装静态资源、fixture HTML、browser result、脱敏 JSON 结果及 Edge 临时 profile 只保存在系统临时目录，不加入仓库。`verification-result.json` 记录版本、commit、React、13 项断言和错误；`liveGuiInstalled` 明确为 `false`。脚本使用临时 Edge profile，不修改用户已有浏览器 profile。`--allow-file-access-from-files` 仅用于该离线 file fixture，不能推导真实 GUI CSP/CORS 兼容。安装版本改变后若 Web shell 切分标记不同，脚本会拒绝运行，而非猜测执行整个应用 boot。

## 官方加载与卸载的事实边界

已静态检查安装版官方 plugin manager。官方工具名为 `plugin_manager`，动作包括 `install_bundle`、bundle enablement 和 remove；当前代理暴露的工具集没有该官方工具，不能用猜测的内部 HTTP 请求代替它。

`install_bundle` 不是只读验证：它在当前 profile 执行包管理操作，会写 `package.json`、lockfile、bundle selection，并可能触发 reload。即使安装参数禁止启用，包安装本身仍写 profile。禁用/移除也涉及 profile 状态；缺少 HMR 时移除活动 bundle 可能要求 stop-profile。命令行插件管理使用 `dsh plugin --profile <name> …`，省略 profile 不代表安全的零写入 dry-run。

因此本轮不调用这些操作。后续如需真实 GUI 验收，应单独确认测试 profile、官方 manager 可用入口和恢复方案，再验证安装、显示、禁用/移除；不能把本报告的 fiber disposal 断言表述成真实 profile 已成功卸载。
