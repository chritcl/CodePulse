# 阶段四 A：Codex Integration Inspection 与 Planner 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 只读检查 Codex Home、企业策略、Hook 表示、CodePulse marker 与 Bridge 状态，派生 listening phase/runtime 启动决策，并生成不写盘的 install/repair/uninstall 计划和安全预览。

**架构：** `inspection.rs` 只读取 `CodexIntegrationPaths` 指向的文件并产生结构化事实；`status.rs` 用 inspection 与 runtime facts 纯派生 `CodexListeningStatus`；`plan.rs` 对完整解析树做语义增删并产生 `PreparedCodexHookChange`。本批次不引入 writer、installer、Tauri apply 或 Vue UI。

**技术栈：** Rust 2021、serde_json、toml_edit 0.25、sha2、tempfile；不新增前端依赖。

## 全局约束

- 前置门禁：阶段一至三全部通过；阶段四总览已 review。
- 只消费阶段一 `CodexIntegrationPaths`，禁止重新拼接 CodePulse/runtime/bin。
- 真实 `%USERPROFILE%\.codex` 与 `%ProgramData%` 只能读；全部自动测试使用 TempDir。
- `features.hooks=false` 时 install/repair planner 返回 HooksDisabled；不产生 PreparedCodexHookChange。
- 企业托管禁用时返回 ManagedDisabled；不引导修改企业文件。
- 不创建自建 Dispatcher；planner 在 Codex 原生多 Hook 表示上逐项保留用户原 Hook，只增删带 CodePulse marker 的条目。
- `modified` 允许后续 runtime 启动但 phase 必须 partial，planner 只能通过显式 Repair 处理。
- 每个任务完成后可单独 review；本计划门禁完成后停止，不自动进入 04B。

---

## 任务 1：实现只读表示方式、Hooks feature 与 marker inspection

**独立交付物：** 任意合法/损坏的临时 Codex Home 都能在零写入前提下得到确定的表示方式、feature、CodePulse marker 与 Bridge 状态。

**Files:**

- Modify: `src-tauri/Cargo.toml`（新增 `toml_edit = "0.25"`；测试继续使用 tempfile）
- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/types.rs`
- Create: `src-tauri/src/codex/integration/inspection.rs`
- Create: `src-tauri/src/codex/integration/inspection_tests.rs`
- Create: `src-tauri/src/codex/integration/fixtures/hooks-existing.json`
- Create: `src-tauri/src/codex/integration/fixtures/config-inline-hooks.toml`
- Create: `src-tauri/src/codex/integration/fixtures/requirements-hooks-disabled.toml`
- Modify: `src-tauri/Cargo.lock`（只由 Cargo 生成）

**消费接口：** `CodexIntegrationPaths` 的 12 个字段、`CODEX_PROTOCOL_VERSION`、编译期 `CODEPULSE_TARGET_TRIPLE`、安装包/稳定 EXE SHA-256。

**产生接口：**

```rust
pub enum CodexHookRepresentation { HooksJson, ConfigToml, None, Conflict }
pub enum CodexHooksFeature { Enabled, Disabled, ManagedDisabled }
pub enum ManagedEntryState { Absent, Exact, Modified, Duplicate }
pub enum CodePulseMarkerPresence { Absent, Present, Ambiguous }
pub enum BridgeState { Missing, Current, Outdated, Modified }

pub struct BridgeInstallRecord {
    pub version: u16,
    pub protocol_version: u16,
    pub target_triple: String,
    pub resource_sha256: String,
    pub installed_sha256: String,
    pub installed_at: i64,
}

pub struct CodexIntegrationFacts {
    pub codex_home: String,
    pub feature_config_path: String,
    pub representation: CodexHookRepresentation,
    pub config_path: Option<String>,
    pub config_digest: Option<String>,
    pub hooks_feature: CodexHooksFeature,
    pub managed_entry: ManagedEntryState,
    pub marker_presence: CodePulseMarkerPresence,
    pub bridge_state: BridgeState,
    pub issues: Vec<String>,
}

pub fn inspect_codex_environment(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationFacts, CodexIntegrationError>;
```

- [ ] **步骤 1：先写 inspection 零副作用失败测试**

  每例使用四个 TempDir 根构造 `CodexIntegrationPaths`。调用前后递归记录路径、长度、mtime 和 SHA-256，覆盖两文件都不存在、普通 config 无 hooks、仅 JSON Hooks、仅 TOML Hooks、两边都有、JSON/TOML 损坏、UTF-8 BOM、非 UTF-8。每例断言目录与字节完全不变；inspection 不创建 codepulse_root/runtime/bin。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests::read_only -- --nocapture
  Pop-Location
  ```

  预期：integration 类型和 inspection 不存在，测试编译失败。

- [ ] **步骤 2：先写 feature、marker 和 Bridge 状态失败测试**

  覆盖本地默认 enabled、本地 `[features].hooks=false` 为 disabled、企业 requirements 强制 false 或 managed-only 为 managed_disabled；CodePulse 条目按 `--codepulse-hook-v1` marker 区分 absent/exact/modified/duplicate，缺事件、超时不同、路径不同和额外 statusMessage 都是 modified；无法完整解析时 markerPresence=ambiguous。Bridge 覆盖 missing/current/outdated/modified，并断言所有路径都来自同一个 paths 对象。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests::states -- --nocapture
  Pop-Location
  ```

  预期：状态识别尚未实现，测试失败。

- [ ] **步骤 3：实现完整解析和只读事实提取**

  JSON 用 `serde_json::Value` 完整解析并保留未知字段；TOML 用 `toml_edit::DocumentMut` 只读遍历，同时接受 `command_windows`/`commandWindows`。用户 CodePulse handler 只按 marker 识别，再比较八事件、绝对稳定路径、timeout=2 和禁止字段。`issues` 只包含稳定代码与中文短句，不含配置正文、token、完整命令或用户路径正文。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests -- --nocapture
  Pop-Location
  ```

  预期：表示、feature、marker、Bridge 与零副作用测试全部通过。

- [ ] **步骤 4：验证唯一路径消费并提交**

  运行：

  ```powershell
  rg -n 'join\("CodePulse"\)|join\("runtime"\)|join\("bin"\)' src-tauri/src/codex/integration
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  git diff --check
  ```

  预期：路径拼接搜索无命中；inspection 只消费 paths 字段；格式与 Clippy 通过。

  建议提交信息：

  ```text
  检测 Codex Hook 与 Bridge 集成事实
  ```

---

## 任务 2：纯派生 Listening Status 与 Runtime 启动决策

**独立交付物：** 相同 inspection/runtime facts 必然产生相同用户状态和 startup decision；显示偏好不参与决策。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/status.rs`
- Create: `src-tauri/src/codex/integration/status_tests.rs`

**消费接口：** 任务 1 `CodexIntegrationFacts`、阶段二 `CodexListeningStatus`、`CodexRuntimeStartReason`、`CodexRuntimeStopReason`。

**产生接口：**

```rust
pub struct CodexRuntimeFacts {
    pub service_state: CodexServiceState,
    pub port: Option<u16>,
    pub using_fallback_port: bool,
    pub authenticated_current_process: bool,
    pub last_event_at: Option<i64>,
    pub sources: Vec<CodexSource>,
    pub error_code: Option<String>,
}

pub struct CodexIntegrationInspection {
    pub codex_home: String,
    pub feature_config_path: String,
    pub representation: CodexHookRepresentation,
    pub config_path: Option<String>,
    pub config_digest: Option<String>,
    pub hooks_feature: CodexHooksFeature,
    pub managed_entry: ManagedEntryState,
    pub marker_presence: CodePulseMarkerPresence,
    pub bridge_state: BridgeState,
    pub hook_state: CodexHookState,
    pub phase: CodexListeningPhase,
    pub issues: Vec<String>,
}

pub enum CodexRuntimeStartupDecision {
    Start(CodexRuntimeStartReason),
    RemainStopped(CodexRuntimeStopReason),
}

pub fn combine_codex_integration_inspection(
    facts: CodexIntegrationFacts,
    runtime_facts: &CodexRuntimeFacts,
) -> CodexIntegrationInspection;

pub fn inspect_codex_integration_state(
    paths: &CodexIntegrationPaths,
    runtime_facts: &CodexRuntimeFacts,
) -> Result<CodexIntegrationInspection, CodexIntegrationError>;

pub fn derive_codex_listening_status(
    inspection: &CodexIntegrationInspection,
    runtime_facts: &CodexRuntimeFacts,
) -> CodexListeningStatus;

pub fn derive_startup_runtime_decision(
    inspection: &CodexIntegrationInspection,
) -> CodexRuntimeStartupDecision;
```

- [ ] **步骤 1：先写七 phase 派生失败测试**

  表格覆盖：exact+真实当前进程事件+listening => running；exact 无真实事件 => awaiting_trust；modified、duplicate、Bridge missing/outdated 且 marker present => partial；解析/双表示冲突 => config_conflict；服务启动失败 => service_error；absent => not_installed；本地 disabled 与 managed disabled => disabled。managed disabled 仍由 inspection.hooksFeature 区分，设置页据此显示组织策略。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::status_tests::phase -- --nocapture
  Pop-Location
  ```

  预期：派生函数不存在，测试失败。

- [ ] **步骤 2：先写 startup decision 失败测试**

  覆盖 exact => Start(StartupInspection)；modified => Start(StartupInspection) 且 phase=partial；partial+marker present => Start；not_installed、disabled、managed disabled、任意 config_conflict、已卸载 => RemainStopped(StartupInspectionDisallows)。无法安全识别 marker 的 conflict 不得被派生为 partial。额外传入 idlePersistent=true/false 的 UI fixture，断言函数签名没有该参数且结果不变。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::status_tests::runtime -- --nocapture
  Pop-Location
  ```

  预期：startup decision 测试失败。

- [ ] **步骤 3：实现确定的优先级表**

  派生顺序固定为：服务 Error → service_error；feature Disabled/ManagedDisabled → disabled；representation Conflict/marker Ambiguous → config_conflict；entry Absent → not_installed；entry Modified/Duplicate 或 Bridge 非 Current → partial；entry Exact 且当前进程已有真实事件 → running；其余 Exact → awaiting_trust。startup decision 只读 inspection marker/entry/feature/phase，不读取 localStorage，不写文件，不调用 manager。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::status_tests -- --nocapture
  Pop-Location
  ```

  预期：七 phase 与所有 runtime start/stop 决策测试通过。

- [ ] **步骤 4：提交纯状态派生**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n "localStorage|idlePersistent|ensure_started|stop_if_unused" src-tauri/src/codex/integration/status.rs
  git diff --check
  ```

  预期：纯状态模块没有 UI 偏好、I/O 或 manager 调用。

  建议提交信息：

  ```text
  派生 Codex 监听状态与启动决策
  ```

---

## 任务 3：生成不写盘的 Hook 变更计划与预览

**独立交付物：** install/repair/uninstall 对 JSON/TOML 产生确定的目标字节、摘要和警告；用户其他 Hook 语义完整保留；HooksDisabled 不产生 prepared plan。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/hooks_json.rs`
- Create: `src-tauri/src/codex/integration/hooks_toml.rs`
- Create: `src-tauri/src/codex/integration/plan.rs`
- Create: `src-tauri/src/codex/integration/plan_tests.rs`

**消费接口：** 任务 1 inspection、固定八事件、`paths.installed_bridge`、任务 2 runtime decision；不消费 writer/installer/runtime manager。

**产生接口：**

```rust
pub enum CodexHookAction { Install, Repair, Uninstall }
pub enum WritableHookRepresentation { HooksJson, ConfigToml }
pub enum BridgeAction { Install, Update, Keep, Remove }

pub struct CodexHookChangePreview {
    pub action: CodexHookAction,
    pub representation: WritableHookRepresentation,
    pub config_path: String,
    pub expected_digest: String,
    pub preview_digest: String,
    pub changes: Vec<String>,
    pub warnings: Vec<String>,
    pub bridge_action: BridgeAction,
}

pub struct PreparedConfigFileChange {
    pub path: PathBuf,
    pub expected_raw_digest: String,
    pub target_bytes: Vec<u8>,
    pub existed: bool,
}

pub struct PreparedCodexHookChange {
    pub preview: CodexHookChangePreview,
    pub files: Vec<PreparedConfigFileChange>,
}

pub fn prepare_codex_hook_change(
    action: CodexHookAction,
    paths: &CodexIntegrationPaths,
    inspection: &CodexIntegrationInspection,
) -> Result<PreparedCodexHookChange, CodexIntegrationError>;
```

稳定错误码至少包含 `HooksDisabled`、`ManagedDisabled`、`ConfigConflict`、`UseRepair`、`NoManagedEntry`。

- [ ] **步骤 1：先写 JSON/TOML 语义保留失败测试**

  JSON 覆盖八事件 exact 安装、重复 install no-op、repair 缺项/旧路径/重复 marker、uninstall 精确删除 marker handler；TOML 覆盖同样动作并断言非 hooks 注释、键顺序、字符串和数组文本保持。两种表示都断言用户 handler 深度相等，卸载不恢复备份。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::representations -- --nocapture
  Pop-Location
  ```

  预期：planner 和文档变换器不存在，测试失败。

- [ ] **步骤 2：先写 HooksDisabled 与企业禁用失败测试**

  固定序列：`features.hooks=false` → preview install 返回 HooksDisabled → 不创建 PreparedCodexHookChange → 文件系统快照不变。用户手动把 config.toml 改为 hooks=true 后重新 inspect，才允许生成 install preview。ManagedDisabled 对 install/repair/uninstall 都返回 ManagedDisabled，不产生修改计划，不引导写 enterprise 文件。本批次不引用 installer/runtime；零 Bridge 写入和零 HTTP 启动由 04B 命令边界测试覆盖。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::disabled -- --nocapture
  Pop-Location
  ```

  预期：旧行为若会计划修改 feature flag，该测试必须失败。

- [ ] **步骤 3：先写摘要、选择和 modified 失败测试**

  覆盖 none+install 选择 hooks.json；单一现有表示沿用；双表示/解析冲突拒绝；modified install 返回 UseRepair，显式 repair 才产生警告和计划；uninstall absent 返回 NoManagedEntry。相同输入 previewDigest 稳定，action、任一决策输入或 target hash 变化都会改变摘要；preview 不含用户 command、token、配置正文或 target bytes。`files` 在首版最多包含一个 Hook 主文件，不得为了开启全局 Hooks 加入 config.toml；writer 的多文件能力留给未来合法场景。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::preview -- --nocapture
  Pop-Location
  ```

  预期：选择、modified 和摘要测试失败。

- [ ] **步骤 4：实现纯文档变换与确定摘要**

  JSON 规范化为 2 空格 UTF-8 without BOM 并在 warnings 说明空白变化；TOML 只用 toml_edit 节点增删。`expectedDigest` 覆盖 hooks.json、config.toml、requirements、打包/稳定 Bridge 与安装记录的路径、存在性和原始 SHA-256；`previewDigest` 覆盖 action、representation、expectedDigest、目标 path/hash、bridgeAction、changes/warnings 的规范 JSON。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests -- --nocapture
  Pop-Location
  ```

  预期：配置保留、disabled 拒绝、选择和摘要测试全部通过，测试前后无新增文件。

- [ ] **步骤 5：完成 04A 门禁并停止**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::status_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::plan_tests -- --nocapture
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets --all-features -- -D warnings
  Pop-Location
  rg -n "MoveFileExW|apply_codex_hook_change|CodexStatusSettingsCard|ensure_started\(" src-tauri/src/codex/integration src
  git diff --check
  git diff --name-only
  ```

  预期：TempDir inspection/planner 全部通过；范围搜索无 writer/installer/Tauri apply/Vue/runtime 调用；真实用户配置无写入。随后停止等待 04A review。

  建议提交信息：

  ```text
  生成 Codex Hook 安装修复纯计划
  ```

## 04A 完成门禁

- inspection 对用户与企业配置只读，路径全部来自 CodexIntegrationPaths。
- representation、feature、marker、Bridge、phase 和 runtime startup decision 有完整 TempDir 表格测试。
- exact/modified/partial+marker 与停止条件精确；idlePersistent 不参与。
- HooksDisabled 不创建 PreparedCodexHookChange；用户手动启用并重新 inspect 后才允许 preview。
- 用户其他 Hook 语义保留；modified 只能显式 Repair；无 writer、installer、Tauri apply 或 Vue UI。
- 全部通过后停止，未经 review 不得执行 04B。
