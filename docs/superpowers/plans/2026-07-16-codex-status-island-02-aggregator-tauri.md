# 阶段二：可测试聚合器、顺序 Actor 与 Tauri 生命周期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把阶段一的无状态事件流聚合为权威任务快照，实现优先级、去重、乱序过滤、平滑显示、完成/失败/中断生命周期，并让 HTTP 服务可靠跟随 Tauri 启动和退出。

**架构：** `CodexAggregator<C: Clock>` 是不依赖 Tokio/Tauri 的纯状态对象；`ClockReading` 同时提供只用于公开时间戳的 Unix 墙上毫秒和只用于状态转换的进程内单调毫秒；一个 Actor 独占聚合器与阶段一 Receiver，通过一秒 Tick 驱动所有时间规则；可注入 publisher 把完整快照和边沿提醒映射为 Tauri 事件。`CodexRuntimeManager` 统一持有 HTTP handle、Actor handle、监听状态和关闭流程。

**技术栈：** Rust 2021、Tokio mpsc/oneshot/interval、serde、Tauri 2、阶段一 `codex-protocol` 与 HTTP runtime；不新增生产依赖。

**前置条件：** 阶段一完成门禁全部通过；Bridge/HTTP wire 类型不得在本阶段复制或改名。

**本阶段消费：** `CodexEventReceiver`、`CodexBridgeEvent`、`start_codex_http()`、`CodexHttpHandle`。

**本阶段产生：** `CodexStateSnapshot`、`CodexListeningStatus`、`CodexSelfCheckResult`、五个 Tauri 命令、三个 Tauri 事件、跟随应用生命周期的 `CodexRuntimeManager`。阶段三只能消费这些公开契约，不能读取聚合器内部记录。

---

## 任务 1：定义公开状态、可注入时钟与 Stop 保守分类器

**独立交付物：** 阶段三所需 Rust DTO 已稳定；所有时间常量和 Stop 判定可在无异步运行时环境单独测试。

**Files:**

- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/types.rs`
- Create: `src-tauri/src/codex/clock.rs`
- Create: `src-tauri/src/codex/classifier.rs`
- Create: `src-tauri/src/codex/types_tests.rs`
- Create: `src-tauri/src/codex/classifier_tests.rs`

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
```

所有 serde 输出使用 camelCase/route 所需 snake_case enum。公开 `CodexTaskState` 不含 `cwd`、eventId、原始响应、内部计时字段或子智能体 ID 集合。

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

- [ ] **步骤 2：先写 Stop 分类失败测试**

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

- [ ] **步骤 3：实现最小类型、手动时钟和保守分类**

  `ManualClock` 用共享原子值分别保存墙上毫秒与单调毫秒，`advance_ms()` 同时推进两者，`set_wall_time_ms()` 模拟 Windows 校时且不推进单调时间，测试不调用 `sleep`。`SystemClock` 构造时保存一个 `Instant` 基准，`now()` 用 `SystemTime` 读取 Unix 毫秒、用该基准的 elapsed 生成进程内单调毫秒；处理系统时间早于 Unix epoch、Unix 毫秒超出 `i64` 和 elapsed 超出 `u64` 时使用显式饱和转换。`classifier.rs` 只处理脱敏短文本，不读 transcript、不调用模型、不把单次命令失败直接升级为任务失败。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::types_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::classifier_tests -- --nocapture
  Pop-Location
  ```

  预期：所有 DTO、时钟、优先级和 Stop 组合通过，测试耗时不受 5/10/30 分钟常量影响。

- [ ] **步骤 4：静态检查和提交**

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

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 2：实现顺序聚合、会话合并、去重与乱序过滤

**独立交付物：** 纯聚合器可将任意多会话事件流稳定归并为排序后的任务快照；没有定时器和 Tauri 依赖。

**Files:**

- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/aggregator.rs`
- Create: `src-tauri/src/codex/aggregator_tests.rs`

**消费接口：** `CodexBridgeEvent`、任务 1 的 `Clock`/公开类型/`classify_stop()`。

**产生接口：**

```rust
pub struct AggregateEffects {
    pub snapshot_changed: bool,
    pub soft_interrupt: Option<CodexSoftInterrupt>,
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
    pub fn snapshot(&self) -> CodexStateSnapshot;
}
```

内部 `CodexTaskRecord` 允许保存 `cwd`、`last_received_monotonic_ms`、`last_event_occurred_at`、当前/待提交普通阶段、`visible_since_monotonic_ms`、`completed_monotonic_ms`、`attention_expires_monotonic_ms`、`HashSet<agentId>` 和提醒周期标记；这些字段不得序列化到 Vue。公开的 `startedAt`、`lastActivityAt`、`completedAt`、`expiresAt`、`generatedAt` 取同一次 `ClockReading.wall_time_ms`，内部期限和排序只取 `monotonic_ms`。

- [ ] **步骤 1：先写会话与轮次归并失败测试**

  覆盖：SessionStart 不创建活跃卡；首次 UserPromptSubmit 创建；同 session 新 prompt 覆盖卡而非新增；新轮次清除旧失败/中断/操作/子智能体；两个 session 并存；来源 unknown 不影响聚合；任务列表按服务端单调接收顺序倒序；代表任务按固定优先级、同级按单调接收顺序选择。额外让墙上时间先前跳 1 小时、再向后跳 2 小时，断言列表和代表任务顺序不变，但公开时间戳反映新的墙上时间。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::aggregator_tests::session -- --nocapture
  Pop-Location
  ```

  预期：聚合器不存在，测试失败。

- [ ] **步骤 2：先写去重、乱序和子智能体失败测试**

  覆盖：相同 eventId 只处理一次；去重集合上限 2048 且淘汰最旧 ID；同轮 `occurredAt` 较旧事件丢弃；相同时间戳按队列到达顺序处理；PreToolUse 先于同 turnId UserPromptSubmit 到达时先建立“Codex 任务”临时轮次，迟到 prompt 只补摘要且阶段仍为工具阶段；当前 turn 不同、事件较新且 turnId 未退休时建立新临时轮次；新 TurnStarted 可正式确认临时轮次或替换当前轮；最近 8 个退休 turnId 的晚到 Tool/Stop 全部丢弃；第 9 个退休 ID 被有界淘汰；SubagentStart 重复不加二；未知 SubagentStop 不减到负数；新轮次清空 agent ID 集合。

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

  使用 `HashMap<sessionId, CodexTaskRecord>`；一个 `VecDeque + HashSet` 实现 2048 ID 去重。每次 `ingest()` 只调用一次 `clock.now()`：`wall_time_ms` 写入公开 `startedAt/lastActivityAt` 并作为本次 `authenticated_activity.received_at`，`monotonic_ms` 写入内部 `last_received_monotonic_ms` 并用于任务排序。重复 eventId 仍返回 authenticated activity，因为它确实是本次进程收到的已认证请求，但不得再次改变任务；wire `occurredAt` 只用于同轮乱序比较，不能控制排序、超时或保留期限。

  新 TurnStarted 是轮次边界；若工具/授权事件先到，同 turnId 可先建立 `turn_boundary_seen=false` 的临时记录，后到 TurnStarted 只补 taskSummary 并设为 true，不覆盖临时记录的首次服务端接收时间或更新后的可见阶段。真正替换轮次时把旧 turnId 放进最多 8 项的 retired deque；退休轮次的任何晚到事件都丢弃。若缺少 `turnId`，仍以收到 TurnStarted 为新轮边界并清空旧终态。SessionStarted 可缓存 session 元数据，但快照只输出活跃任务。所有 snapshot 构造集中在一个函数，按内部单调接收时间排序后再选代表任务；公开 `lastActivityAt` 不参与排序。

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

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 3：实现一秒平滑、提醒和可测试生命周期

**独立交付物：** 用 `ManualClock` 瞬时验证普通状态最短显示、完成保留、失败保留、10/30 分钟中断、授权不超时和提醒只触发一次。

**Files:**

- Modify: `src-tauri/src/codex/aggregator.rs`
- Modify: `src-tauri/src/codex/aggregator_tests.rs`
- Create: `src-tauri/src/codex/lifecycle_tests.rs`

**消费接口：** 任务 2 的 `ingest()`/`tick()` 与任务 1 时间常量。

**产生接口：** `AggregateEffects.soft_interrupt` 与快照中的 `CodexAttention`。软提醒结构固定为：

```rust
pub struct CodexSoftInterrupt {
    pub attention_id: u64,
    pub session_id: String,
    pub reason: CodexSoftInterruptReason,
    pub expires_at: i64,
    pub revision: u64,
}
```

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

  `ingest()` 对关键态立即提交；普通态根据 `visible_since_monotonic_ms` 决定立即提交或替换 pending。`tick()` 按固定顺序执行：提交到期 pending、删除到期 completed、检测活动任务中断、过期非授权 attention、重新计算代表任务/快照 revision。每次调用只取一次 `clock.now()` 并把同一个 `ClockReading` 传给本次全部转换，避免一次转换混用两个时刻。

  中断阈值基于内部 `last_received_monotonic_ms`；完成删除基于 `completed_monotonic_ms`；普通阶段、提醒期限分别基于 `visible_since_monotonic_ms`、`attention_expires_monotonic_ms`。等待授权与终态不进入中断扫描。新事件清除本次中断提醒标记，重复同状态事件只更新活动时间。revision 仅在公开快照字段变化时递增；`generatedAt` 变化本身不触发事件。所有公开时间戳用本次 reading 的墙上时间计算，任何状态转换都禁止比较墙上时间。

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

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 4：实现单 Actor、权威快照命令与 Tauri 事件

**独立交付物：** 并发 HTTP 事件、Tick 和 UI 命令都被一个 Actor 顺序处理；Vue 可查询完整快照并接收三类事件，清除操作有确定返回值。

**Files:**

- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/actor.rs`
- Create: `src-tauri/src/codex/publisher.rs`
- Create: `src-tauri/src/codex/commands.rs`
- Create: `src-tauri/src/codex/actor_tests.rs`
- Create: `src-tauri/src/codex/commands_tests.rs`
- Modify: `src-tauri/src/lib.rs`（`use codex::commands::*` 与 `generate_handler!` 的 Codex 命令区域）

**消费接口：** 阶段一 `CodexEventReceiver`；任务 3 `CodexAggregator` 和 effects。

**产生接口：**

```rust
pub enum CodexActorCommand {
    Tick,
    GetSnapshot { reply: oneshot::Sender<CodexStateSnapshot> },
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
    fn record_authenticated_event(&self, source: CodexSource, received_at: i64);
}
```

事件固定为 `codex-state-changed`、`codex-soft-interrupt`、`codex-listening-status-changed`；publisher 使用 `AppHandle::emit`，测试使用内存 publisher。

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

  用容量 256 的 event channel 并发发送多个 session，同时交错 GetSnapshot、ClearTask 和显式 `CodexActorCommand::Tick`；断言 publisher 收到 revision 单调递增的完整快照，最终快照与顺序参考模型相同。软提醒只发 `codex-soft-interrupt` 一次，但对应状态也必须已经出现在同 revision 或更早的完整快照。每个从已认证 HTTP 队列取出的事件都把 `AggregateEffects.authenticated_activity` 转交 activity reporter 一次，包括被 eventId 去重的重投；GetSnapshot、自检和 Tick 不得调用。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::actor_tests -- --nocapture
  Pop-Location
  ```

  预期：Actor/publisher 不存在，测试失败。

- [ ] **步骤 2：先写清除和命令失败测试**

  覆盖：只允许清除 failed/interrupted；清除 active/completed/unknown session 返回稳定错误码；清除全部失败不删中断；每个命令返回处理后的权威快照；Actor 关闭后命令快速返回错误；self-check 精确返回服务/发现文件/队列三项且不发送伪 Codex 事件。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::commands_tests -- --nocapture
  Pop-Location
  ```

  预期：命令与 manager state 尚未实现，测试失败。

- [ ] **步骤 3：实现 `tokio::select!` 顺序循环**

  Actor 同时选择 event receiver、命令 receiver、一秒 `interval` 与 shutdown；所有分支只调用同一个聚合器实例。interval 使用 `MissedTickBehavior::Skip`，防止恢复后批量重放过期 Tick。每个 event 分支只调用一次 `aggregator.ingest(event)`，随后把 effects 中的 `authenticated_activity` 转交 `CodexActivityReporter`；reporter 不再读取第二个时钟，只更新 `lastEventAt/sources/hookState/phase` 并发布完整监听状态。每次 effects 先发布完整快照，再发布 soft interrupt；重复 revision 不发布状态事件。

  publisher 错误只记错误码，不终止 Actor。snapshot 查询使用 oneshot，不让命令直接锁内部 HashMap；这样并发命令不会绕过事件顺序。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::actor_tests -- --nocapture
  Pop-Location
  ```

  预期：事件、显式 Tick 和命令按 Actor 接收顺序处理；每个认证事件只上报一次 activity；快照先于同 revision 的 soft interrupt 发布；Actor 测试通过。

- [ ] **步骤 4：实现 Tauri 命令并注册**

  `commands.rs` 从 `State<CodexRuntimeManager>` 取得 Actor handle。所有外部错误映射为不含路径、token 或正文的稳定中文信息；内部测试额外断言错误代码。`lib.rs` 只新增模块 import 和五个 handler 名称，不调整现有命令顺序或职责。

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

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 5：让 HTTP/Actor 跟随 Tauri 启动、退出和异常清理

**独立交付物：** 应用启动后异步进入监听；隐藏任一窗口不停止服务；托盘退出和正常 Tauri 退出都等待服务/Actor 清理；启动失败不阻止 CodePulse 其他功能。

**Files:**

- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/service.rs`
- Create: `src-tauri/src/codex/service_tests.rs`
- Modify: `src-tauri/src/lib.rs`（`run()` builder/build/run 区域、`initialize_app()`、`create_system_tray()` 的 quit handler）

**消费接口：** `start_codex_http()`、`CodexHttpHandle::shutdown()`、Actor start/shutdown、publisher、`app.path().local_app_data_dir()`。

**产生接口：**

```rust
pub struct CodexRuntimeManager;

impl CodexRuntimeManager {
    pub fn new(app: tauri::AppHandle) -> Self;
    pub async fn start(&self) -> Result<(), CodexRuntimeError>;
    pub async fn shutdown(&self) -> Result<(), CodexRuntimeError>;
    pub async fn listening_status(&self) -> CodexListeningStatus;
}
```

`start()`/`shutdown()` 都必须幂等。manager 内部状态机固定为 `Stopped -> Starting -> Running -> Stopping -> Stopped`，错误转 `Error`；不向 Vue 暴露内部枚举。

- [ ] **步骤 1：先写生命周期失败测试**

  通过注入 fake server/actor/publisher 覆盖：start 顺序为 event channel → actor → HTTP；重复 start 不创建第二 listener；HTTP 启动失败会关闭 actor、状态变 service_error 且不向上 panic；shutdown 顺序先拒绝新 HTTP、再关闭 event sender/actor；重复 shutdown 成功；shutdown 后发现文件删除；窗口 hide 不调用 shutdown。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  Pop-Location
  ```

  预期：service manager 尚未实现，测试失败。

- [ ] **步骤 2：先写监听状态转换失败测试**

  覆盖：构造时明确为 `serviceState=stopped`、`hookState=unknown`、`phase=disabled`；start 中只把 serviceState 改为 `starting`，用户可见 phase 仍为七种之一；固定端口成功与 fallback 都为 `listening`，fallback 只设置 `usingFallbackPort=true`，不是故障；第一条认证事件记录 `lastEventAt/sources` 并变为 `active/running`；服务错误变为 `error/service_error`；状态每次改变发布完整事件且不暴露 token。阶段四 inspection 才能把 unknown 精确派生为 not_installed、awaiting_trust、partial、conflict 或 disabled。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::service_tests::status -- --nocapture
  Pop-Location
  ```

  预期：状态转换测试失败。

- [ ] **步骤 3：实现 manager 并接入 `initialize_app()`**

  在 `initialize_app()` 中先 `app.manage(CodexRuntimeManager::new(app.handle().clone()))`，再通过 `tauri::async_runtime::spawn` 调用幂等 start；绑定/发现文件失败只更新监听状态并发布 `codex-listening-status-changed`，不能让 `initialize_app()` 返回错误而中止音乐、托盘或窗口。

  manager 的 runtime_dir 固定为 `app.path().local_app_data_dir()?.join("CodePulse").join("runtime")`，与 Bridge 约定完全一致。manager 创建线程安全的 `CodexListeningStatusStore` 并作为 activity reporter 注入 Actor；第一条队列事件把 hookState/phase 改为 active/running，累积去重后的来源集合。状态更新和 runtime parts 使用 Tokio mutex；任何 mutex guard 都不能跨 publisher 回调或长 I/O await。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::service_tests::start -- --nocapture
  cargo test -p netspeed-dynamic codex::service_tests::status -- --nocapture
  Pop-Location
  ```

  预期：幂等启动、启动失败回收、runtime_dir、监听状态和第一条真实事件转换测试通过；退出路径测试仍保持红色，留给下一步改造 `run()` 和托盘退出。

- [ ] **步骤 4：改造 Tauri 退出而不改变窗口关闭语义**

  把当前直接调用的 `Builder::run(tauri::generate_context!())` 拆为 `Builder::build(tauri::generate_context!())`，再调用 `app.run` 并在回调中匹配 `RunEvent`。在 `RunEvent::ExitRequested` 触发一次带 2 秒上限的 manager shutdown；`RunEvent::Exit` 只做无等待兜底清理。托盘 quit handler 从 `std::process::exit(0)` 改为 `app_handle.exit(0)`，使 ExitRequested 能执行。

  `register_main_window_close_handler()` 与 `register_widget_window_close_handler()` 保持 `prevent_close() + hide()`，不能在窗口关闭请求中停服务。若 2 秒关闭期限到达，记录安全错误码后允许进程退出；残留发现文件由 Bridge 的 PID/连接校验识别。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  cargo test -p netspeed-dynamic --lib
  Pop-Location
  rg -n "std::process::exit" src-tauri/src/lib.rs
  ```

  预期：生命周期与现有测试全部通过；`lib.rs` 不再直接 `process::exit`。

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
  git diff --check
  git diff --name-only
  ```

  预期：前端基线、Rust workspace、Clippy 和格式全部通过；变更只在本阶段清单及 Cargo 自动锁文件；没有 UI 或 Hook 配置实现。

  建议提交信息：

  ```text
  管理 Codex 服务的 Tauri 启停生命周期

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

## 阶段二完成门禁

- 聚合器无 Tauri/Tokio 定时器依赖，所有分钟级行为用 ManualClock 瞬时验证；墙上时间正反跳变不会改变平滑、保留、提醒或中断边界。
- 并发输入只由单 Actor 改状态；2048 去重、turnId 与 occurredAt 乱序规则全部有测试。
- 中间命令失败不会直接成为最终失败；Stop 证据不明确且最后操作失败时默认完成并标记未解决问题。
- 普通状态一秒平滑；授权/失败/完成/中断立即生效；提醒不会在同周期重复。
- 完成精确保留 5 分钟、失败只手动清除、新轮次清旧失败、10/30 分钟中断、授权不超时。
- 三个事件、五个命令和公开 DTO 命名与总体路线图一致，公开状态不含 cwd/token/原始 Hook 正文。
- HTTP 和 Actor 跟随应用启动；托盘退出走正常 Tauri 生命周期；隐藏窗口不停止监听。
- 以上全部满足后才执行阶段三；不要自动进入阶段三。
