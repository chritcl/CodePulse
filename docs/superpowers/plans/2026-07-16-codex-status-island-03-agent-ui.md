# 阶段三：Vue Agent 状态岛与现有多岛调度集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 用阶段二的权威快照替换 Agent 占位内容，实现紧凑态、多会话列表、任务详情和清除操作，并与现有主岛展开、卫星岛切换、手动焦点和一秒自动收缩完整共存。

**架构：** IPC 契约集中在 `src/shared/ipc`；`src/modules/codex` 负责纯展示映射和进程级 revision 规则；`useCodexAgent` 负责从 SnapshotStore 初始化（包括 Runtime dormant 的合法空快照）、Tauri 监听与卸载清理；Codex 组件只渲染/导航；`IslandView.vue` 只初始化 composable、加入一个 `IslandModuleSnapshot` 并传 props/events，不承载聚合、超时、Runtime 重启或失败判断。

**技术栈：** Vue 3 Composition API、TypeScript、Tauri JS API、现有事件监听器注册表、Vitest、`@vue/test-utils`；不新增前端依赖。

**前置条件：** 阶段二完成门禁全部通过，Rust 端事件、命令和 DTO 已固定。阶段四尚未实现真实 Hook 设置，因此本阶段可用 mocked Tauri IPC 独立验收。

**本阶段消费：** `CodexStateSnapshot`、`CodexListeningStatus`、`CodexSoftInterruptPayload`、五个阶段二命令和三个事件。

**本阶段产生：** 一个 `agent` 类型的 `IslandModuleSnapshot`、Codex 内容组件和详情导航；阶段四只需提供设置值与配置状态，不得改变 UI 的状态所有权。

---

## 任务 1：添加 TypeScript IPC 契约、命令封装和事件常量

**独立交付物：** Vue 侧所有 wire 类型与 Rust camelCase JSON 一一对应；组件不直接拼接命令或事件字符串。

**Files:**

- Modify: `src/shared/ipc/contracts.ts`（文件末尾新增 Codex 契约区域）
- Modify: `src/shared/ipc/events.ts`（统一事件常量对象/导出区域）
- Modify: `src/shared/ipc/commands.ts`（命令封装导出区域）
- Modify: `src/shared/ipc/index.ts`（在现有显式清单中导出 Codex 类型、事件和命令封装）
- Modify: `src/shared/ipc/commands.test.ts`
- Create: `src/shared/ipc/codexContracts.test.ts`

**消费接口：** 总体路线图 3.3/3.4 和阶段二 serde 输出。

**产生接口：**

```ts
export type CodexSource = 'cli' | 'app' | 'unknown'
export type CodexTaskStage =
  | 'analyzing' | 'reading' | 'editing' | 'running_command' | 'running_tests'
  | 'waiting_approval' | 'completed' | 'failed' | 'interrupted'
export type CodexOperationResult = 'success' | 'failed' | 'unknown'
export type CodexAttentionReason =
  | 'waiting_approval' | 'failed' | 'completed' | 'interrupted'

export interface CodexTaskState {
  sessionId: string
  turnId?: string
  source: CodexSource
  projectName: string
  taskSummary: string
  stage: CodexTaskStage
  operationSummary?: string
  latestOutput?: string
  errorSummary?: string
  lastOperationResult: CodexOperationResult
  hasUnresolvedIssue: boolean
  activeSubagentCount: number
  startedAt: number
  lastActivityAt: number
  completedAt?: number
  acknowledged: boolean
}

export interface CodexAttention {
  id: number
  level: 'strong' | 'soft'
  reason: CodexAttentionReason
  sessionId: string
  expiresAt?: number
}

export interface CodexStateSnapshot {
  version: 1
  revision: number
  generatedAt: number
  tasks: CodexTaskState[]
  representativeSessionId?: string
  attention?: CodexAttention
}

export interface CodexListeningStatus {
  serviceState: 'stopped' | 'starting' | 'listening' | 'error'
  hookState:
    | 'unknown' | 'not_installed' | 'awaiting_trust' | 'active'
    | 'partial' | 'conflict' | 'disabled'
  phase:
    | 'disabled' | 'not_installed' | 'awaiting_trust' | 'running'
    | 'partial' | 'config_conflict' | 'service_error'
  port?: number
  usingFallbackPort: boolean
  lastEventAt?: number
  sources: CodexSource[]
  errorCode?: string
}

export interface CodexSoftInterruptPayload {
  attentionId: number
  sessionId: string
  reason: 'completed' | 'interrupted'
  expiresAt: number
  revision: number
}

export type CodexSelfCheckCode =
  | 'service_listening' | 'discovery_matches_runtime' | 'event_queue_open'
  | 'bridge_resource_present' | 'bridge_installed' | 'hook_config_valid'

export interface CodexSelfCheckItem {
  code: CodexSelfCheckCode
  status: 'pass' | 'warning' | 'fail'
  message: string
}

export interface CodexSelfCheckResult {
  ok: boolean
  checkedAt: number
  checks: CodexSelfCheckItem[]
}
```

命令封装固定为 `getCodexSnapshot()`、`clearCodexTask(sessionId)`、`clearAllCodexFailures()`、`getCodexListeningStatus()`、`runCodexSelfCheck()`。事件常量值固定为 `codex-state-changed`、`codex-soft-interrupt`、`codex-listening-status-changed`。

- [ ] **步骤 1：先写命令与事件失败测试**

  在现有 `commands.test.ts` 断言五个 wrapper 调用正确的 snake_case Tauri 命令；`clearCodexTask('session-1')` 参数必须是 `{ sessionId: 'session-1' }`，由 Tauri 自动映射 Rust 参数。断言 wrapper 返回 typed payload，不吞异常。

  `codexContracts.test.ts` 断言三个事件字符串精确值，并用 `satisfies CodexStateSnapshot` 固定完整样本；再断言 JSON 样本不含 `cwd`、token、eventId 或原始工具字段。

  运行：

  ```powershell
  pnpm run test -- src/shared/ipc/commands.test.ts src/shared/ipc/codexContracts.test.ts
  ```

  预期：新类型、wrapper 和事件常量不存在，测试/类型编译失败。

- [ ] **步骤 2：实现最小契约和封装**

  类型不使用 `any`；`version` 固定为字面量 `1`；时间统一 number/Unix 毫秒。self-check code union包含阶段二定义的六个值，避免阶段四另建类型。保持现有 IPC 文件的命名和 export 风格，不移动音乐或设置契约。

  运行：

  ```powershell
  pnpm run test -- src/shared/ipc/commands.test.ts src/shared/ipc/codexContracts.test.ts
  pnpm run typecheck
  ```

  预期：IPC 测试和全项目类型检查通过；现有命令 mock 调用次数未被改变。

- [ ] **步骤 3：格式、审查和提交**

  运行：

  ```powershell
  pnpm run lint
  pnpm run format:check
  rg -n "codex-state-changed|codex-soft-interrupt|codex-listening-status-changed" src
  git diff --check
  ```

  预期：三个原始事件值只在集中常量和测试快照出现；组件尚未引用字符串。

  建议提交信息：

  ```text
  添加 Codex 状态岛前端 IPC 契约
  ```

---

## 任务 2：实现纯展示映射与权威快照 composable

**独立交付物：** mocked IPC 下可从 dormant 空快照初始化、接收跨 Runtime 的更高 revision 快照、忽略真正旧 revision、在卸载空快照到达时清除旧任务、映射 Agent 模块、清除任务并在 scope 销毁时释放全部监听器。

**Files:**

- Create: `src/modules/codex/types.ts`
- Create: `src/modules/codex/status.ts`
- Create: `src/modules/codex/presentation.ts`
- Create: `src/modules/codex/status.test.ts`
- Create: `src/modules/codex/presentation.test.ts`
- Create: `src/modules/codex/useCodexAgent.ts`
- Create: `src/modules/codex/useCodexAgent.test.ts`

**消费接口：** 任务 1 的 IPC types/wrappers/events；`IslandModuleSnapshot`；`registerEventListener()` 或当前 `eventListenerRegistry` 对应 API。

**产生接口：**

```ts
export interface UseCodexAgentOptions {
  idlePersistent: MaybeRef<boolean>
}

export interface CodexAgentDisplayState {
  snapshot: CodexStateSnapshot
  listeningStatus: CodexListeningStatus
  representativeTask?: CodexTaskState
  agentModuleSnapshot: IslandModuleSnapshot
  idlePersistent: boolean
  now: number
}

export function applyCodexSnapshot(
  current: CodexStateSnapshot,
  incoming: CodexStateSnapshot
): CodexStateSnapshot

export function toAgentModuleSnapshot(
  snapshot: CodexStateSnapshot,
  listeningStatus: CodexListeningStatus,
  idlePersistent: boolean
): IslandModuleSnapshot

export function useCodexAgent(options: UseCodexAgentOptions): {
  snapshot: Readonly<Ref<CodexStateSnapshot>>
  listeningStatus: Readonly<Ref<CodexListeningStatus>>
  representativeTask: ComputedRef<CodexTaskState | undefined>
  agentModuleSnapshot: ComputedRef<IslandModuleSnapshot>
  clearTask: (sessionId: string) => Promise<void>
  clearAllFailures: () => Promise<void>
  refresh: () => Promise<void>
}
```

`types.ts` 只 re-export IPC Codex types 并定义纯 UI state，不能复制结构。`presentation.ts` 产生阶段中文标签、来源标签、相对时间与紧凑摘要；不得重新判定失败或超时。

- [ ] **步骤 1：先写状态投影失败测试**

  `status.test.ts` 覆盖：

  - revision 小于或等于当前值时保持当前对象；更大 revision 替换；错误 version 保持当前并返回可诊断错误；
  - 当前 revision=20 且有旧任务时收到 revision=21 空快照，必须接受并清空 tasks/representative/attention；随后 listeningStatus.phase=not_installed 时 Agent 隐藏；
  - Runtime 重启不会触发前端 revision 归零或重新创建 comparison state；revision=22 的新 Runtime 任务在 revision=21 空快照后正常接受；
  - 有真实任务时始终按代表任务投影，优先于所有无任务监听状态；
  - 无任务、phase=running、idlePersistent=false => `active=false`；true => paused/“Codex 已就绪”；
  - 无任务、phase=awaiting_trust => warning/“等待 Codex 信任”且 interrupt=none，不受 idlePersistent 影响；
  - 无任务、phase=partial => warning/“Codex 部分可用”，interrupt=none；
  - 无任务、phase=service_error => error/“Codex 服务异常”，interrupt=none；
  - 无任务、phase=config_conflict => warning/“Codex 配置冲突”，interrupt=none；
  - 无任务、phase=not_installed 或 disabled => `active=false`，即使 idlePersistent=true 也不能显示“Codex 已就绪”；
  - analyzing/reading/editing/running_command/running_tests => running/none；
  - waiting_approval 任务 => warning；快照 attention 为同 session 的 waiting_approval 时 strong，直到更高 revision 快照移除该 attention；
  - failed 任务始终 => error；只有快照 attention 为同 session 的 failed 时 strong，下一份无该 attention 的权威快照 => none；
  - completed 任务始终 => success；只有同 session 的 completed attention 时 soft；interrupted 同理为 warning/可选 soft；
  - 投影函数不比较 `expiresAt` 或 `Date.now()`，即使测试传入已过去的 expiresAt，也必须等待后端更高 revision 移除 attention；
  - `unreadCount = tasks.length`，label 来自后端代表任务阶段，代表 ID 缺失时安全回退 tasks[0]；
  - 投影是纯函数，不调用任何 Tauri runtime start/stop 命令；切换 idlePersistent 只重算 running+无任务的可见性。

  运行：

  ```powershell
  pnpm run test -- src/modules/codex/status.test.ts
  ```

  预期：模块不存在，测试失败。

- [ ] **步骤 2：先写展示纯函数失败测试**

  `presentation.test.ts` 覆盖九个阶段中文名、CLI/App/unknown 来源、0/59 秒/1/59 分钟/1 小时相对时间、空摘要降级、多个任务“3 个任务执行中”、两个子智能体“2 个子任务”。任何展示字符串都只消费已脱敏字段。

  运行：

  ```powershell
  pnpm run test -- src/modules/codex/presentation.test.ts
  ```

  预期：纯展示函数不存在，测试失败。

- [ ] **步骤 3：先写 composable 异步竞态和清理失败测试**

  测试顺序固定为“先注册三个 listener，再调用初始 get”。覆盖：未安装 Hook/Runtime dormant 时 `getCodexSnapshot()` 成功返回 revision=0、tasks=[]，composable 不设置 service_error且按 not_installed 隐藏；初始化 invoke 尚未返回时收到 revision 5，随后旧 revision 3 的 get 结果不能覆盖；事件 revision 倒退被忽略；监听状态事件完整替换并立即驱动同一个 `toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)`；任务与监听状态初始化请求任意顺序返回都不覆盖事件新值；soft interrupt 不单独伪造任务状态；clear 命令返回的新快照立即应用；clear 失败保留旧快照并 reject；idlePersistent 变化不会 invoke runtime 命令；scope dispose 调用三个 unlisten；dispose 后迟到 invoke 不回写。

  增加完整重启序列：Runtime A revision=20 有任务 → uninstall/stop 事件 revision=21 空快照 → listening not_installed → 任务与 Agent 立即消失 → Runtime B 新事件 revision=22 → 正常显示，不被旧 comparison state 拒绝。测试必须断言 composable 没有在 not_installed、disabled、service restart 或 refresh 时把本地 revision 重置为 0。

  运行：

  ```powershell
  pnpm run test -- src/modules/codex/useCodexAgent.test.ts
  ```

  预期：composable 不存在，测试失败。

- [ ] **步骤 4：实现纯投影与事件生命周期**

  `applyCodexSnapshot` 以 version/进程级 revision 为唯一新旧依据；更高 revision 的空快照与任务快照完全等价地接受，前端不根据 Runtime start/stop 重置 revision，也不根据本机时间删除任务或过期 attention。`toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)` 先判断是否有真实任务；有任务时只按后端代表任务和 attention 投影；无任务时严格使用本任务表格，`idlePersistent` 只影响 running。attention 缺失时已完成/失败/中断任务仍保留视觉 status，但 interrupt 必须为 none。`useCodexAgent` 的 request generation 仅隔离前端异步请求，不得和后端 runtimeGeneration 混用；采用项目已有事件监听器注册表，`onScopeDispose` 清理 listener，不新增全局 singleton。

  soft interrupt listener 只触发一个递增的内部 pulse 或立即刷新本地 `now`，确保布局重算；若对应完整快照尚未到达，仍不自行创建 attention。只有 invoke 真正失败才使用本地合法空快照和 service_error 降级；dormant/not_installed/disabled/config conflict 返回的成功空快照不是错误，不能触发 service_error。`CodexAgentDisplayState` 直接携带同一份 listeningStatus、纯投影结果和当前 idlePersistent 值，组件不得另取或另推监听状态。

  运行：

  ```powershell
  pnpm run test -- src/modules/codex/status.test.ts src/modules/codex/presentation.test.ts src/modules/codex/useCodexAgent.test.ts
  pnpm run typecheck
  ```

  预期：投影、格式、竞态、错误和清理测试全部通过。

- [ ] **步骤 5：提交**

  运行：

  ```powershell
  pnpm run lint
  pnpm run format:check
  rg -n "setTimeout|setInterval|failed|interrupted" src/modules/codex/useCodexAgent.ts
  git diff --check
  ```

  预期：composable 中没有任务生命周期定时器或失败判定；仅允许监听清理和错误状态处理。

  建议提交信息：

  ```text
  实现 Codex 权威快照前端运行时
  ```

---

## 任务 3：实现紧凑态、任务列表、详情导航和清除交互

**独立交付物：** 五个设计组件和一个轻量编排组件可独立挂载；列表/详情导航不依赖 `IslandView.vue`，失败/中断可清除，授权态没有允许/拒绝操作。

**Files:**

- Create: `src/components/island/codex/CodexStatusIcon.vue`
- Create: `src/components/island/codex/CodexCompactContent.vue`
- Create: `src/components/island/codex/CodexTaskItem.vue`
- Create: `src/components/island/codex/CodexTaskList.vue`
- Create: `src/components/island/codex/CodexTaskDetail.vue`
- Create: `src/components/island/codex/CodexAgentContent.vue`
- Create: `src/components/island/codex/CodexCompactContent.test.ts`
- Create: `src/components/island/codex/CodexTaskList.test.ts`
- Create: `src/components/island/codex/CodexTaskDetail.test.ts`
- Create: `src/components/island/codex/CodexAgentContent.test.ts`

**消费接口：** `CodexAgentDisplayState` 与 `presentation.ts`；组件不调用 Tauri。

**产生接口：**

```ts
// Codex Agent 内容组件
defineProps<{
  mode: 'compact' | 'detail'
  state: CodexAgentDisplayState
  clearPendingSessionId?: string
}>()

defineEmits<{
  'clear-task': [sessionId: string]
}>()
```

`CodexTaskList` 发 `select-task(sessionId)`；`CodexTaskDetail` 发 `back` 与 `clear-task(sessionId)`。选中 sessionId 只存在于 `CodexAgentContent` 的 detail 实例中。

- [ ] **步骤 1：先写紧凑态和图标失败测试**

  覆盖设计示例：等待授权+CodePulse、执行失败+操作摘要、已完成+任务摘要、运行测试+多任务数量、空闲常驻“Codex 已就绪”、子任务数量、长文本省略。阶段通过文字和非颜色图标同时表达；图标组件带 `aria-label`，不使用外部图片。

  运行：

  ```powershell
  pnpm run test -- src/components/island/codex/CodexCompactContent.test.ts
  ```

  预期：组件不存在，测试失败。

- [ ] **步骤 2：先写列表与详情失败测试**

  列表测试：按快照顺序渲染项目、任务、阶段、来源、相对时间；每个 session 一项；点击只发 sessionId。详情测试：显示项目、任务、状态、当前操作、最新输出/错误、来源、最后活动和子任务数；只有 failed/interrupted 出现“清除记录”；waiting_approval 不出现“允许”“拒绝”；所有阶段都不出现打开 Codex、暂停、终止或继续按钮。

  运行：

  ```powershell
  pnpm run test -- src/components/island/codex/CodexTaskList.test.ts src/components/island/codex/CodexTaskDetail.test.ts
  ```

  预期：组件不存在，测试失败。

- [ ] **步骤 3：先写导航与实时更新失败测试**

  `CodexAgentContent.test.ts` 覆盖：detail 初始为列表；点击项进入详情；返回回列表；同 session 新 snapshot 更新当前详情但不跳到新代表任务；选中任务从快照消失时自动回列表；clear 点击只向上传递一次；pending 时禁用重复清除；组件卸载/重新挂载后回到列表。compact 模式不创建选择状态。

  运行：

  ```powershell
  pnpm run test -- src/components/island/codex/CodexAgentContent.test.ts
  ```

  预期：导航编排不存在，测试失败。

- [ ] **步骤 4：实现展示组件**

  使用 `<script setup lang="ts">`、`defineProps`、`defineEmits`。详情 watcher 只检查选中 ID 是否仍存在；代表任务变化不重置选择。所有按钮使用 `type="button"`、`@click.stop` 和可访问名称。样式与组件同目录，使用 scoped CSS；列表区域固定可滚动且不会撑破阶段三定义的详情高度。

  不在组件中推导超时、删除完成任务、判断 Stop、计算 attention 或调用 Tauri。错误/中断清除只发事件；上层 composable 负责命令与快照回写。

  运行：

  ```powershell
  pnpm run test -- src/components/island/codex
  pnpm run typecheck
  ```

  预期：Codex 组件测试全部通过，类型无隐式 any。

- [ ] **步骤 5：提交**

  运行：

  ```powershell
  pnpm run lint
  pnpm run format:check
  rg -n "允许|拒绝|打开 Codex|暂停|终止|继续" src/components/island/codex
  git diff --check
  ```

  预期：禁用功能只允许出现在负向测试断言，不出现在生产模板。

  建议提交信息：

  ```text
  构建 Codex 状态列表与任务详情组件
  ```

---

## 任务 4：替换 Agent 占位分支并验证通用多岛布局

**独立交付物：** `IslandDisplayController` 可渲染真实 Codex compact/detail；通用布局为 Agent 提供 420×280 详情区，并保持强打断、手动焦点、软打断、卫星排序和展开安全规则。

**Files:**

- Modify: `src/components/island/IslandDisplayController.vue`（`display === 'agent'` 分支、Props、Emits、imports、displayKey）
- Modify: `src/components/island/IslandDisplayController.test.ts`
- Modify: `src/modules/island/display.ts`（`DETAIL_SIZES.agent`，不改主岛选择顺序）
- Modify: `src/modules/island/display.test.ts`

**消费接口：** `CodexAgentContent`/`CodexAgentDisplayState`；现有 `IslandModuleSnapshot`。

**产生接口：** Controller 新增 `agent: CodexAgentDisplayState` prop 和 `'clear-codex-task': [sessionId: string]` emit。其他 display props/events 保持不变。

- [ ] **步骤 1：先写 Controller 失败测试**

  挂载 compact agent，断言渲染 `CodexCompactContent`；挂载 detail agent，断言渲染任务列表；子组件 clear 事件以相同 sessionId 转发；network/music/hardware/notification/system-toast 现有分支仍渲染原组件。`displayKey` 对 Agent 使用 `snapshot.revision`，但详情新事件不能销毁 `CodexAgentContent` 并重置导航，因此 detail key 固定为 `agent_detail`，数据通过 props 更新。

  运行：

  ```powershell
  pnpm run test -- src/components/island/IslandDisplayController.test.ts
  ```

  预期：Agent 仍是静态占位分支，测试失败。

- [ ] **步骤 2：先写 Agent 布局失败测试**

  在 `display.test.ts` 覆盖：Agent 展开整体尺寸为宽 420、高 `42 + 8 + 280 = 330`；等待授权 strong 覆盖 manual focus；有效 manual focus 仍优先于 completed soft；soft 在没有 manual focus 时成为主岛；Agent error/warning 的普通优先级高于其他普通模块；Agent 作为卫星时顺序仍位于 wechat 后、notification 前；主岛从 Agent 变走时 `expandedKind` 自动变 null；最多三个卫星和溢出逻辑不变。

  运行：

  ```powershell
  pnpm run test -- src/modules/island/display.test.ts
  ```

  预期：旧 Agent 详情尺寸 340×92 导致新增断言失败。

- [ ] **步骤 3：实现 Controller 接线与唯一尺寸改动**

  用 `CodexAgentContent` 替换两个静态占位分支；只为 Agent 添加新 prop/emit。`DETAIL_SIZES.agent` 改为 `{ width: 420, detailHeight: 280 }`；不改变 `resolveIslandLayout()` 的强打断 → 手动焦点 → 软打断 → 轮换 → 稳定 → 优先级 → 兜底顺序。

  为防详情状态被 revision 更新重建，把 `displayKey` 改为按 display/mode 稳定：音乐继续保留 boxKey 行为，Agent detail 不含 revision。组件测试必须证明 current detail 在 props 更新后仍保持选中 session。

  运行：

  ```powershell
  pnpm run test -- src/components/island/IslandDisplayController.test.ts src/modules/island/display.test.ts
  pnpm run typecheck
  ```

  预期：新 Agent 与所有现有分支/布局测试通过。

- [ ] **步骤 4：提交**

  运行：

  ```powershell
  pnpm run lint
  pnpm run format:check
  git diff --check
  git diff -- src/components/island/IslandDisplayController.vue src/modules/island/display.ts
  ```

  预期：Controller 只有 Agent 分支/契约差异；布局只改 Agent 详情尺寸，未改音乐进度高度或通用选择算法。

  建议提交信息：

  ```text
  将 Codex 内容接入灵动岛展示控制器
  ```

---

## 任务 5：在 `IslandView.vue` 进行最小接线并验收交互共存

**独立交付物：** 真实 Agent 快照参与主/卫星调度；主岛点击展开列表、卫星点击切换、详情导航、新事件和鼠标离开自动收缩不会互相覆盖。

**Files:**

- Modify: `src/components/island/IslandView.vue`（imports；composable 初始化区；`islandModules`；两个 `IslandDisplayController` props/events；dispose 不新增手工监听清理）
- Create: `src/components/island/IslandView.codex.test.ts`

**消费接口：** `useCodexAgent({ idlePersistent: false })`、Controller 的 `agent` prop/clear event、现有 `expandedKind`/manual focus/500ms layout clock/一秒 mouseleave timer。

**产生接口：** 无新跨层接口；`IslandView` 只把 `codex.agentModuleSnapshot.value` 放入 modules，并构造同一个 `CodexAgentDisplayState` 传给 compact/detail Controller。

- [ ] **步骤 1：先写最小接线失败测试**

  mock `useCodexAgent`，断言 `islandModules` 不再包含 `{ kind:'agent', active:false }` 固定值；Agent 成为主岛时两个 Controller 收到相同 snapshot、同一份 `CodexListeningStatus`、相同 `agentModuleSnapshot` 与 idlePersistent；clear event 调用 composable `clearTask(sessionId)` 一次；清除失败不关闭详情且错误留给组件状态展示。

  运行：

  ```powershell
  pnpm run test -- src/components/island/IslandView.codex.test.ts
  ```

  预期：当前固定 Agent inactive，测试失败。

- [ ] **步骤 2：先写导航与调度共存失败测试**

  使用 fake timers 覆盖：

  - Agent 卫星点击后复用 `handleSatelliteSelect`，获得 manual focus 并成为主岛；
  - Agent 主岛点击后 `expandedKind='agent'`，显示列表；列表内点击详情不会触发 `handleMainClick`；
  - 鼠标离开 999ms 仍展开，1000ms 收缩；鼠标重新进入取消 timer；卸载清 timer；
  - Agent detail 中新 revision 不收缩、不重置已选任务；强打断切到其他模块时现有 watcher 清除 Agent 展开；
  - 等待授权 strong 能切到 Agent；completed soft 受现有 manual focus 保护；
  - 无任务时 running+常驻显示“Codex 已就绪”，awaiting_trust/partial/service_error/config_conflict 显示各自状态，not_installed/disabled 隐藏；上述状态变化都复用 composable 的同一份 listeningStatus；
  - Agent 任务自动从快照删除时详情组件回列表，若 Agent 变 inactive 则通用布局回网速/其他主岛。
  - 当前有 revision=20 任务时依次收到 revision=21 空快照和 not_installed，详情选择清空、Agent 隐藏；随后 revision=22 新任务与 awaiting_trust/running 状态正常显示，证明卸载/重装不会因旧 revision 被拒绝；

  运行：

  ```powershell
  pnpm run test -- src/components/island/IslandView.codex.test.ts
  ```

  预期：接线尚未实现，测试失败。

- [ ] **步骤 3：实施最小 `IslandView` 变更**

  在现有其他 composable 附近初始化一次 `useCodexAgent({ idlePersistent: false })`；04C 再把 false 换成设置 store ref。`islandModules` 第一项直接使用其 computed snapshot。构造 `codexAgentDisplayState` computed 时原样带入 composable 的 snapshot、listeningStatus、agentModuleSnapshot 和 idlePersistent；`now` 使用现有 `layoutNow`，不新增时钟或定时器。

  两个 Controller 都传 `:agent="codexAgentDisplayState"` 并转发 `@clear-codex-task="clearCodexTask"`。本文件不遍历事件、不判断 Stop、不设置 5/10/30 分钟 timer、不按阶段自行删除卡片；现有 `handleSatelliteSelect`、`handleMainClick`、`handleMouseLeave/Enter` 和 watcher 保持通用。

  运行：

  ```powershell
  pnpm run test -- src/components/island/IslandView.codex.test.ts src/modules/island/display.test.ts src/components/island/IslandDisplayController.test.ts
  pnpm run typecheck
  ```

  预期：Agent 接线和交互共存测试通过。

- [ ] **步骤 4：阶段三全量验证与范围审查**

  运行：

  ```powershell
  pnpm run test
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  Push-Location src-tauri
  cargo test --workspace
  cargo fmt --all --check
  cargo clippy --workspace --all-targets --all-features -- -D warnings
  Pop-Location
  rg -n "COMPLETED_RETENTION|PASSIVE_INTERRUPTION|ACTIVE_INTERRUPTION|classify_stop|10 \* 60|30 \* 60|5 \* 60" src/components/island/IslandView.vue src/components/island/codex src/modules/codex
  git diff --check
  git diff --name-only
  ```

  预期：所有前后端测试与质量检查通过；范围搜索不显示聚合生命周期或 Stop 判定进入 Vue；无设置页、Hook 配置或 WSL 功能。

- [ ] **步骤 5：提交**

  运行：

  ```powershell
  pnpm run test -- src/components/island/IslandView.codex.test.ts
  git diff --check
  git status --short
  ```

  预期：最小接线测试继续通过；差异检查无错误；状态只列出阶段三文件清单，没有设置、Hook 或无关模块改动。

  建议提交信息：

  ```text
  接入 Codex 实时状态灵动岛
  ```

## 阶段三完成门禁

- IPC 类型、函数名、命令和事件与 Rust/总体路线图完全一致；dormant revision=0 空快照是成功结果；旧 revision 和卸载后异步结果不会覆盖新状态。
- 前端不因 not_installed/disabled/Runtime restart 重置 revision；revision=20 旧任务 → revision=21 空快照 → revision=22 新 Runtime 任务的测试通过。
- 紧凑态、列表、详情、返回和清除均有组件测试；没有授权、打开 Codex、暂停、终止或继续操作。
- `IslandView.vue` 只接线，没有聚合、超时、保留、乱序或失败判断。
- Agent 详情整体尺寸 420×330；布局仍按现有通用优先级和卫星规则运行。
- 展开详情中的选择在新事件下保持；选中任务消失回列表；主岛切走或鼠标离开一秒按现有机制收缩。
- 无任务时严格按 listening phase 投影；idlePersistent 只影响 running，not_installed/disabled 始终隐藏，等待信任/部分可用/配置冲突/服务异常不会伪装成已就绪；本阶段传 false，04C 接入用户设置。
- Agent 的动态服务/Hook 状态只消费 `CodexListeningStatus`；阶段四静态 Inspection 不进入阶段三投影，也不形成第二个 phase 来源。
- 全量前端与 Rust 回归通过后才执行阶段四；不要自动进入阶段四。
