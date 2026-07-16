# 阶段四：Codex Hook 安全接入总览与审核索引

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement exactly one reviewed batch at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把阶段四拆为三个可独立拒绝、验收和回滚的审核批次，在不破坏用户 Hook、不自动开启全局 Hooks 的前提下完成只读检查、配置写入、Bridge 安装、设置页和真实端验收。

**架构：** 04A 只读文件并产生 Feature 标准键/弃用别名事实、标准 JSON/TOML Fixture、静态 inspection、generation-aware listening 派生和 planner 结果；04B 才负责统一 Integration Transaction Journal、两个内部事务句柄、跨进程恢复、完整 PE installer、Tauri commands、唯一 SnapshotStore 清空和 generation/owner-aware runtime 生命周期；04C 只消费公开命令与唯一动态 `CodexListeningStatus` 完成 UI、显示偏好和 E2E。三个批次严格串行，每个批次完成后停止等待 review。

**技术栈：** Rust、serde_json、toml_edit 0.25、sha2、Windows `MoveFileExW`、Tauri 2.11.5、Vue 3、Pinia/localStorage、Vitest、PowerShell；不新增前端生产依赖。

## 全局约束

- 本总览只索引阶段四，不承载可直接实施的混合任务。
- 所有模块消费阶段一唯一的 `CodexIntegrationPaths`；不得自行拼接 CodePulse/runtime/bin。
- 本地数据根目录由 `app.path().local_data_dir()?` 获得，再由路径对象生成 `%LOCALAPPDATA%\CodePulse`。
- 应用启动顺序固定为：构造路径对象与唯一 `Arc<CodexSnapshotStore>`并显式注入 Manager → 恢复 Integration Transaction → 只读静态 inspection → inspection 决定 runtime 启停 → 单独派生并发布 listening status。
- `features.hooks=false` 时 install/repair 禁止；marker absent 只展示手动开启引导；有安全 marker 时允许预览/确认精确 uninstall，且不安装 Bridge、不启动 HTTP。
- 企业托管禁用时只显示组织策略说明，不修改 `%ProgramData%\OpenAI\Codex\requirements.toml`。
- 本地 `features.codex_hooks` 作为已弃用别名只读识别且永不自动改写；与 `features.hooks` 同值时发弃用/重复 Issue，冲突或非布尔时三种 action 全部 ConfigConflict 且 Runtime 保持停止。官方 2026-07-16 文档未明确 managed requirements 接受旧别名，企业文件只按标准 `[features].hooks` 与 `allow_managed_hooks_only` 判定。
- `idlePersistent` 只影响 running 且无任务的展示，不能调用 runtime start/stop。
- 配置变更必须预览、expectedDigest/previewDigest 双重防并发；apply 固定先分配 transactionId，再纯准备 Config/Bridge，持久化 Prepared 后才创建本 transactionId 的备份/同目录临时文件、重新解析和原子替换。
- Integration Journal 固定为 `paths.integration_transaction_file` 指向的 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json`，只有 `paths.rs` 可以拼接稳定文件名；Journal 原子写 temp 固定由该路径和 transactionId 推导为 `.<journal-filename>.codepulse-<transactionId>.tmp`。首次写入和每次阶段推进都执行同目录 temp→write→flush→close→重读解析→MoveFileExW；恢复只清理文件名与已解析内容 transactionId 一致的这一精确 temp，不扫描其他 `.codepulse-*`。
- CodePulse Hook 的唯一标准母版是 04A 创建的 `codepulse-hooks-exact.json`/`.toml`；JSON 只能通过 `serde_json` AST 修改 command value，TOML 只能通过 `toml_edit::DocumentMut` 修改 Value，Exact 也在 AST 中反向规范化。Inspection、Planner、Repair、快照测试与 04C E2E 只能消费同一 loader，不能各自手写第二套八事件结构或执行原始文本路径替换。
- Bridge 安装前必须校验 DOS Header、`e_lfanew`、`PE\0\0`、目标 triple 对应的 COFF Machine、Optional Header Magic/长度和 `IMAGE_SUBSYSTEM_WINDOWS_GUI = 2`；Console Subsystem 必须拒绝。
- Runtime stop/uninstall/首次 install 失败必须通过进程级 SnapshotStore 发布更高 revision 空快照；dormant 快照查询不能依赖 Actor。
- 每个 Runtime 使用新的非零 generation、token、Actor/reporter 与 DiscoveryOwner；旧 generation 的事件和清理不得污染新 Runtime。
- 第一版排除 WSL；自动事件不能冒充 Codex App/CLI 的真实 Hook 信任验收。

## 固定跨批次接口

阶段二产生、04B 直接消费且 04C 只通过公开命令间接消费的 Manager/Store 接口：

```rust
impl CodexRuntimeManager {
    pub fn new(
        app: tauri::AppHandle,
        paths: CodexIntegrationPaths,
        snapshot_store: Arc<CodexSnapshotStore>,
    ) -> Self;
}
```

Tauri setup 只构造一次 `Arc<CodexSnapshotStore>` 并注入 Manager，只 `app.manage(runtime)`；Actor、stop/uninstall/restart 与所有命令通过 `runtime.snapshot_store()` 使用同一 Arc，不存在第二个 Tauri state 入口。

04A 产生、04B 与 04C 消费的集成接口：

```rust
pub enum CodexHookAction { Install, Repair, Uninstall }
pub enum CodexHookRepresentation { HooksJson, ConfigToml, None, Conflict }
pub enum CodexHooksFeature { Enabled, Disabled, ManagedDisabled, ConfigConflict }
pub enum ManagedEntryState { Absent, Exact, Modified, Duplicate }
pub enum CodePulseMarkerPresence { Absent, Present, Ambiguous }
pub enum BridgeState { Missing, Current, Outdated, Modified }

pub enum CodexIntegrationIssueCode {
    DeprecatedCodexHooksAlias,
    DuplicateHooksFeatureKeys,
    HooksFeatureTypeConflict,
    HooksFeatureValueConflict,
    // 其余既有稳定 Issue code 继续集中在此枚举。
}

pub struct CodexHooksFeatureInspection {
    pub canonical_value: Option<bool>,
    pub deprecated_alias_value: Option<bool>,
    pub effective_state: CodexHooksFeature,
    pub issue_codes: Vec<CodexIntegrationIssueCode>,
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
    pub issues: Vec<String>,
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

pub struct CodexHookChangeResult {
    pub inspection: CodexIntegrationInspection,
    pub listening_status: CodexListeningStatus,
    pub self_check: CodexSelfCheckResult,
}

pub struct ConfigApplyTransaction;
pub struct BridgeInstallTransaction;

pub enum CodexIntegrationTransactionStage {
    Prepared,
    BridgeApplied,
    ConfigApplied,
    StructureCommitted,
}

pub struct CodexIntegrationTransactionJournal {
    pub version: u16,
    pub transaction_id: String,
    pub action: CodexHookAction,
    pub stage: CodexIntegrationTransactionStage,
    pub created_at: i64,
    pub config: Option<ConfigTransactionJournal>,
    pub bridge: Option<BridgeTransactionJournal>,
}

pub struct ConfigTransactionJournal {
    pub target_path: PathBuf,
    pub target_temp_path: PathBuf,
    pub existed_before: bool,
    pub original_digest: Option<String>,
    pub target_digest: String,
    pub backup_path: Option<PathBuf>,
}

pub struct BridgeTransactionJournal {
    pub installed_path: PathBuf,
    pub bridge_temp_path: PathBuf,
    pub install_record_path: PathBuf,
    pub record_temp_path: PathBuf,
    pub bridge_existed_before: bool,
    pub original_bridge_digest: Option<String>,
    pub target_bridge_exists: bool,
    pub target_bridge_digest: String,
    pub bridge_backup_path: Option<PathBuf>,
    pub record_existed_before: bool,
    pub original_record_digest: Option<String>,
    pub target_record_exists: bool,
    pub target_record_digest: String,
    pub record_backup_path: Option<PathBuf>,
}

pub enum TransactionArtifactState {
    Original,
    Target,
    ExpectedAbsent,
    ExternalModification,
}

pub enum CodexIntegrationCommitInvariant {
    InstalledOrRepaired,
    Uninstalled,
}

pub fn prepare_config_apply(
    paths: &CodexIntegrationPaths,
    prepared: &PreparedCodexHookChange,
    transaction_id: &str,
) -> Result<ConfigApplyTransaction, CodexIntegrationError>;

impl ConfigApplyTransaction {
    pub fn apply(&mut self) -> Result<(), CodexIntegrationError>;
    pub fn commit(self) -> Result<AppliedConfigChange, CodexIntegrationError>;
    pub fn rollback_if_unchanged(self) -> Result<(), CodexIntegrationError>;
}

pub fn prepare_bridge_install(
    paths: &CodexIntegrationPaths,
    target_triple: &str,
    action: BridgeAction,
    transaction_id: &str,
) -> Result<BridgeInstallTransaction, CodexIntegrationError>;

pub fn validate_structure_commit(
    action: CodexHookAction,
    inspection: &CodexIntegrationInspection,
    bridge: &ObservedBridgeState,
) -> Result<CodexIntegrationCommitInvariant, CodexIntegrationError>;

pub fn recover_interrupted_codex_integration_transaction(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationRecoveryOutcome, CodexIntegrationError>;
```

`CodexIntegrationInspection` 只保存重新 inspection 才变化的静态事实；它没有 hookState/phase。`derive_codex_listening_status(&inspection, &runtime_facts)` 是唯一动态派生，且只有 `authenticated_generation == runtime_generation != None` 才能 running。04C 的 settings/composable/Widget 只从 `CodexListeningStatus` 读取动态状态。

本地 disabled 的动作矩阵固定为 install=HooksDisabled、repair=HooksDisabled、有安全 marker 的 uninstall=允许；managed disabled 三种 action 全部 ManagedDisabled；Feature alias conflict、representation conflict 与 ambiguous 禁止自动卸载。只有旧别名时按别名有效值运行并显示弃用提示；双键同值增加 `DeprecatedCodexHooksAlias` 与 `DuplicateHooksFeatureKeys`；双键冲突或非布尔进入 ConfigConflict。Install/Repair 在重新 inspection 与双摘要后先分配唯一 transactionId，再调用 `prepare_config_apply(..., transactionId)` 与 `prepare_bridge_install(..., transactionId)`；两个 prepare 只能在内存中构造目标材料、验证 PE/hash/piped 契约并计算确定性 staging 路径。完整 Prepared Journal 原子持久化成功后才能创建 backup/temp 和 apply。两个 handle 共享同一 transactionId并由同一 Journal 推进 Prepared→BridgeApplied→ConfigApplied→StructureCommitted；两个 `commit()` 只终结进程内资源，StructureCommitted 才是跨进程提交点，之后 self-check 失败保留正确结构。

Install/Repair 的正式 19 步顺序固定为：1 重新静态 Inspection；2 重新计算 expectedDigest/previewDigest；3 分配唯一 transactionId；4 先 `prepare_config_apply`、再 `prepare_bridge_install`，纯计算 Config/Bridge目标材料；5 验证 Bridge PE/hash/piped 契约；6 构造完整 Prepared Journal；7 原子持久化 Prepared Journal；8 创建本 transactionId backup/temp；9 应用 Bridge/记录；10 推进 BridgeApplied；11 必要时启动临时 Runtime；12 应用 Config；13 推进 ConfigApplied；14 执行 action-specific post-write invariant；15 推进 StructureCommitted；16 终结进程内句柄并清理；17 发布 ListeningStatus；18 运行完整 self-check；19 返回结果。任何计划不得再写成 prepare handle 后分配 transactionId。

`target_bridge_exists`/`target_record_exists` 是支持 Uninstall 的附加存在性事实；为 false 时 target digest 固定为 SHA-256(empty bytes)，存在性位区分缺失与零字节文件。配置/Bridge/记录分别按 existedBefore、originalDigest、targetExists、targetDigest、当前存在性与当前 digest 分类成 `Original|Target|ExpectedAbsent|ExternalModification`。Prepared 时目标仍为 Original/ExpectedAbsent，无论本 transactionId 的 staging 不存在、部分存在还是全部存在，都只删除 Journal 明确拥有的 temp/backup 和 Journal，不扫描其他 `.codepulse-*` 文件；Prepared 前崩溃不得留下 staging。BridgeApplied 且配置仍为原状态时，Bridge/记录均原状态只清理并返回 `CleanedPreparedTransaction`；均 Target 逐文件回滚；一个 Target、一个 Original/ExpectedAbsent 是合法崩溃窗口，只回滚 Target 文件；任一 ExternalModification 则 Conflict。ConfigApplied 且配置 Target时，Bridge/记录均 Target 才执行 action-specific invariant；混合已知状态先回滚 Config，再逐文件恢复 Bridge/记录；ExternalModification 不覆盖。阶段落盘滞后按实际逐文件状态进入下一安全分支。

回滚按 action 区分：Install 的 Bridge 原先不存在，只有确认配置不再引用稳定路径才能删除新 EXE；Repair 的 Bridge 原先存在，必须把备份旧字节恢复到同一路径并恢复旧记录，稳定路径仍被 Hook 引用不构成冲突，引用检查只防删除；Uninstall 不经过 BridgeApplied，使用 Prepared→ConfigApplied(marker absent)→stop/clear→delete Bridge/record→StructureCommitted，部分删除时继续删除剩余文件，外部修改或配置重新引用稳定路径时 Conflict并保留 Bridge。

StructureCommitted 使用 action-specific invariant：Install/Repair 要求 Marker=Exact、Bridge/记录=Target、PE/hash/piped 契约有效，返回 `InstalledOrRepaired`；Uninstall 要求 Marker=Absent、配置不再引用稳定 Bridge、Bridge/记录均 absent，返回 `Uninstalled`。不再以 Marker Exact 统一定义 StructureCommitted。StructureCommitted 永远只清理 backup/temp/Journal，清理失败只 Warning。

Uninstall 使用相同 Journal但不经过 BridgeApplied：Prepared 后先删除 marker并推进 ConfigApplied，验证 marker=Absent且无稳定 Bridge 引用后停止 Runtime/清空 Store，再逐文件删除 Bridge/记录；Bridge absent+record present 继续删记录，Bridge present+record absent 再确认无引用后继续删 Bridge；两者 absent 后通过 `Uninstalled` invariant 才推进 StructureCommitted。恢复时若配置被用户修改、Bridge/记录是 ExternalModification 或配置重新引用稳定 Bridge则 Conflict并保留 Bridge。

04B 公开给 04C 的命令：

```rust
#[tauri::command]
pub async fn inspect_codex_integration(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexIntegrationInspection, String>;

#[tauri::command]
pub async fn preview_codex_hook_change(
    action: CodexHookAction,
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexHookChangePreview, String>;

#[tauri::command]
pub async fn apply_codex_hook_change(
    action: CodexHookAction,
    expected_digest: String,
    preview_digest: String,
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexHookChangeResult, String>;
```

Widget 投影固定使用：

```ts
toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)
```

## 批次依赖

```text
04A Inspection + Planner
 ↓ review 并明确批准
04B Writer + Installer + Tauri Commands
 ↓ review 并明确批准
04C Settings + E2E
 ↓ 最终 review
```

| 批次 | 详细计划 | 独立交付物 | 禁止范围 |
|---|---|---|---|
| 04A | `docs/superpowers/plans/2026-07-16-codex-status-island-04a-inspection-planner.md` | TempDir 只读静态 inspection、Feature alias 事实、标准 JSON/TOML Fixture 与 AST loader、generation runtime facts、独立 listening 派生、action matrix 与纯计划 | 不写盘、不安装 Bridge、不注册 apply 命令、不修改 Vue |
| 04B | `docs/superpowers/plans/2026-07-16-codex-status-island-04b-writer-installer.md` | 统一 Integration Journal、ID-first 纯 prepare、逐文件四阶段恢复、action-specific invariant、完整 PE installer、三命令、Store/generation/owner-aware 启停 | 不实现设置页；disabled 只开放安全 uninstall |
| 04C | `docs/superpowers/plans/2026-07-16-codex-status-island-04c-settings-e2e.md` | 静态/动态分离设置卡、alias 提示/冲突 UI、disabled marker 卸载、显示偏好、事务混合恢复/AST Fixture 语义自动与真实 E2E | 不新增配置写入逻辑、不宣称环境阻塞的 CLI 已通过 |

## 审核批次 04A

**Files:**

- Execute plan: `docs/superpowers/plans/2026-07-16-codex-status-island-04a-inspection-planner.md`
- Review diff: `src-tauri/src/codex/integration/inspection.rs`
- Review diff: `src-tauri/src/codex/integration/plan.rs`

- [ ] **步骤 1：执行 04A 计划的全部任务**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::plan_tests -- --nocapture
  Pop-Location
  ```

  预期：TempDir 静态 inspection、Feature 标准键/弃用别名事实、冲突禁用、标准 JSON/TOML Fixture 的 AST 注入/反向规范化与路径矩阵、generation listening 派生、local disabled 安全 uninstall 与 planner 测试全部通过；inspection JSON 无动态字段；没有 writer、installer、Tauri apply 或 Vue 文件。

- [ ] **步骤 2：停下来审核 04A**

  运行：

  ```powershell
  git diff --name-only
  git diff --check
  ```

  预期：只出现 04A 文件清单；审核者明确批准前不得执行 04B。

## 审核批次 04B

**Files:**

- Execute plan: `docs/superpowers/plans/2026-07-16-codex-status-island-04b-writer-installer.md`
- Consume from 04A: `CodexIntegrationInspection`、`PreparedCodexHookChange`、`derive_startup_runtime_decision()`
- Produce for 04C: inspect/preview/apply Tauri commands 与权威 listening status

- [ ] **步骤 1：在 04A 已批准后执行 04B 计划**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::installer_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::commands_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  Pop-Location
  ```

  预期：transactionId 在 Config/Bridge prepare 前分配、Prepared 前零 staging、temp/backup 可归属；Integration Journal 四阶段和 Bridge/记录混合状态逐文件恢复、Install/Repair/Uninstall rollback 与 action-specific invariant、篡改保护、PE Machine+GUI、SnapshotStore/generation/owner 生命周期通过；local disabled uninstall 不安装 Bridge或启动 HTTP。

- [ ] **步骤 2：停下来审核 04B**

  运行：

  ```powershell
  git diff --name-only
  git diff --check
  ```

  预期：没有 dashboard/settings Vue 文件；审核者明确批准前不得执行 04C。

## 审核批次 04C

**Files:**

- Execute plan: `docs/superpowers/plans/2026-07-16-codex-status-island-04c-settings-e2e.md`
- Create verification at execution time only: `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`

- [ ] **步骤 1：在 04B 已批准后执行 04C 计划**

  运行：

  ```powershell
  pnpm run test
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  Push-Location src-tauri
  cargo test --workspace
  Pop-Location
  ```

  预期：设置/UI/自动 E2E 通过；真实验收记录只在 04C 实施时创建。

- [ ] **步骤 2：停下来完成最终审核**

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  git diff --check
  git status --short
  ```

  预期：App 真实 Hook 信任结果如实记录；独立 CLI 不可用时写“环境阻塞”并阻止完整兼容声明。

## 阶段四总门禁

- 04A、04B、04C 依序完成且每批次后都有独立 review 结论。
- HooksDisabled 阻止 install/repair；local disabled 且存在可安全解析 marker 时只允许 Prepared uninstall，不写 Bridge、不启动 HTTP；managed disabled 与 ambiguous conflict 不产生任何写计划。
- `features.codex_hooks` 仅只读兼容并显示弃用提示；同值双键发 Duplicate warning，冲突/非布尔时 Runtime 停止且 install/repair/uninstall 均 ConfigConflict；CodePulse 永不改写 Feature 键或企业文件。
- `codepulse-hooks-exact.json` 与 `.toml` 是唯一标准结构，完整八事件、command+Windows override、timeout=2、无 matcher/statusMessage/async；JSON/TOML 分别通过 serde_json/toml_edit AST 注入与反向规范化，空格/中文/单引号路径可解析；Inspection、Planner、Repair、快照与 E2E 共用同一 loader。
- 静态 inspection 的 managedEntry=exact/modified/duplicate 或带安全 marker 且表示可解析时按决策启动；absent/disabled/managed disabled/ambiguous conflict 不常驻；partial 等动态 phase 只由 listening status 派生。
- Runtime stop/uninstall/无旧合法 Runtime 的 install 失败按固定顺序发布更高 revision 空快照；重新安装后的任务 revision 继续递增，旧 Vue 任务被清除。
- 每个新 Runtime generation 清空认证事实，旧 reporter/关闭回调被忽略；重新安装在第一条真实新 Hook 前保持 awaiting_trust/partial。
- Discovery 的 shutdown/invalidate/serve/drop/stop/Exit 全部比较 version/PID/token/startedAt；旧 Runtime 不误删新文件。
- Integration Journal 的正式顺序是 allocate ID→prepare Config/Bridge→persist Prepared→create owned staging→apply；Prepared 前崩溃零 staging，Prepared 后部分 staging 只清本 transactionId；BridgeApplied/ConfigApplied 的 Bridge/记录 Original/Target 混合状态逐文件恢复。Install/Repair/Uninstall 使用各自 rollback 与 StructureCommitted invariant；提交后 self-check 失败保留正确结构，恢复只清理且 cleanup 失败只 warning。
- 用户其他 Hook 在 install/repair/uninstall 后语义保持；卸载不恢复整份旧备份。
- idlePersistent 不启动服务，也不把未安装、禁用、冲突或服务错误伪装为已就绪。
- Bridge crate root 与打包/安装同时验证 Windows GUI Subsystem 和目标 PE Machine；旧 target、错架构或 Console Subsystem 不能通过门禁，真实多 Hook 验收无控制台闪烁。
- 验收记录路径唯一为 `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`。
- 全部完成后停止，不自动开展下一版功能。
