# 实施路线与退出标准

## M0：设计与安全原型（本次交付）

- 官方格式 Host/client 包、只读 session 状态装饰。
- 原创 mock HTTP/SSE 桥、租约/快照/票据模型、零依赖测试。
- 完整架构、威胁模型、固定版本资料、许可台账、人工验收表、公开仓库。
- **不包括**真实 DSH 安装、HID 连接、灯写入或审批执行。不能称为“AU05 已适配完成”。

## M1：DSH 只读 GUI + 配对

- 独立测试 profile 用官方 manager 安装；验证 session scope、卸载清理。
- 在真实 browser/Electron 接 mock bridge，补 fetch SSE parser、精确 Origin、本机配对/ACL、连接预算和诊断。
- 显示 mock/real 清晰标识；隐藏/失焦/换会话撤销租约，两个标签页不能同时控制。
- 退出标准：人工 GUI 记录 + 跨站/lease/SSE 测试通过；仍不允许实体审批。

## M2：Windows 只读 HID 能力闸门

- 为经许可的实验添加可替换 adapter，先审 `node-hid`/HIDAPI 或选择 Rust Win32 单后端；固定版本和第三方许可。
- 枚举精确 collection/caps，用户确认设备；Studio 退出；不做自动 provisioning。
- 实测 vendor 事件、重复包、旋钮方向、标准键盘同步输出、发射器在线/休眠、固件差异。
- 退出标准：设备/固件/OS 日期化记录；若未观察到就报告该组合不支持，不外推全平台。

## M3：受控动作与有限灯

- 先局部滚动/聚焦等非破坏动作；无可靠公开 UI 接口则禁用，不模拟全局按键。
- 灯 off/solid/auto 单项授权实验，读回或标 requested、人工观察，恢复机制验证后才可状态映射。
- 可选 shortcut fallback：注册无冲突键后备份/写入/读回，单击模式，不假装设备级隔离。
- 退出标准：硬件回归含拔插/睡眠/Studio 争用，原映射可恢复；仍默认不批准。

## M4：可选一次审批与草稿动作

- 用户在 UI 明确启用一次允许/拒绝；复用当前 PendingApproval、二次 freshness 与 target 检查。
- `inputActions.submit()` 的 busy/附件/草稿作用域按官方契约验收；语音仅显式用户入口，不默认采集。
- 退出标准：换会话/替换 request/锁屏/断连/双客户端/重放的负测试均通过；记录 DSH API 基线，不包装成自动放行工具。

## M5：可发布安装包

- Windows 签名与供应链/原生模块审查，标准用户、token ACL、升级回滚、单实例、日志导出、卸载恢复文档。
- CI + 真实 DSH/Windows/AU05 matrix；只对已验固件公布 capabilities。
- npm/GitHub Release 独立发布决定；不因仓库公开就自动发布二进制或接入优篮子市场。

后续优先级：**先 M1/M2 两个事实闸门，再决定驱动和灯控投入**。不能把社区 reverse engineering 的存在等同于现成产品可用。
