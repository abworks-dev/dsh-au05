# 通用钩子 → Studio（手动启用）

本次只准备适配器和离线测试；未修改 DSH profile/storage、启用规则、运行厂商 CLI、连接 Studio/硬件、安装或重启。钩子管理 RPC 仅允许本地所有者浏览器，必须由用户在界面操作，不通过脚本或模型绕过。

## 填写规则

在当前 DSH 页面「账号菜单 → 设置 → 钩子」操作，先保持全局关闭。在对应事件分组点「添加」，分别建立以下规则（第五条仅在接受审批状态限制后选用）（没有导入功能）：

| 事件 | 名称 | ID（如界面要求） | Studio 状态 |
| --- | --- | --- | --- |
| SessionStart | Studio 会话开始 | studio-session-start | idle |
| UserPromptSubmit | Studio 消息入队 | studio-prompt | thinking |
| PostToolUse | Studio 工具结束 | studio-post-tool | working |
| Stop | Studio 回合空闲 | studio-stop | attention |
| PermissionRequest（可选） | Studio 审批请求通知 | studio-permission | notification |

每条填写相同字段：

- 可执行文件：`C:/Program Files/nodejs/node.exe`
- argv JSON：`["E:/Repository/Github/dsh-au05/scripts/studio-generic-hook.mjs"]`
- 匹配：`*`
- 超时（ms）：`6000`
- 输出上限（字节）：`4096`
- 「向此脚本发送工具参数」：**不勾选**（PostToolUse；其他事件无此选项）。

保存后规则默认关闭，修改后也会关闭。审阅适配器和其导入的 sender/mapping 后，由用户自行开启所需单项及全局开关。规则属于整个 Host，不是当前工作区；会观察所有匹配会话，没有按选中会话跟随或会话筛选。每次触发是独立进程，没有跨进程持久队列；并发事件可能重排，不能保证最终灯阶段。这不是旧 Studio 后端的完整等价替代。不要同时开启旧 Studio 转发路径，否则可能重复发送。仅当用户明确愿意实际调用 Studio 时，在普通测试会话触发事件，再刷新钩子记录；保存本身不试跑。

## 边界

- 不配置 **PreToolUse**：它等待脚本且超时/启动失败会阻断工具，不适合作为通知路径；适配器也拒绝该事件。没有工具开始瞬间状态，只在工具最终结果后发送 working。
- **PermissionRequest 默认建议不配置**：可选规则只能通知审批请求，不能批准/拒绝、不能识别审批结束，也没有可靠清除语义，可能留下过时 notification 状态。请继续在原 DSH 界面审批。
- 最小环境尚未经真实 CLI 验证；若厂商还需要其他用户变量，需人工审阅后明确补充，不能继承整个 Host 环境。
- SessionEnd、SubagentStart、SubagentStop 没有现有 Studio 映射，适配器拒绝；不伪造 Stop 或 idle。
- Stop 是进入 idle 的通知，不证明任务成功，不能否决停止或触发续跑；消息入队也不表示模型已开始生成。
- 输入只投影事件和会话 ID。会话 ID 以稳定 SHA-256 别名发送（不是密钥匿名化，仍可关联），工具名、参数、正文、路径和其他输入字段不转发。
- 使用既有 `packages/dsh-studio-hook/sender.js` 和 `mapping.js`，不是另一套厂商协议。实际可执行文件固定为 `C:/Users/ASUS/AppData/Roaming/Ulanzi/UlanziDeck/ustudio-cli/bin/1.0.24/ustudio-cli.exe`；既有 sender 验证 SHA-256 `7364b7d15b0a7de22faaae950876f5f6bf6372947c3bd9c34f9dc16d67d0797c`，不自动找其他版本或下载。版本/hash 不符需重新人工审阅。
- Hooks 子进程环境为空；适配器明确提供本机 Windows 用户目录和 `C:/Windows`，不读取 Host 密钥/PATH。既有 sender 再构建最小环境及固定 Studio/System32 PATH，以 `shell:false` 和 `--stdin` 调用。stdin 8 KiB/1 秒；厂商进程 3 秒、输出 32 KiB 上限，不保留原始输出。
- CLI 返回 0 **不是实体灯确认**。只记录固定诊断码；其他退出为 1，无审批控制 JSON。脚本不是沙箱，以 Host 用户权限运行；文件变更不会自动重新获取信任。

## 离线验证

```text
node --test test/studio-generic-hook.test.js test/studio-sender.test.js test/studio-hook-mapping.test.js
```

测试通过不等于 Studio/设备或真实 GUI 验收；本任务未进行在线、硬件或目视验证。
