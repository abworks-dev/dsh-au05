# 完整架构与交互设计

状态：设计契约，除 mock 与只读状态装饰外均未实现。来源和确定性见 [来源台账](sources.md)。

## 组件和职责

| 层 | 输入 | 输出 | 不得承担 |
|---|---|---|---|
| DSH Host bundle | 官方安装/生命周期 | 注册插件包 | 不偷偷打开 HID、改 profile、启 shell |
| DSH client adapter | session scope、公开状态投影、现有审批对象、用户操作 | 最小快照、目标明确的动作结果 | 不用 DOM 文本猜状态、不抢 answerer ownership |
| Controller coordinator | 明确选定会话、可见性、窗口 focus、锁屏信号、独占租约 | 唯一活动控制器、递增 revision、失效撤销 | 不默选后台第一会话、不跨窗口广播批准 |
| loopback bridge | 认证客户端、结构化状态、受控 HID 输入 | 规范化事件、灯请求结果 | 不做权限提升、不暴露原始包/任意命令 |
| Windows HID adapter（计划） | 经用户确认的 vendor collection | 有界 report、原始事件、有限写入 | 不往键盘/consumer collection 发送 vendor 包 |
| AU05 | USB 接收器和 RF 外设 | 按键、旋钮、有限指示 | 不能证明按键者身份或 DSH 任务成功 |

## 生命周期

1. 用户手动启动桥；随机令牌和精确 loopback Origin 白名单，不在 URL 传令牌。
2. 用户在测试 profile 安装插件；插件通过手动配对授权桥，且明确选择 composer 会话。
3. 只有前台可见控制器可获取一份 5 秒租约；每秒心跳，第二客户端拒绝，切换要显式释放/过期后重获。桥不可自行选择浏览器标签页。
4. 插件每秒发布最小快照，或状态变化立即发；快照 2 秒未更新即 unknown，所有待执行动作失效。
5. HID 输入绑定 generation、sequence、租约和收到时的 session/revision。动作在插件里再次读当前公开状态；如果会话、请求 key、焦点发生变化则丢弃，不推迟到新会话重放。
6. 断线、页面隐藏/失焦、锁屏、睡眠、profile 切换、设备更换都撤销控制权。桥单独不能可靠检测浏览器焦点，真实客户端及 OS 适配必须负责这些信号；mock 的 `focused` 只是受信测试输入。
7. 不在重连后恢复旧审批意图。恢复灯效需使用已验证 auto 模式和超时策略，未知固件只展示面板，不尝试猜写入。

## 状态不是互斥的大杂烩

保留基础字段：`running: boolean | undefined`、`pendingInteraction`、`completionUnread`。

显示优先级：失联/过期/未绑定 → unknown；approval → 待审批；其他 pending → 需交互；running true → 执行；running false → idle；其余 unknown。`completionUnread` 只是完成未读标记，不等于空闲，也不能覆盖新出现的审批。

设备逻辑态与物理效果分离：`unknown / idle / running / approval / interaction / complete` → 当前固件已验证的 `auto / solid / breath / off` 子集。没有硬件验收就不启用映射，不承诺任意 RGB、独立四路、亮度、thinking/error 专用命令。面板必须分别显示“期望灯态”和“设备已确认灯态”；写调用成功最多算 requested，不能算人眼已验证 applied。

## 建议按键语义（后续可配置，当前都未接真实设备）

| 操作 | 默认规划 | 安全前提 |
|---|---|---|
| K1 单击 | 聚焦当前 composer；可选调用用户已有语音入口 | 不自动录音、不自动发送；DSH 公开语音 hook 未确认就禁用 |
| K2 单击 | 待审批时允许一次；否则显式启用后才可发送草稿 | 默认关闭审批/发送；只回答现有 answerable approval，禁止永久允许 |
| K3 单击 | 待审批时拒绝；否则取消当前运行 turn | 不清队列；其他 pending 不模拟按 Esc 来糊弄 |
| 旋钮左右 | 当前对话局部滚动 | DOM/公开 slot ref 能定位会话容器后再启用，不滚后台应用 |
| 旋钮按下 | 本插件内的绑定/状态面板 | 不自动切 DSH 会话；会话切换 API 待核实 |
| 长按/双击/按旋组合 | 首版关闭 | vendor 事件与按下/释放经实测后再加入，不能从轮询假造可靠 gesture |

硬件 slot 编号与实时事件索引是两套枚举，方向必须校准。动作注册表不得提供任意 shell、路径执行、JS 字符串或硬件包。

## 审批的二次核对

计划复用现有 UI pending 对象，执行前比较 `sessionId`、`key`、`kind === 'approval'`、`answerable`、租约与 revision、有效期、可见/前台状态；只调用 `answer('allowed-once')` 或 `answer('rejected')`。不新注册独立 answerer，不拦截/替换 DSH 权限所有者。

桥的 `ControlGate` 只演示防错策略，不是安全认证或真实 DSH gate。真实调用的 `RemoteResult` 必须逐项检查，accepted/answered 也不等于工具执行完成。具体 API 见 [插件设计](dsh-plugin.md)。

## 技术选型

- 官方插件采用零构建 JavaScript lazy module，减少打包错误，不向外部开发者假设有发布的私有 SDK。
- mock 用 Node 内置 HTTP、crypto、test；初始零依赖。
- 真实桥优先在诊断分支评估 `node-hid` 的 Windows HIDAPI 接收/输出支持，固定版本、审计原生发布链和 report 长度后才添加。若无法满足可取消 I/O/独占/受控关闭，则独立 Rust/Win32 后端通过同一结构化 IPC 接口替换；目前不做双实现。
- 本地 HTTP + fetch SSE 比原生 EventSource 便于附 Bearer Header。桥与 DSH port 不同，不能把 DSH 自身地址当桥。
- 同用户 ACL named pipe + DSH host 代理可作为后续传输，不能声称官方强制代理；浏览器直连仍需通过 CORS/CSP/HTTPS/local-network 权限实测。
