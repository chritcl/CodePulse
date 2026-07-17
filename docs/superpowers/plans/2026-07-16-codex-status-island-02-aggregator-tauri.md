# 阶段二：可测试聚合器、顺序 Actor 与 Tauri 生命周期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把阶段一的无状态事件流聚合为draft，由进程级`CodexSnapshotStore`生成跨Runtime严格递增的权威快照，实现随机`eventId`投递去重、跨配置层逻辑事件去重、优先级、跨轮次迟到过滤、平滑显示、完成/失败/中断生命周期，并提供generation-aware、由inspection显式驱动且可安全退出的Tauri runtime；本阶段不在应用启动时自行开启HTTP。

**架构：** `CodexAggregator<C: Clock>`是不依赖Tokio/Tauri、也不持有公开revision的纯状态对象；`ClockReading`同时提供只用于公开时间戳的Unix墙上毫秒和只用于状态转换的进程内单调毫秒；一个Actor按实际接收顺序独占处理聚合器与阶段一Receiver，把变化后的`CodexStateDraft`提交给进程级`CodexSnapshotStore`。可注入publisher只发布Store返回的完整快照和绑定该全局revision的边沿提醒。`CodexRuntimeManager`持有同一个`CodexIntegrationPaths`、同一个SnapshotStore、单调generation、HTTP/Actor/Discovery owner与监听事实，只响应`ensure_started(reason)`、`stop_if_unused(reason)`和应用退出；04B-3才把startup inspection结果接入这些接口。

**技术栈：** Rust 2021、Tokio mpsc/oneshot/interval、serde、Tauri 2、阶段一 `codex-protocol` 与 HTTP runtime；不新增生产依赖。

**前置条件：** 阶段一完成门禁全部通过；Bridge/HTTP wire 类型不得在本阶段复制或改名。

**本阶段消费：** `CodexEventReceiver`、`CodexBridgeEvent`、`start_codex_http()`、`CodexHttpHandle`、`DiscoveryOwner` 与 `remove_discovery_if_owned()`。

**本阶段产生：** `CodexStateDraft`、进程级 `CodexSnapshotStore`、全局 revision 的 `CodexStateSnapshot`、`CodexRuntimeFacts`、`CodexListeningStatus`、`CodexSelfCheckResult`、五个 Tauri 命令、三个 Tauri 事件、按原因幂等启停且 generation-aware 的 `CodexRuntimeManager` 与同步退出/异步关闭协调器。阶段三只能消费公开快照/监听契约，不能读取聚合器内部记录。

---

## 任务 1：定义公开状态、进程级 SnapshotStore、可注入时钟与 Stop 保守分类器

**独立交付物：** 阶段三所需 Rust DTO 与进程级 Store 已稳定；Runtime dormant 时已经有 revision=0 的合法空快照，所有时间常量和 Stop 判定可在无异步运行时环境单独测试。

**Files:**

- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/types.rs`
- Create: `src-tauri/src/codex/clock.rs`
- Create: `src-tauri/src/codex/classifier.rs`
- Create: `src-tauri/src/codex/types_tests.rs`
- Create: `src-tauri/src/codex/classifier_tests.rs`
- Create: `src-tauri/src/codex/snapshot_store.rs`
- Create: `src-tauri/src/codex/snapshot_store_tests.rs`

**消费接口：** `CodexSource`、`OperationResult` 和 wire enum；阶段一已脱敏的 `latestOutput`/`errorSummary`。

**产生接口：**

```rust
pub const NORMAL_STAGE_MIN_MS: u64 = 1_000;
pub const ATTENTION_DURATION_MS: u64 = 5_000;
pub const COMPLETED_RETENTION_MS: u64 = 5 * 60_000;
pub const PASSIVE_INTERRUPTION_MS: u64 = 10 * 60_000;
pub const ACTIVE_INTERRUPTION_MS: u64 = 30 * 60_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClockReading {
    pub wall_time_ms: i64,
    pub monotonic_ms: u64,
}

pub trait Clock: Clone + Send + Sync + 'static {
    fn now(&self) -> ClockReading;
}

#[derive(Clone)]
pub struct SystemClock {
    monotonic_origin: std::time::Instant,
}

#[derive(Clone)]
pub struct ManualClock(
    std::sync::Arc<std::sync::Mutex<ClockReading>>,
);

impl SystemClock {
    pub fn new() -> Self;
}

impl ManualClock {
    pub fn new(wall_time_ms: i64) -> Self;
    pub fn advance_ms(&self, delta_ms: u64);
    pub fn set_wall_time_ms(&self, wall_time_ms: i64);
}

pub enum CodexTaskStage {
    Analyzing, Reading, Editing, RunningCommand, RunningTests,
    WaitingApproval, Completed, Failed, Interrupted,
}

pub enum CodexAttentionLevel { Strong, Soft }
pub enum CodexAttentionReason {
    WaitingApproval, Failed, Completed, Interrupted,
}
pub enum CodexSoftInterruptReason { Completed, Interrupted }

pub struct CodexTaskState {
    pub session_id: String,
    pub turn_id: Option<String>,
    pub source: CodexSource,
    pub project_name: String,
    pub task_summary: String,
    pub stage: CodexTaskStage,
    pub operation_summary: Option<String>,
    pub latest_output: Option<String>,
    pub error_summary: Option<String>,
    pub last_operation_result: OperationResult,
    pub has_unresolved_issue: bool,
    pub active_subagent_count: u32,
    pub started_at: i64,
    pub last_activity_at: i64,
    pub completed_at: Option<i64>,
    pub acknowledged: bool,
}

pub struct CodexAttention {
    pub id: u64,
    pub level: CodexAttentionLevel,
    pub reason: CodexAttentionReason,
    pub session_id: String,
    pub expires_at: Option<i64>,
}

pub struct CodexStateSnapshot {
    pub version: u16,
    pub revision: u64,
    pub generated_at: i64,
    pub tasks: Vec<CodexTaskState>,
    pub representative_session_id: Option<String>,
    pub attention: Option<CodexAttention>,
}

pub struct CodexStateDraft {
    pub generated_at: i64,
    pub tasks: Vec<CodexTaskState>,
    pub representative_session_id: Option<String>,
    pub attention: Option<CodexAttention>,
}

pub struct CodexSnapshotStore {
    current: std::sync::RwLock<CodexStateSnapshot>,
    next_revision: std::sync::atomic::AtomicU64,
}

impl CodexSnapshotStore {
    pub fn new(initial_generated_at: i64) -> Self;
    pub fn current(&self) -> CodexStateSnapshot;
    pub fn commit(&self, draft: CodexStateDraft) -> CodexStateSnapshot;
    pub fn clear(&self, generated_at: i64) -> CodexStateSnapshot;
}
```

所有 serde 输出使用 camelCase/route 所需 snake_case enum。公开 `CodexTaskState` 不含 `cwd`、eventId、原始响应、内部计时字段或子智能体 ID 集合。

`CodexStateDraft` 是 Rust 内部类型，不 serde 到 Vue且没有 revision/version。`CodexSnapshotStore::new()` 固定建立 version=1、revision=0、generatedAt=initial_generated_at、tasks=[]、representativeSessionId=None、attention=None 的 current，并把 next_revision 初始化为 1。`commit()` 与 `clear()` 在 current 写锁内从 AtomicU64 分配严格大于 current.revision 的 revision，再替换 current；`clear()` 始终产生一份新的空快照，不复用旧 revision。Store 从 CodePulse 进程启动到退出只构造一次，不随 Runtime stop/start 销毁；`CodexRuntimeManager` 不得调用 `CodexSnapshotStore::new()`，也不得通过 `Default` 或无参数构造隐式创建第二份 Store。

```rust
pub struct StopEvidence<'a> {
    pub last_operation_result: OperationResult,
    pub final_summary: Option<&'a str>,
    pub error_summary: Option<&'a str>,
}

pub struct StopOutcome {
    pub stage: CodexTaskStage,
    pub has_unresolved_issue: bool,
}

pub fn classify_stop(evidence: StopEvidence<'_>) -> StopOutcome;
```

- [ ] **步骤 1：先写 DTO、时钟和序列化失败测试**

  `types_tests.rs` 覆盖 JSON 字段/枚举快照、公开 DTO 不含 `cwd`、优先级固定为授权 > 失败 > 完成 > 中断 > 测试 > 命令 > 编辑 > 读取 > 分析、`ManualClock::advance_ms()` 同时精确推进两个读数、`set_wall_time_ms()` 只改变墙上时间、五个 `u64` 时间常量精确值。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::types_tests -- --nocapture
  Pop-Location
  ```

  预期：类型、优先级和时钟尚不存在，测试编译失败。

- [ ] **步骤 2：先写 SnapshotStore 失败测试**

  `snapshot_store_tests.rs` 覆盖：new 返回合法 revision=0 空快照；current 返回 clone 且不暴露锁；第一次 commit 为 revision=1；连续 commit/clear/commit 的 revision 严格 1/2/3；clear 清除 tasks/representative/attention 但保留 version；并发提交仍无重复或倒退 revision；人为构造 current.revision 高于 next_revision 的防御用例仍保证下一 revision 更大。再模拟 Runtime A 最后 revision=20 → clear 得 revision=21 空快照 → Runtime B 第一份任务 draft commit 得 revision>21，证明 Store 生命周期与 Runtime 解耦。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::snapshot_store_tests -- --nocapture
  Pop-Location
  ```

  预期：`CodexSnapshotStore` 与 `CodexStateDraft` 尚不存在，测试编译失败。

- [ ] **步骤 3：先写 Stop 分类失败测试**

  表格用例至少包含：

  - 最后操作成功，无文本 => 完成、无未解决问题；
  - 最后操作失败，明确“仍然失败/无法完成/需要用户处理” => 失败；
  - 最后操作失败，文本只说明现状/等待下一步/信息不足 => 完成、`hasUnresolvedIssue = true`；
  - 最后操作失败，但明确“已修复/测试通过/完成” => 完成、无未解决问题；
  - 操作结果未知且文本不明确 => 完成；
  - 中间 `PostToolUse` 失败不调用 Stop 分类，也不会在类型层产生最终失败。

  词表用中文和英文已确认短语，匹配前只做小写与空白标准化，不用宽泛的单字“失败”覆盖“先失败后已修复”。正向完成短语优先于较早的失败描述，判断以最终摘要末段为主要证据。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::classifier_tests -- --nocapture
  Pop-Location
  ```

  预期：`classify_stop()` 尚不存在，测试失败。

- [ ] **步骤 4：实现最小类型、Store、手动时钟和保守分类**

  `snapshot_store.rs` 只负责初始空快照、revision 分配与 current 替换；`commit()`/`clear()` 的 revision 分配和 current 替换必须在同一写锁临界区完成，并用 AtomicU64 的单调更新防御 next_revision 落后，不引入第二个 revision 计数器。`ManualClock` 用共享原子值分别保存墙上毫秒与单调毫秒，`advance_ms()` 同时推进两者，`set_wall_time_ms()` 模拟 Windows 校时且不推进单调时间，测试不调用 `sleep`。`SystemClock` 构造时保存一个 `Instant` 基准，`now()` 用 `SystemTime` 读取 Unix 毫秒、用该基准的 elapsed 生成进程内单调毫秒；处理系统时间早于 Unix epoch、Unix 毫秒超出 `i64` 和 elapsed 超出 `u64` 时使用显式饱和转换。`classifier.rs` 只处理脱敏短文本，不读 transcript、不调用模型、不把单次命令失败直接升级为任务失败。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::types_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::snapshot_store_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::classifier_tests -- --nocapture
  Pop-Location
  ```

  预期：所有 DTO、Store、进程级 revision、时钟、优先级和 Stop 组合通过，测试耗时不受 5/10/30 分钟常量影响。

- [ ] **步骤 5：静态检查和提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n "cwd|transcript|tool_input|tool_response" src-tauri/src/codex/types.rs src-tauri/src/codex/classifier.rs
  git diff --check
  ```

  预期：公开类型和分类器不含路径/原始 Hook 正文；所有检查通过。

  建议提交信息：

  ```text
  定义 Codex 状态模型与保守终态判定
  ```

---

## 任务 2：实现顺序聚合、会话合并、去重与乱序过滤

**独立交付物：** 纯聚合器可将任意多会话事件流稳定归并为排序后的任务快照；同一逻辑Hook事件即使从用户层和仓库层分别启动Bridge并产生不同随机`eventId`也只处理一次；没有定时器和Tauri依赖。

**Files:**

- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/aggregator.rs`
- Create: `src-tauri/src/codex/aggregator_tests.rs`

**消费接口：** `CodexBridgeEvent`、任务 1 的 `Clock`/公开类型/`classify_stop()`。

**产生接口：**

```rust
pub struct AggregateEffects {
    pub draft_changed: bool,
    pub soft_interrupt: Option<CodexSoftInterruptDraft>,
    pub authenticated_activity: Option<CodexAuthenticatedActivity>,
}

pub struct CodexAuthenticatedActivity {
    pub source: CodexSource,
    pub received_at: i64,
}

pub struct CodexAggregator<C: Clock>;

impl<C: Clock> CodexAggregator<C> {
    pub fn new(clock: C) -> Self;
    pub fn ingest(&mut self, event: CodexBridgeEvent) -> AggregateEffects;
    pub fn tick(&mut self) -> AggregateEffects;
    pub fn clear_task(&mut self, session_id: &str) -> Result<AggregateEffects, ClearTaskError>;
    pub fn clear_all_failures(&mut self) -> AggregateEffects;
    pub fn draft(&self) -> CodexStateDraft;
}
```

内部 `CodexTaskRecord` 允许保存 `cwd`、`last_received_monotonic_ms`、当前/待提交普通阶段、`visible_since_monotonic_ms`、`completed_monotonic_ms`、`attention_expires_monotonic_ms`、最近 8 个 retired turnId、按 `toolUseId` 关联的活动工具集合、`HashSet<agentId>` 和提醒周期标记；这些字段不得序列化到 Vue。`occurredAt` 只在共享协议校验非负并可用于诊断/必要展示，不保存为当前轮次淘汰游标。公开草稿的 `startedAt`、`lastActivityAt`、`completedAt`、`expiresAt`、`generatedAt` 取同一次 `ClockReading.wall_time_ms`，内部期限和排序只取 `monotonic_ms`。Aggregator 不引用 `CodexSnapshotStore`，不含 AtomicU64，不生成 version/revision。

聚合器内部增加第二个有界逻辑事件缓存，与随机`eventId`缓存相互独立且都由单线程Actor独占维护。逻辑键只能从已经允许进入`CodexBridgeEvent`的稳定标识字段中选择：`sessionId`、`turnId`、`eventType`以及事件适用时的`toolUseId`、`agentId`。不得加入prompt正文、cwd、文件路径、命令正文、tool input/output或任何用户内容摘要。每种eventType具体使用哪些字段不得在本计划凭旧字段猜测；任务实施第一步必须重新核对最新官方Hook输入字段并同步协议测试，若稳定标识不足以安全构键则停止并更新Roadmap及消费者计划。

- [ ] **步骤 1：先写会话与轮次归并失败测试**

  覆盖：SessionStart 不创建活跃卡；首次 UserPromptSubmit 创建；同 session 新 prompt 覆盖卡而非新增；新轮次清除旧失败/中断/操作/子智能体；两个 session 并存；来源 unknown 不影响聚合；任务列表按服务端单调接收顺序倒序；代表任务按固定优先级、同级按单调接收顺序选择。额外让墙上时间先前跳 1 小时、再向后跳 2 小时，断言列表和代表任务顺序不变，但公开时间戳反映新的墙上时间。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::aggregator_tests::session -- --nocapture
  Pop-Location
  ```

  预期：聚合器不存在，测试失败。

- [ ] **步骤 2：先写去重、接收顺序和跨轮次迟到失败测试**

  覆盖：相同eventId只处理一次；eventId缓存上限2048且淘汰最旧ID；相同逻辑事件使用不同随机eventId、模拟用户层与仓库层两个活动Hook文件分别投递时，只改变一次draft、只产生一次提醒且子智能体只计数一次；逻辑缓存上限2048且淘汰最旧key。分别改变turnId、toolUseId、agentId，断言合法连续事件不会被误去重。断言逻辑键序列化/Debug不含prompt正文、cwd、文件路径、命令正文、tool input/output或内容摘要。同一当前turn内无论`occurredAt`增大、相等或减小都严格按Actor实际接收顺序处理；PreToolUse先于同turnId UserPromptSubmit到达时先建立“Codex任务”临时轮次，后到prompt只补摘要且阶段仍为工具阶段；新TurnStarted可正式确认临时轮次或替换当前轮；最近8个retired turnId的晚到Tool/Stop全部丢弃；明确属于旧session generation的事件丢弃；第9个retired ID被有界淘汰。

  `toolUseId` 用例必须覆盖 started/finished 精确关联、重复 finished 不二次改变 operation result、未知 finished 不把阶段倒退；`agentId` 用例覆盖 SubagentStart 重复不加二、未知 SubagentStop 不减到负数、新轮次清空 agent ID 集合。

  增加两个固定回归序列：`ToolStarted(editing, occurredAt=T)` → Windows 墙上时间回拨 2 小时 → `ToolStarted(running_tests, occurredAt=T-2h)`，最终阶段必须为 `running_tests`；当前轮次收到更小 `occurredAt` 的 `PermissionRequested` 必须立即进入 `waiting_approval`。这两个用例分别改变 `ManualClock.wall_time_ms` 和 wire `occurredAt`，且都不得被淘汰。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::aggregator_tests::ordering -- --nocapture
  Pop-Location
  ```

  预期：测试失败。

- [ ] **步骤 3：先写 Hook 映射与中间失败失败测试**

  覆盖八种 eventType：SessionStarted 只更新 session 元数据；TurnStarted 分析；ToolStarted 使用 wire stage；PermissionRequested 授权；ToolFinished 更新结果/摘要但默认保持当前阶段；Subagent 只更新计数；TurnStopped 用聚合记录中的最后 operationResult、最后错误摘要和该 Stop 的 latestOutput 调用 Stop 分类。明确断言 `ToolFinished(operationResult=failed)` 后仍是运行测试或执行命令，不是最终 failed；TurnStopped 自身的 operationResult 固定为 unknown，不能覆盖记录证据。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::aggregator_tests::mapping -- --nocapture
  Pop-Location
  ```

  预期：测试失败。

- [ ] **步骤 4：实现 Map 所有权与确定性规则**

  使用`HashMap<sessionId, CodexTaskRecord>`；一个`VecDeque + HashSet`实现2048个随机eventId去重，另一个独立`VecDeque + HashSet`实现2048个逻辑事件键去重。两套缓存都只在Aggregator/Actor内存中维护，不持久化、不进入Bridge或Vue。每次`ingest()`只调用一次`clock.now()`：`wall_time_ms`写入draft的`startedAt/lastActivityAt`并作为本次`authenticated_activity.received_at`，`monotonic_ms`写入内部`last_received_monotonic_ms`并用于任务排序。重复eventId或逻辑键仍可返回authenticated activity，因为进程确实收到已认证请求，但不得再次改变任务、产生提醒或改变子智能体计数。

  当前轮次状态严格以Actor收到事件的顺序更新；不得比较wire`occurredAt`来排序或淘汰。`occurredAt`只在协议层验证为非负整数，并允许进入不含正文的诊断元数据；它不得控制任务列表/代表任务排序、一秒平滑、完成保留、10/30分钟中断或attention过期。允许丢弃的事件只有重复eventId、重复逻辑事件、属于retired turnId的迟到事件，以及session内部轮次generation明确不兼容的旧事件；这里的session generation不得与Runtime Manager的runtime_generation共用字段或含义。Bridge不扫描配置层或维护持久去重状态，Vue不做补充去重。

  新 TurnStarted 是轮次边界；若工具/授权事件先到，同 turnId 可先建立 `turn_boundary_seen=false` 的临时记录，后到 TurnStarted 只补 taskSummary 并设为 true，不覆盖临时记录的首次服务端接收时间或更新后的可见阶段。真正替换轮次时把旧 turnId 放进最多 8 项的 retired deque；retired 轮次的任何晚到事件都丢弃。若缺少 `turnId`，仍以收到 TurnStarted 为新轮边界并清空旧终态。`toolUseId` 维护当前轮次工具关联，`agentId` 维护当前轮次子智能体去重。SessionStarted 可缓存 session 元数据，但 draft 只输出活跃任务。所有 draft 构造集中在一个函数，按内部单调接收时间排序后再选代表任务；公开 `lastActivityAt` 和 wire `occurredAt` 都不参与排序。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::aggregator_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::classifier_tests -- --nocapture
  Pop-Location
  ```

  预期：会话、轮次、排序、去重、乱序、八事件和中间失败测试全部通过。

- [ ] **步骤 5：审查并提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n "tokio::time|tauri::|sleep\(" src-tauri/src/codex/aggregator.rs
  git diff --check
  ```

  预期：纯聚合器中没有 Tokio 时间、Tauri 或 sleep；检查通过。

  建议提交信息：

  ```text
  实现 Codex 多会话顺序聚合
  ```

---

## 任务 3：实现一秒平滑、提醒和可测试生命周期

**独立交付物：** 用 `ManualClock` 瞬时验证普通状态最短显示、完成保留、失败保留、10/30 分钟中断、授权不超时和提醒只触发一次。

**Files:**

- Modify: `src-tauri/src/codex/aggregator.rs`
- Modify: `src-tauri/src/codex/aggregator_tests.rs`
- Create: `src-tauri/src/codex/lifecycle_tests.rs`

**消费接口：** 任务 2 的 `ingest()`/`tick()` 与任务 1 时间常量。

**产生接口：** `AggregateEffects.soft_interrupt` 与 draft 中的 `CodexAttention`。Aggregator 只产生不带公开 revision 的软提醒草稿：

```rust
pub struct CodexSoftInterruptDraft {
    pub attention_id: u64,
    pub session_id: String,
    pub reason: CodexSoftInterruptReason,
    pub expires_at: i64,
}

pub struct CodexSoftInterrupt {
    pub attention_id: u64,
    pub session_id: String,
    pub reason: CodexSoftInterruptReason,
    pub expires_at: i64,
    pub revision: u64,
}
```

只有 Actor 把同一次变化的 `CodexStateDraft` 提交给 `CodexSnapshotStore` 后，才能用 Store 返回的 `snapshot.revision` 把 draft 转换成公开 `CodexSoftInterrupt`。

- [ ] **步骤 1：先写一秒平滑失败测试**

  用 ManualClock 验证：首个普通状态立即可见；可见不足 1000ms 时后续普通阶段只覆盖一个 pending 值；在 999ms 仍显示旧阶段；推进到 1000ms 并 tick 后显示最后 pending 阶段；同状态只刷新活动时间且不创建新提醒；授权、Stop 终态和中断绕过平滑立即生效。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::lifecycle_tests::smoothing -- --nocapture
  Pop-Location
  ```

  预期：pending/可见期限尚未实现，测试失败。

- [ ] **步骤 2：先写保留与中断失败测试**

  精确边界：完成后 299,999ms 仍存在，300,000ms tick 删除；失败推进 24 小时仍存在；新 prompt 清除旧失败；分析/读取/编辑在 599,999ms 活跃、600,000ms 中断；命令/测试在 1,799,999ms 活跃、1,800,000ms 中断；授权推进 24 小时仍等待；新有效事件从中断自动恢复并开始新中断周期。另用 `set_wall_time_ms()` 将墙上时间分别向前和向后跳 24 小时但不推进单调时间，断言 pending、完成保留、attention 和中断均不提前、不回退；只有 `advance_ms()` 能跨越期限。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::lifecycle_tests::retention -- --nocapture
  cargo test -p netspeed-dynamic codex::lifecycle_tests::interruption -- --nocapture
  Pop-Location
  ```

  预期：生命周期测试失败，但执行时间仍应接近瞬时，不能真实等待。

- [ ] **步骤 3：先写提醒边沿失败测试**

  覆盖：PermissionRequest 产生持续 strong attention；后续工具/Stop/新轮次退出；首次 failed 产生 5 秒 strong，过期后任务保留且 acknowledged=true；首次 completed 产生 5 秒 soft attention 和一次 `CodexSoftInterruptReason::Completed`；首次 interrupted 产生 5 秒 soft attention 和一次 `CodexSoftInterruptReason::Interrupted`；同一终态或中断周期后续 tick 不重复；恢复后再次超时可产生新 attentionId；attentionId 严格递增。等待授权和失败不得产生 `CodexSoftInterrupt`。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::lifecycle_tests::attention -- --nocapture
  Pop-Location
  ```

  预期：提醒测试失败。

- [ ] **步骤 4：实现纯 tick 状态转换**

  `ingest()` 对关键态立即提交内部可见状态；普通态根据 `visible_since_monotonic_ms` 决定立即提交或替换 pending。`tick()` 按固定顺序执行：提交到期 pending、删除到期 completed、检测活动任务中断、过期非授权 attention、重新计算代表任务/draft 是否变化。每次调用只取一次 `clock.now()` 并把同一个 `ClockReading` 传给本次全部转换，避免一次转换混用两个时刻。

  中断阈值基于内部 `last_received_monotonic_ms`；完成删除基于 `completed_monotonic_ms`；普通阶段、提醒期限分别基于 `visible_since_monotonic_ms`、`attention_expires_monotonic_ms`。等待授权与终态不进入中断扫描。新事件清除本次中断提醒标记，重复同状态事件只更新活动时间。公开字段变化时只设置 `draft_changed=true`；`generatedAt` 变化本身不算变化；Aggregator 不分配 revision。所有公开时间戳用本次 reading 的墙上时间计算，任何状态转换都禁止比较墙上时间。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::lifecycle_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::aggregator_tests -- --nocapture
  Pop-Location
  ```

  预期：所有时间边界和提醒次数测试通过，无任何测试等待真实秒/分钟。

- [ ] **步骤 5：提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n "sleep\(|interval\(" src-tauri/src/codex/aggregator.rs src-tauri/src/codex/lifecycle_tests.rs
  git diff --check
  ```

  预期：聚合器和生命周期测试不含真实等待；所有检查通过。

  建议提交信息：

  ```text
  完成 Codex 状态平滑与生命周期规则
  ```

---

## 任务 4：实现单 Actor、权威快照命令与 Tauri 事件

**独立交付物：** 并发 HTTP 事件、Tick 和运行期清除命令都被一个 Actor 顺序处理并提交进程级 Store；Vue 无论 Actor 是否存在都可查询完整快照并接收三类事件，dormant 清除操作有确定返回值且不产生 service_error。

**Files:**

- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/actor.rs`
- Create: `src-tauri/src/codex/publisher.rs`
- Create: `src-tauri/src/codex/commands.rs`
- Create: `src-tauri/src/codex/actor_tests.rs`
- Create: `src-tauri/src/codex/commands_tests.rs`
- Modify: `src-tauri/src/lib.rs`（`use codex::commands::*` 与 `generate_handler!` 的 Codex 命令区域）

**消费接口：** 阶段一 `CodexEventReceiver`；任务 1 的进程级 `Arc<CodexSnapshotStore>`；任务 3 `CodexAggregator`、draft 和 effects；Runtime 创建时分配的 generation。

**产生接口：**

```rust
pub enum CodexActorCommand {
    Tick,
    ClearTask { session_id: String, reply: oneshot::Sender<Result<CodexStateSnapshot, ClearTaskError>> },
    ClearFailures { reply: oneshot::Sender<CodexStateSnapshot> },
    Shutdown { reply: oneshot::Sender<()> },
}

pub trait CodexEventPublisher: Send + Sync + 'static {
    fn publish_state(&self, snapshot: &CodexStateSnapshot);
    fn publish_soft_interrupt(&self, interrupt: &CodexSoftInterrupt);
    fn publish_listening_status(&self, status: &CodexListeningStatus);
}

pub trait CodexActivityReporter: Send + Sync + 'static {
    fn record_authenticated_event(
        &self,
        runtime_generation: u64,
        source: CodexSource,
        received_at: i64,
    );
}
```

每个 Actor/Reporter 创建时捕获不可变的 `runtime_generation`。事件固定为 `codex-state-changed`、`codex-soft-interrupt`、`codex-listening-status-changed`；publisher 使用 `AppHandle::emit`，测试使用内存 publisher。Actor 在 effects.draft_changed 时取得 `aggregator.draft()` 并调用 Store.commit；先发布返回的完整权威快照，再把 soft interrupt draft 绑定该 snapshot.revision 后发布。没有 draft 变化时不得为了 generatedAt 单独 commit。

监听与自检类型固定为：

```rust
pub enum CodexServiceState { Stopped, Starting, Listening, Error }
pub enum CodexHookState {
    Unknown, NotInstalled, AwaitingTrust, Active, Partial, Conflict, Disabled,
}
pub enum CodexListeningPhase {
    Disabled, NotInstalled, AwaitingTrust, Running, Partial,
    ConfigConflict, ServiceError,
}
pub struct CodexListeningStatus {
    pub service_state: CodexServiceState,
    pub hook_state: CodexHookState,
    pub phase: CodexListeningPhase,
    pub port: Option<u16>,
    pub using_fallback_port: bool,
    pub last_event_at: Option<i64>,
    pub sources: Vec<CodexSource>,
    pub error_code: Option<String>,
}

pub struct CodexSelfCheckResult {
    pub ok: bool,
    pub checked_at: i64,
    pub checks: Vec<CodexSelfCheckItem>,
}

pub struct CodexSelfCheckItem {
    pub code: CodexSelfCheckCode,
    pub status: CodexSelfCheckStatus,
    pub message: String,
}

pub enum CodexSelfCheckCode {
    ServiceListening, DiscoveryMatchesRuntime, EventQueueOpen,
    BridgeResourcePresent, BridgeInstalled, HookConfigValid,
}
pub enum CodexSelfCheckStatus { Pass, Warning, Fail }
```

阶段二只产生前三项检查；阶段四在同一命令中加入后三项。

Tauri 命令签名固定为：

```rust
#[tauri::command]
async fn get_codex_snapshot(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexStateSnapshot, String>;
#[tauri::command]
async fn clear_codex_task(
    session_id: String,
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexStateSnapshot, String>;
#[tauri::command]
async fn clear_all_codex_failures(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexStateSnapshot, String>;
#[tauri::command]
async fn get_codex_listening_status(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexListeningStatus, String>;
#[tauri::command]
async fn run_codex_self_check(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexSelfCheckResult, String>;
```

- [ ] **步骤 1：先写 Actor 并发与发布失败测试**

  用容量 256 的 event channel 并发发送多个 session，同时交错 ClearTask 和显式 `CodexActorCommand::Tick`；断言 publisher 收到的快照全部来自同一个注入 Store且 revision 单调递增，最终 `store.current()` 与顺序参考模型相同。Actor fixture 必须保存传入的 `Arc<CodexSnapshotStore>` 并用 `Arc::ptr_eq` 证明它与 Manager 的 `runtime.snapshot_store()` 是同一实例。软提醒只发一次，并且 revision 精确等于产生该提醒的 Store commit revision；不存在 Aggregator revision。每个从已认证 HTTP 队列取出的事件都把 `AggregateEffects.authenticated_activity` 连同 Actor 捕获的 generation 转交 activity reporter 一次，包括被 eventId 去重的重投；自检和 Tick 不得调用。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::actor_tests -- --nocapture
  Pop-Location
  ```

  预期：Actor/publisher 不存在，测试失败。

- [ ] **步骤 2：先写清除和命令失败测试**

  覆盖：Runtime 运行时只允许清除 failed/interrupted并由 Actor 顺序提交 Store；清除 active/completed/unknown session 返回稳定错误码；清除全部失败不删中断；每个命令返回 Store 提交后的权威快照。新增 dormant 矩阵：not_installed、local disabled、managed disabled、config conflict、Runtime 从未启动与 Runtime 已停止六种状态都让 `get_codex_snapshot()` 成功返回 `runtime.snapshot_store().current()`，初始 revision=0、tasks=[]，且 listening 不变、不产生 service_error；测试把注入 Store 预置为非默认 revision 后再 dormant 查询，证明命令不从 Actor 或另一份 Store 读取；dormant 空快照执行 clear task返回稳定 `UnknownSession`；dormant 执行 clear all 直接返回当前空快照。self-check 精确返回服务/发现文件/队列三项且不发送伪 Codex 事件。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::commands_tests -- --nocapture
  Pop-Location
  ```

  预期：命令与 manager state 尚未实现，测试失败。

- [ ] **步骤 3：实现 `tokio::select!` 顺序循环**

  Actor 同时选择 event receiver、命令 receiver、一秒 `interval` 与 shutdown；所有分支只调用同一个聚合器实例。interval 使用 `MissedTickBehavior::Skip`，防止恢复后批量重放过期 Tick。每个 event 分支只调用一次 `aggregator.ingest(event)`，随后把 effects 中的 `authenticated_activity` 与捕获的 runtime generation 转交 `CodexActivityReporter`。每次 effects 若 draft_changed，先 `store.commit(aggregator.draft())` 并发布完整快照，再用该 snapshot.revision 构造 soft interrupt；没有变化不发布。clear 命令同样只能通过 Actor 改聚合器并提交 Store。

  publisher 错误只记错误码，不终止 Actor。snapshot 查询不再进入 Actor，而是读取进程级 Store；这样 Runtime dormant 仍可用，同时运行期查询只会看到 Actor 已完成提交的完整快照，绝不会读取内部 HashMap 半状态。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::actor_tests -- --nocapture
  Pop-Location
  ```

  预期：事件、显式 Tick 和命令按 Actor 接收顺序处理；每个认证事件只上报一次 activity；快照先于同 revision 的 soft interrupt 发布；Actor 测试通过。

- [ ] **步骤 4：实现 Tauri 命令并注册**

  `commands.rs` 只从 `State<CodexRuntimeManager>` 通过 `runtime.snapshot_store()` 取得唯一进程级 Store 与可选 Actor handle，不单独接收 `State<CodexSnapshotStore>`。`get_codex_snapshot()` 始终只读该注入 Store；clear task/all 仅在 Runtime running 时发 Actor 命令，dormant 按固定空快照语义返回，不把 Actor 缺失映射为服务异常。所有外部错误映射为不含路径、token 或正文的稳定中文信息；内部测试额外断言错误代码。`lib.rs` 只新增模块 import 和五个 handler 名称，不调整现有命令顺序或职责。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::actor_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::commands_tests -- --nocapture
  cargo test -p netspeed-dynamic --lib
  Pop-Location
  ```

  预期：Actor、清除、发布、自检及现有 Rust 测试全部通过。

- [ ] **步骤 5：提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets --all-features -- -D warnings
  Pop-Location
  rg -n "codex-state-changed|codex-soft-interrupt|codex-listening-status-changed" src-tauri/src/codex
  git diff --check
  ```

  预期：三个事件名只有统一常量/调用点，命令均注册，检查通过。

  建议提交信息：

  ```text
  接入 Codex 聚合 Actor 与 Tauri 快照接口
  ```

---

## 任务 5：实现 inspection 驱动的 Runtime Manager 与确定的 Tauri 退出桥接

**独立交付物：** Runtime可按明确原因幂等启动或停止，每次真实创建都使用新的generation、token与Discovery owner；应用启动时Store可查询但HTTP/Actor保持dormant，等待04B-3的只读inspection决策；隐藏窗口不停止服务；托盘退出和正常退出共用“同步阻止退出、异步最多两秒关闭、第二次退出放行”的同一路径。

**Files:**

- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/service.rs`
- Create: `src-tauri/src/codex/service_tests.rs`
- Create: `src-tauri/src/codex/exit.rs`
- Create: `src-tauri/src/codex/exit_tests.rs`
- Modify: `src-tauri/src/lib.rs`（`run()` builder/build/run 区域、`initialize_app()`、`create_system_tray()` 的 quit handler）

**消费接口：** 阶段一 `CodexIntegrationPaths`、`start_codex_http(paths, event_tx)`、`CodexHttpHandle::{stop_accepting,invalidate_discovery,wait}`、`DiscoveryOwner`、`remove_discovery_if_owned()`，以及任务 1 的进程级 `Arc<CodexSnapshotStore>`、Actor start/shutdown 和 publisher。Tauri API 以仓库锁定的 `tauri 2.11.5` 本地 crate 源码为准：`PathResolver::local_data_dir() -> Result<PathBuf>` 返回 Windows LocalAppData 根目录；`PathResolver::resource_dir() -> Result<PathBuf>` 返回资源根目录；`Manager::manage<T: Send + Sync + 'static>()`/`state<T>()` 管理进程状态；`App::run(FnMut(&AppHandle, RunEvent))` 提供同步回调；`RunEvent::ExitRequested { code: Option<i32>, api: ExitRequestApi }`；`ExitRequestApi::prevent_exit(&self)`；`AppHandle::exit(&self, i32)` 会再次触发 `ExitRequested` 和 `Exit`。`RunEvent` 与其字段均为 non-exhaustive，匹配必须保留 `..` 和 `_` 分支；restart code 下 prevent 会被忽略。

**产生接口：**

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CodexRuntimeStartReason {
    StartupInspection,
    InstallSelfCheck,
    RepairSelfCheck,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CodexRuntimeStopReason {
    StartupInspectionDisallows,
    InstallFailed,
    Uninstalled,
    RuntimeGenerationReplaced,
    RuntimeErrorStateCleared,
}

pub struct CodexRuntimeFacts {
    pub runtime_generation: Option<u64>,
    pub authenticated_generation: Option<u64>,
    pub service_state: CodexServiceState,
    pub port: Option<u16>,
    pub using_fallback_port: bool,
    pub last_event_at: Option<i64>,
    pub sources: Vec<CodexSource>,
    pub error_code: Option<String>,
}

#[derive(Clone)]
pub struct CodexRuntimeManager {
    inner: Arc<CodexRuntimeManagerInner>,
}

pub struct CodexRuntimeManagerInner {
    snapshot_store: Arc<CodexSnapshotStore>,
    next_runtime_generation: AtomicU64,
    // 其余状态由 mutex 保护，且 guard 不跨 await/publisher。
}

impl CodexRuntimeManager {
    pub fn new(
        app: tauri::AppHandle,
        paths: CodexIntegrationPaths,
        snapshot_store: Arc<CodexSnapshotStore>,
    ) -> Self;
    pub async fn ensure_started(
        &self,
        reason: CodexRuntimeStartReason,
    ) -> Result<(), CodexRuntimeError>;
    pub async fn stop_if_unused(
        &self,
        reason: CodexRuntimeStopReason,
    ) -> Result<(), CodexRuntimeError>;
    pub async fn shutdown(&self) -> Result<(), CodexRuntimeError>;
    pub async fn listening_status(&self) -> CodexListeningStatus;
    pub fn snapshot_store(&self) -> Arc<CodexSnapshotStore>;
    pub fn cleanup_owned_discovery_file_sync(&self);
}

pub struct CodexExitCoordinator {
    shutdown_started: AtomicBool,
    shutdown_finished: AtomicBool,
    exit_code: AtomicI32,
}

pub enum CodexExitRequestDecision {
    PreventAndStartShutdown { exit_code: i32 },
    PreventWithoutRestart,
    AllowExit,
}

impl CodexExitCoordinator {
    pub fn new() -> Self;
    pub fn decide_exit_request(
        &self,
        requested_code: Option<i32>,
    ) -> CodexExitRequestDecision;
    pub fn mark_shutdown_finished(&self);
    pub fn handle_exit_requested<R: tauri::Runtime>(
        self: &Arc<Self>,
        app_handle: tauri::AppHandle<R>,
        api: &tauri::ExitRequestApi,
        requested_code: Option<i32>,
        runtime: CodexRuntimeManager,
    );
}
```

`CodexExitCoordinator` 的共享内部状态必须精确包含 `shutdown_started: AtomicBool`、`shutdown_finished: AtomicBool`、`exit_code: AtomicI32`。manager 内部状态机固定为 `Stopped -> Starting -> Running -> Stopping -> Stopped`，错误转 `Error`；`ensure_started()`、`stop_if_unused()`、`shutdown()` 均幂等。`next_runtime_generation` 从 1 开始，只增不减、不复用；允许失败启动消耗编号。显示偏好和任何 Vue 命令都不得调用 start/stop 接口。

- [ ] **步骤 1：先写按原因启停与路径消费失败测试**

  通过注入 fake server/actor/publisher 覆盖：manager 构造只保存同一个 `CodexIntegrationPaths` 与调用方提供的同一个进程级 Store，不启动 listener；Store 初始 revision=0 且 dormant 可查询。构造后必须直接断言：

  ```rust
  assert!(Arc::ptr_eq(
      &provided_store,
      &runtime.snapshot_store(),
  ));
  ```

  `ensure_started(StartupInspection)` 每次真实创建先分配非零 generation，再把同一个 generation 绑定 event channel/Actor/reporter/HTTP token/DiscoveryOwner，并把 `runtime.snapshot_store()` 的同一 Arc 传给 Actor；三种 start reason 在已运行时重复调用不创建第二 listener或新 generation；启动失败允许消耗 generation、关闭 actor、current generation 保持 None并进入 service_error。增加完整序列：Manager start → Actor 获得同一 Store → Stop 后该 Store revision 增加 → Restart 后新 Actor 仍持有同一 Arc。

  generation 表格必须覆盖：generation=1 收到真实事件 → authenticatedGeneration=1 → running；generation=1 stop → generation=2 start → authenticatedGeneration=None、lastEventAt=None、sources=[]、旧 error/port/fallback 清空 → awaiting_trust；generation=1 Actor 晚到上报或关闭回调且 current=2 → 完全忽略；generation=2 收到真实事件 → authenticatedGeneration=2 → running。running 的必要条件固定为 current generation 非 None 且两个 generation 相等；self-check 不能设置 authenticatedGeneration。

  `stop_if_unused(StartupInspectionDisallows|InstallFailed|Uninstalled|RuntimeGenerationReplaced|RuntimeErrorStateCleared)` 都按当前 generation 幂等停止；顺序固定为：拒绝新 HTTP → 使用 handle 保存的完整 owner 删除 discovery（ReplacedByNewRuntime 不删新文件）→ 关闭 sender并请求旧 Actor shutdown/等待旧 HTTP 与 Actor → `SnapshotStore.clear()` → publisher 发布更高 revision 空快照 → current generation/authenticated facts 置 None → publisher 发布新的 listening status。旧 Runtime 最后 revision=20 时 stop 必须发布 revision=21 空快照；下一 Runtime 首个任务 revision>21。Runtime A revision=15 stop 后 Runtime B 不得从 revision=1 开始。窗口 hide 和 `idlePersistent` 变化都不调用启动或停止。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  Pop-Location
  ```

  预期：按原因启停和 phased shutdown 尚不存在，测试编译失败。

- [ ] **步骤 2：先写退出协调器失败测试**

  先对 `decide_exit_request()` 写纯状态测试：第一次返回 PreventAndStartShutdown，`requested_code=None` 保存 0、Some(n) 保存 n；第二次在未 finished 时返回 PreventWithoutRestart；`mark_shutdown_finished()` 后返回 AllowExit。再用只在测试中实现的 `ExitCallbackHarness { prevent_count, spawn_count, requested_exit_codes }` 执行与实际回调相同的 decision match，覆盖第一次调用 prevent、shutdown 只 spawn 一次、完成后 request exit、两秒 timeout 后仍 exit、窗口 hide 不触发、托盘 quit 进入同一处理函数。

  正常退出后 Store 已发布更高 revision 空快照，discovery 只由完整 Owner 删除。RunEvent::Exit 同步兜底覆盖：文件不存在 AlreadyAbsent；Runtime A owner 面对 Runtime B 替换文件返回 ReplacedByNewRuntime；相同 PID 不同 token 不删；内容损坏不 panic、不盲删并记录 warning。第二个 Runtime 的 discovery 不受第一个 Runtime handle/drop/Exit 清理影响。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::exit_tests -- --nocapture
  Pop-Location
  ```

  预期：协调器、原子状态和退出适配器不存在，测试失败；测试使用暂停的 Tokio 时间推进两秒，不真实等待。

- [ ] **步骤 3：实现 dormant manager 与监听状态**

  `initialize_app()` 使用 `app.path().local_data_dir()?` 取得不带 bundle identifier 的 Windows 本地数据根目录，使用 `app.path().resource_dir()?` 取得资源根目录；Codex Home 按 `CODEX_HOME` 优先、否则 `%USERPROFILE%\.codex`；ProgramData 从 `%ProgramData%` 读取。四个根只传给 `CodexIntegrationPaths::from_local_data_root(...)` 一次，然后把同一个 paths 对象交给 manager。禁止调用会追加 `com.ryen.nsd` 的应用专用本地数据目录 API。

  在 setup 中只调用一次 `CodexSnapshotStore::new()`，并显式把该 Arc 注入 manager：

  ```rust
  let snapshot_store = Arc::new(
      CodexSnapshotStore::new(initial_generated_at)
  );

  let runtime = CodexRuntimeManager::new(
      app_handle.clone(),
      paths,
      Arc::clone(&snapshot_store),
  );

  app.manage(runtime);
  ```

  不再单独`manage<CodexSnapshotStore>()`，所有命令经Manager的`snapshot_store()`取得同一入口；不得在Runtime start/stop时remove/re-manage或替换Store。setup fixture用构造计数器断言整个setup只调用一次`CodexSnapshotStore::new()`。manager本阶段不调用`ensure_started()`，构造facts为runtimeGeneration=None、authenticatedGeneration=None、serviceState=stopped、hookState=unknown、phase=disabled。04B-3静态inspection才精确派生not_installed/awaiting_trust/partial/config_conflict/disabled并决定是否start。

  每次 start 先清空 authenticatedGeneration/lastEventAt/sources/errorCode/port/fallback，再分配并捕获 generation；HTTP/Actor 创建成功后设 current generation，失败保持 None。固定端口或 fallback 启动成功为 listening；`record_authenticated_event(reported_generation, source, received_at)` 先比较 current generation，只有相等才记录 authenticatedGeneration/lastEventAt/sources 并允许 active/running；旧 generation 直接返回。模拟 self-check 不能进入 running。任何 mutex guard 都不得跨 publisher 回调或 I/O await。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  Pop-Location
  ```

  预期：manager 幂等启停、同一路径对象、dormant setup、监听状态和 phased shutdown 测试通过；没有应用启动即监听的行为。

- [ ] **步骤 4：实现 Tauri 2.11.5 同步回调到异步 shutdown 的桥接**

  把 `Builder::run(context)` 拆成 `Builder::build(context)` 与 `App::run(callback)`。第一次收到 `tauri::RunEvent::ExitRequested { code, api, .. }` 时，协调器以 `compare_exchange(false, true, ...)` 只启动一次：先保存 `code.unwrap_or(0)`，调用 `api.prevent_exit()`，再用 `tauri::async_runtime::spawn` 启动关闭任务。关闭任务用 `tokio::time::timeout(Duration::from_secs(2), runtime.shutdown())` 包围完整顺序；成功或超时都设置 `shutdown_finished=true`，最后调用 `app_handle.exit(saved_code)`。

  第二次 ExitRequested 若 finished=true 则不调用 prevent，让 Tauri 真正退出；若 started=true/finished=false，则继续 prevent 且不创建第二个任务。本项目首版不实现第二次强制退出 UI。`RunEvent::Exit` 只调用 `runtime.cleanup_owned_discovery_file_sync()`，内部只能使用当前 handle 保存的 `DiscoveryOwner` 调用 `remove_discovery_if_owned()`，不 spawn、不 await、不阻塞；文件损坏或 owner 已替换只记录 warning。若请求为 Tauri restart code，记录受 Tauri “prevent ignored for restart”语义限制的安全诊断码，不宣称能延迟 restart。

  托盘 handler 必须使用回调参数 `app_handle.exit(0)`；`register_main_window_close_handler()` 与 `register_widget_window_close_handler()` 继续只执行 `prevent_close() + hide()`。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::exit_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  cargo test -p netspeed-dynamic --lib
  Pop-Location
  rg -n "std::process::exit" src-tauri/src/lib.rs
  ```

  预期：首次 prevent、只启动一次、完成/超时后二次 exit、第二次请求不重复 shutdown、托盘统一路径、窗口 hide 不 shutdown 和 Exit 同步兜底全部通过；`lib.rs` 不再直接调用 process exit。

- [ ] **步骤 5：阶段二全量验证并提交**

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
  rg -n 'join\("CodePulse"\)|join\("runtime"\)|join\("bin"\)' src-tauri/src/codex --glob '!paths.rs' --glob '!paths_tests.rs'
  git diff --check
  git diff --name-only
  ```

  预期：前端基线、Rust workspace、Clippy、格式、路径唯一性和退出测试全部通过；变更只在本阶段清单及 Cargo 自动锁文件；没有 UI、Hook 配置或自动启动 runtime。

  建议提交信息：

  ```text
  管理 Codex Runtime 与 Tauri 安全退出
  ```

## 阶段二完成门禁

- 聚合器无 Tauri/Tokio 定时器依赖，所有分钟级行为用 ManualClock 瞬时验证；墙上时间正反跳变不会改变平滑、保留、提醒或中断边界。
- 聚合器只产生 `CodexStateDraft`/`CodexSoftInterruptDraft`，不含公开 revision；进程级 `CodexSnapshotStore` 是唯一 revision 分配者，Store 不随 Runtime 重启。
- 并发输入只由单Actor按实际接收顺序改状态；2048 eventId投递去重与2048逻辑事件去重都由Actor独占且有界。同一逻辑事件不同eventId只处理一次，不同turnId/toolUseId/agentId不误去重；retired turnId、toolUseId关联和agentId计数全部有测试；当前轮次`occurredAt`回拨不会丢事件。
- 中间命令失败不会直接成为最终失败；Stop 证据不明确且最后操作失败时默认完成并标记未解决问题。
- 普通状态一秒平滑；授权/失败/完成/中断立即生效；提醒不会在同周期重复。
- 完成精确保留 5 分钟、失败只手动清除、新轮次清旧失败、10/30 分钟中断、授权不超时。
- 三个事件、五个命令和公开 DTO 命名与总体路线图一致，公开状态不含 cwd/token/原始 Hook 正文。
- Runtime 在阶段二 setup 后保持 dormant；`get_codex_snapshot()` 仍成功返回 revision=0 空快照，dormant clear 不产生 service_error。只有 `ensure_started(reason)` 能启动，`stop_if_unused(reason)` 能在卸载/失败/inspection 不允许时停止，显示偏好不能启停服务。
- `CodexRuntimeManager::new(app, paths, snapshot_store)` 显式接收唯一 Store；setup 只构造一次 Store且只 manage Manager，Actor、stop、restart 与 dormant 命令均通过同一 Arc，`Arc::ptr_eq`、构造计数和命令入口测试通过。
- 同一 Store 中验证 revision=20 → stop/clear=21 空快照 → 新 Runtime 首任务>21；Runtime A stop 后 Runtime B 不从 1 开始。
- 每个 Runtime 使用新的非零 generation、token、Actor/reporter 和 DiscoveryOwner；新 Runtime 清空认证事实，只有 authenticatedGeneration==runtimeGeneration 才 running；旧 Actor 晚到上报/关闭回调被忽略。
- 所有 stop 原因按“停止接收 → owner-aware 关闭旧 Runtime → Store.clear/发布空快照 → 发布 listening status”执行；Discovery 删除完整比较 version/PID/token/startedAt，第二个 Runtime 不受第一个清理影响。
- 首次 ExitRequested 同步 prevent 并只 spawn 一次两秒 shutdown；完成或超时后由 `AppHandle::exit(saved_code)` 触发第二次退出；RunEvent::Exit 只做 owner-aware 同步发现文件兜底；托盘退出走相同路径，隐藏窗口不触发 shutdown。
- 以上全部满足后才执行阶段三；不要自动进入阶段三。
