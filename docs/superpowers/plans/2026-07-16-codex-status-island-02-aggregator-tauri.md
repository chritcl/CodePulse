# 阶段二：内存聚合器与 Tauri 状态

## 目标

把阶段一的安全事件转换为 CodePulse 进程内的最新任务快照，并通过 Tauri 命令和事件提供给两个窗口。

本阶段只维护内存状态。应用退出后状态自然清空，不引入持久化任务历史或跨进程状态恢复。

## 建议文件

- src-tauri/src/codex/aggregator.rs：会话状态、优先级和快照生成；
- src-tauri/src/codex/runtime.rs：接收器、聚合器任务和取消路径；
- src-tauri/src/commands/codex_commands.rs：获取快照、清除失败任务；
- src-tauri/src/lib.rs：状态装配、命令注册和退出清理；
- src/shared/ipc/contracts.ts：Codex 快照与事件契约；
- src/shared/ipc/events.ts：Codex 快照事件名；
- src/shared/ipc/commands.ts：前端命令封装；

## 任务 1：定义公开快照

公开快照只包含页面渲染需要的数据：

- revision 与生成时间；
- 任务列表和代表任务；
- 状态、来源、项目名、脱敏摘要和最近活动时间；
- 等待授权或失败等展示提示。

revision 在当前进程内递增。每次状态实际变化后增加 revision 并广播完整快照。无需持久化 revision，也无需建立独立的全局状态存储框架。

## 任务 2：实现最小聚合规则

聚合器使用 sessionId 管理任务卡片，并维护有界 eventId 缓存来忽略同一传输事件的重复到达。

首版规则：

- SessionStarted 创建或更新会话；
- TurnStarted 重置当前轮次的完成或失败状态；
- ToolStarted 和 ToolFinished 更新阶段与安全摘要；
- PermissionRequested 进入 waiting_approval 并产生一次强提示；
- TurnStopped 根据结果进入 completed、failed 或 interrupted；
- 完成任务短暂保留，失败任务等待用户清除；
- 长时间无活动的运行任务转为 interrupted。

不尝试依据正文、时间窗口或多配置层猜测两个不同 eventId 是否相同。不能可靠合并时，优先保留最新安全状态。

## 任务 3：实现运行时生命周期

应用运行时持有一个接收器任务和一个聚合器任务。停止时先停止接收新事件，再取消任务、清空快照并广播空状态。

旧任务在取消后晚到的事件必须被忽略。可以用简单的取消令牌或运行时编号实现，不需要引入通用 Runtime Manager、跨进程 generation 或持久化恢复机制。

测试覆盖启动、停止、重启、停止后请求和快照清空。

## 任务 4：公开 Tauri 接口

新增获取当前快照、清除指定失败任务和接收快照事件的接口。两个窗口各自维护本地显示状态，但都以 Rust 的完整快照为准。

IPC 类型、命令封装、Rust 命令注册和相邻测试必须同步更新。

## 阶段完成门槛

- 直接注入阶段一事件可得到预期快照；
- 重复 eventId 不重复改变状态；
- 等待授权、完成、最终失败、超时和手动清除均有测试；
- 停止或重启后旧事件不会恢复旧任务；
- Tauri 命令和事件契约可被前端调用。
