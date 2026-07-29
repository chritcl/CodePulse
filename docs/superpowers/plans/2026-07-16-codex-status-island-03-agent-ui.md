# 阶段三：Codex 灵动岛 UI

## 目标

让 Widget 和主窗口消费阶段二的权威快照，在现有多岛机制中展示 Codex 任务。

本阶段不新增状态机、不直接请求 Hook 配置文件，也不在 IslandView.vue 中堆叠聚合逻辑。

## 建议文件

- src/modules/codex/display.ts：快照到岛展示模型的纯映射；
- src/composables/useCodexStatus.ts：命令拉取、事件订阅和卸载清理；
- src/components/island/AgentContent.vue：紧凑态、列表和详情展示；
- src/components/island/IslandDisplayController.vue：接入既有 agent 分支；
- src/components/dashboard/CodexStatusCard.vue：主窗口的只读状态摘要；
- src/modules/island/display.ts：只补充既有 agent 布局所需尺寸和优先级；

文件名可按现有组件命名调整，但状态映射、订阅逻辑和视图应保持分离。

## 任务 1：建立前端状态接入

定义与 Rust 对应的 TypeScript 契约。composable 在挂载时获取一次完整快照并订阅更新，在卸载时释放监听器。

处理竞态时只接受 revision 不小于当前值的快照。订阅失败时显示未运行或服务异常，不让旧任务继续停留在界面。

## 任务 2：实现岛内容

紧凑态展示代表任务，展开态展示活动任务列表。任务详情显示最小安全字段，并提供清除失败任务的入口。

等待授权、失败、完成和普通运行的视觉状态复用现有岛壳、主岛优先级和卫星岛规则。不要再建立 Codex 专用窗口调度器。

## 任务 3：接入主窗口和显示偏好

主窗口显示安装和监听的只读摘要。空闲常驻、显示脱敏命令摘要等普通显示偏好沿用现有设置存储与跨窗口同步方式。

显示偏好只影响渲染，不能启动服务、停止服务或写入 Codex 配置。

## 测试重点

- 初始快照、后续更新和旧 revision 忽略；
- 组件卸载后监听器释放；
- 紧凑态、列表、详情和返回；
- 等待授权强打断、失败清除、完成保留和空闲隐藏；
- 展开时状态更新不破坏现有多岛布局。

## 阶段完成门槛

- 通过模拟快照可完整演示岛内容；
- Widget 与主窗口都能接收同一 Rust 状态；
- 不修改现有音乐、通知、硬件或网络模块的业务逻辑；
- 相邻 Vitest 组件与纯逻辑测试通过。
