# 阶段四：Codex Hook 安全接入总览与审核索引

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement exactly one reviewed batch at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把阶段四拆为三个可独立拒绝、验收和回滚的审核批次，在不破坏用户 Hook、不自动开启全局 Hooks 的前提下完成只读检查、配置写入、Bridge 安装、设置页和真实端验收。

**架构：** 04A 只读文件并产生 Feature 标准键/弃用别名事实、绑定稳定 Bridge 路径的 CodePulse-owned Fixture投影、静态 inspection、generation-aware listening 派生和 planner 结果；04B 才负责统一 Integration Transaction Journal、Prepared后optimistic precondition check/完整staging屏障、existing `ReplaceFileW` snapshot、absent no-replace publish、removal tombstone，以及原子操作后以`StableArtifactLease`冻结target/capture、Handle identity与Handle摘要、跨Journal阶段Lease持有和StructureCommitted后的同Handle验证删除；同时实现精确孤立Journal恢复、安全retry、完整PE installer、Tauri commands、唯一SnapshotStore清空和generation/owner-aware runtime生命周期；04C只消费公开命令与唯一动态`CodexListeningStatus`完成UI、显示偏好和精确句柄竞态E2E。三个批次严格串行，每个批次完成后停止等待review。

**技术栈：** Rust、serde_json、toml_edit 0.25、sha2、Windows `CreateFileW`/`MoveFileExW`/`ReplaceFileW`/`GetFileInformationByHandleEx`/`SetFileInformationByHandle`、Tauri 2.11.5、Vue 3、Pinia/localStorage、Vitest、PowerShell；不新增前端生产依赖。

## 全局约束

- 本总览只索引阶段四，不承载可直接实施的混合任务。
- 所有模块消费阶段一唯一的 `CodexIntegrationPaths`；不得自行拼接 CodePulse/runtime/bin。
- 本地数据根目录由 `app.path().local_data_dir()?` 获得，再由路径对象生成 `%LOCALAPPDATA%\CodePulse`。
- 应用启动顺序固定为：构造路径对象与唯一 `Arc<CodexSnapshotStore>`并显式注入 Manager → 恢复 Integration Transaction → 只读静态 inspection → inspection 决定 runtime 启停 → 单独派生并发布 listening status。
- `features.hooks=false` 时 install/repair 禁止；marker absent 只展示手动开启引导；有安全 marker 时允许预览/确认精确 uninstall，且不安装 Bridge、不启动 HTTP。
- 企业托管禁用时只显示组织策略说明，不修改 `%ProgramData%\OpenAI\Codex\requirements.toml`。
- 本地 `features.codex_hooks` 作为已弃用别名只读识别且永不自动改写；与 `features.hooks` 同值时发弃用/重复 Issue，冲突或非布尔时三种 action 全部 ConfigConflict 且 Runtime 保持停止。官方 2026-07-16 文档未明确 managed requirements 接受旧别名，企业文件只按标准 `[features].hooks` 与 `allow_managed_hooks_only` 判定。
- `idlePersistent` 只影响 running 且无任务的展示，不能调用 runtime start/stop。
- 配置变更必须预览、expectedDigest/previewDigest 双重防并发；apply 固定先分配 transactionId，再纯准备 Config/Bridge并持久化Prepared。Prepared成功后、任何staging前必须对Config/Bridge/Record执行optimistic precondition check；prepared backup/temp摘要与当前Prepared Journal ID全部通过屏障后才允许第一处原子文件操作。普通摘要重读不称为CAS：existing通过`ReplaceFileW`捕获实际旧版本，absent通过no-replace原子发布，removal通过tombstone原子捕获。
- Integration Journal 固定为 `paths.integration_transaction_file` 指向的 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json`，只有 `paths.rs` 可以拼接稳定文件名；Journal 原子写 temp 固定由该路径和 transactionId 推导为 `.<journal-filename>.codepulse-<transactionId>.tmp`。首次写入和每次阶段推进都执行同目录 temp→write→flush→close→重读解析→MoveFileExW。稳定Journal存在时只处理其权威ID；稳定Journal不存在时只枚举精确`.<journal-filename>.codepulse-<32hex>.tmp`并清理满足Prepared-only/目标仍原始/同ID无目标staging的候选，异常保留并`OrphanTransactionConflict`。禁止扫描普通`*.codepulse-*.tmp|bak`。
- CodePulse Hook 的唯一标准母版是 04A 创建的 `codepulse-hooks-exact.json`/`.toml`；JSON 只能通过 `serde_json` AST 修改 command value，TOML 只能通过 `toml_edit::DocumentMut` 修改 Value。Exact规范化显式接收`paths.installed_bridge`，只有基础command与Windows override都精确等于expected command、无附加参数且matcher结构标准的独立group才进入CodePulse-owned projection；用户独立Hook不进入projection，混合group为Modified。Inspection、Planner、Repair、快照测试与04C E2E只能消费同一loader，不能各自手写第二套八事件结构或执行原始文本路径替换。
- Bridge 安装前必须校验 DOS Header、`e_lfanew`、`PE\0\0`、目标 triple 对应的 COFF Machine、Optional Header Magic/长度和 `IMAGE_SUBSYSTEM_WINDOWS_GUI = 2`；Console Subsystem 必须拒绝。
- Runtime stop/uninstall/首次 install 失败必须通过进程级 SnapshotStore 发布更高 revision 空快照；dormant 快照查询不能依赖 Actor。
- 每个 Runtime 使用新的非零 generation、token、Actor/reporter 与 DiscoveryOwner；旧 generation 的事件和清理不得污染新 Runtime。
- 第一版排除 WSL；自动事件不能冒充 Codex App/CLI 的真实 Hook 信任验收。
- Transaction Conflict只允许“重新尝试安全恢复”；重试复用operation mutex与统一恢复，不强制覆盖/删除Journal、不忽略摘要、不采用外改字节为新Original、不修改Feature键。
- `StableArtifactLease`只存在于04B当前进程的事务句柄，不序列化、不写Journal、不改变唯一Journal/唯一SnapshotStore/Runtime generation/DiscoveryOwner所有权；崩溃恢复重新获取Lease。
- 2026-07-17 已重新核对 Microsoft 官方 [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)、[ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)、[MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)、[SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)、[GetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle)、[GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)、[FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)、[CreateFileMappingW](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-createfilemappingw)、[MapViewOfFile](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile)、[DeleteFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew)与[Closing and Deleting Files](https://learn.microsoft.com/en-us/windows/win32/fileio/closing-and-deleting-files)。固定结论是：仅`FILE_SHARE_READ`的Handle排斥既有/后续写访问、writable file mapping与delete/rename访问；`FILE_ID_INFO`提供volume serial+128位file ID；`ReplaceFileW`捕获实际旧文件；no-replace move不覆盖；`FileDispositionInfo`把删除标记绑定到同一带`DELETE`的Handle。04B不得把“按路径读取摘要→再按路径恢复/删除”当作同一对象保证。

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
    pub prepared_backup_path: Option<PathBuf>,
    pub replaced_snapshot_path: Option<PathBuf>,
    pub conflict_preserved_current_path: Option<PathBuf>,
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
    pub bridge_prepared_backup_path: Option<PathBuf>,
    pub bridge_replaced_snapshot_path: Option<PathBuf>,
    pub bridge_conflict_preserved_current_path: Option<PathBuf>,
    pub bridge_removed_tombstone_path: Option<PathBuf>,
    pub record_existed_before: bool,
    pub original_record_digest: Option<String>,
    pub target_record_exists: bool,
    pub target_record_digest: String,
    pub record_prepared_backup_path: Option<PathBuf>,
    pub record_replaced_snapshot_path: Option<PathBuf>,
    pub record_conflict_preserved_current_path: Option<PathBuf>,
    pub record_removed_tombstone_path: Option<PathBuf>,
}

pub enum TransactionArtifactState {
    Original,
    Target,
    ExpectedAbsent,
    ExternalModification,
}

pub struct StableArtifactIdentity {
    pub volume_serial_number: u64,
    pub file_id: [u8; 16],
    pub size: u64,
}

pub struct StableArtifactLease {
    handle: OwnedHandle,
    identity: StableArtifactIdentity,
    path: PathBuf,
}

pub enum StableArtifactLeaseError {
    ActiveWriter,
    WritableMapping,
    DeleteOrRenameAccess,
    SharingViolation,
    IdentityChanged,
    FileMissing,
    AccessDenied,
    Io,
}

pub enum CodexIntegrationError {
    ActiveArtifactHandleConflict,
    // 其余既有错误变体保持不变。
}

pub struct AppliedArtifactLeases {
    pub target: Option<StableArtifactLease>,
    pub replaced_snapshot: Option<StableArtifactLease>,
    pub removed_tombstone: Option<StableArtifactLease>,
    pub conflict_preserved_current: Option<StableArtifactLease>,
}

pub fn acquire_stable_artifact_lease(
    path: &Path,
) -> Result<StableArtifactLease, StableArtifactLeaseError>;

pub fn hash_artifact_through_lease(
    lease: &StableArtifactLease,
) -> Result<String, CodexIntegrationError>;

pub fn verify_artifact_matches_expected_original(
    expectation: TransactionArtifactExpectation<'_>,
    path: &Path,
) -> Result<TransactionArtifactState, CodexIntegrationError>;

pub enum AtomicArtifactApplyOutcome {
    AppliedExpectedOriginal,
    DestinationAppeared,
    CapturedLateModification,
    ExternalModification,
}

pub struct AtomicArtifactReplaceResult {
    pub outcome: AtomicArtifactApplyOutcome,
    pub replaced_snapshot_path: Option<PathBuf>,
    pub leases: AppliedArtifactLeases,
}

pub struct AtomicArtifactApplyResult {
    pub outcome: AtomicArtifactApplyOutcome,
    pub leases: AppliedArtifactLeases,
}

pub fn atomically_replace_existing_artifact(
    target: &Path,
    replacement: &Path,
    replaced_snapshot: &Path,
    expected_original_digest: &str,
    target_digest: &str,
) -> Result<AtomicArtifactReplaceResult, CodexIntegrationError>;

pub fn atomically_publish_absent_artifact(
    target: &Path,
    replacement: &Path,
    target_digest: &str,
) -> Result<AtomicArtifactApplyResult, CodexIntegrationError>;

pub fn atomically_capture_artifact_for_removal(
    target: &Path,
    tombstone: &Path,
    expected_digest: &str,
) -> Result<AtomicArtifactApplyResult, CodexIntegrationError>;

pub enum VerifiedArtifactDeleteOutcome {
    Deleted { identity: StableArtifactIdentity },
    AlreadyAbsent,
    RetainedDigestMismatch { identity: StableArtifactIdentity },
    RetainedActiveHandle,
    DeletePending { identity: StableArtifactIdentity },
    PathReusedAfterDelete { deleted_identity: StableArtifactIdentity },
}

pub fn delete_verified_artifact_by_handle(
    path: &Path,
    expected_digest: &str,
) -> Result<VerifiedArtifactDeleteOutcome, CodexIntegrationError>;

pub enum CodexIntegrationCommitInvariant {
    InstalledOrRepaired,
    Uninstalled,
}

pub fn normalize_codepulse_hook_commands_for_exact(
    representation: CodePulseHookFixtureRepresentation,
    actual: CodePulseHookFixtureAst,
    expected_bridge_path: &Path,
) -> Result<CodePulseHookFixtureAst, CodexIntegrationError>;

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

本地 disabled 的动作矩阵固定为 install=HooksDisabled、repair=HooksDisabled、有安全 marker 的 uninstall=允许；managed disabled 三种 action 全部 ManagedDisabled；Feature alias conflict、representation conflict 与 ambiguous 禁止自动卸载。只有旧别名时按别名有效值运行并显示弃用提示；双键同值增加 `DeprecatedCodexHooksAlias` 与 `DuplicateHooksFeatureKeys`；双键冲突或非布尔进入 ConfigConflict。Install/Repair 在重新 inspection 与双摘要后先分配唯一 transactionId，再调用 `prepare_config_apply(..., transactionId)` 与 `prepare_bridge_install(..., transactionId)`；两个 prepare 只能在内存中构造目标材料、验证 PE/hash/piped 契约并计算确定性 staging/capture 路径。完整 Prepared Journal 原子持久化成功后，必须重新读取三目标并由`verify_artifact_matches_expected_original()`确认均为Original/ExpectedAbsent，才创建prepared backup/temp。这个optimistic precondition check只提前发现变化，不构成原子CAS。所有prepared backup/temp重读摘要、全部replaced snapshot/tombstone/conflict-preserved-current路径与当前Prepared Journal ID形成all-staging-ready屏障后，existing/absent/removal分别调用统一原子接口。两个 handle 共享同一transactionId并由同一Journal推进Prepared→BridgeApplied→ConfigApplied→StructureCommitted；两个`commit()`只终结进程内资源，StructureCommitted才是跨进程提交点，之后self-check失败保留正确结构。

`acquire_stable_artifact_lease()`固定调用`CreateFileW`，DesiredAccess=`GENERIC_READ | FILE_READ_ATTRIBUTES`、ShareMode=`FILE_SHARE_READ`、CreationDisposition=`OPEN_EXISTING`；严禁添加`FILE_SHARE_WRITE | FILE_SHARE_DELETE`。成功后从同一Handle取得volume serial、128位file ID、size与必要属性，`hash_artifact_through_lease()`只通过该Handle读取并在摘要前后复核身份/size；禁止`std::fs::read(path)`或重新按路径打开关键事务摘要。路径随后取得不同file ID时返回`IdentityChanged`并保留证据。`ERROR_SHARING_VIOLATION`无论来自活动writer、writable mapping还是delete/rename access，都稳定映射成`ActiveArtifactHandleConflict`；可复用最多三次、间隔50ms的短重试，仍失败立即停止Runtime、保留Journal/target/capture/prepared backup并发布config_conflict，只允许安全retry。

Install/Repair 的正式 19 步顺序固定为：1 重新静态 Inspection；2 重新计算 expectedDigest/previewDigest；3 分配唯一 transactionId；4 先 `prepare_config_apply`、再 `prepare_bridge_install`，纯计算 Config/Bridge目标材料与捕获路径；5 验证 Bridge PE/hash/piped 契约；6 构造完整 Prepared Journal；7 原子持久化 Prepared Journal；8 三目标optimistic precondition check通过后创建本transactionId prepared backup/temp并完成originalDigest/targetDigest/all-staging-ready屏障；9 Bridge/Record按existing调用`ReplaceFileW`后获取target/snapshot Lease，按absent发布后获取target Lease，全部只以Handle验证并保存在事务句柄，任一late modification、DestinationAppeared或ActiveArtifactHandleConflict立即停止；10 持有Bridge/Record Lease推进BridgeApplied；11 在共享只读兼容的Lease下必要时启动临时Runtime；12 确认Bridge/Record Lease仍为本事务Target且无late snapshot，Config再次optimistic precondition check后按existing/absent原子语义应用并取得结果Lease；13 持有全部最终Lease推进ConfigApplied；14 只以Lease身份/摘要执行action-specific post-write invariant；15 持有Lease推进StructureCommitted；16 释放普通Lease、终结进程内句柄并使用同一DELETE Handle清理正常artifacts；17 发布ListeningStatus；18 运行完整self-check；19 返回结果。任何计划不得再写成prepare handle后分配transactionId，不得复用expectedDigest时期的旧读取结果执行覆盖，不得把普通读取检查称为CAS，也不得在阶段Journal持久化前释放Lease。

`target_bridge_exists`/`target_record_exists` 是支持 Uninstall 的附加存在性事实；为 false 时 target digest 固定为 SHA-256(empty bytes)，存在性位区分缺失与零字节文件。配置/Bridge/记录分别按 existedBefore、originalDigest、targetExists、targetDigest、当前存在性与当前 digest 分类成 `Original|Target|ExpectedAbsent|ExternalModification`；optimistic precondition check可按路径提前发现变化，但原子操作后的关键分类必须来自Lease。每个existedBefore prepared backup都必须由当前原字节生成，create_new/write/flush/close后取得prepared backup Lease并通过Handle确认originalDigest；existedBefore=false必须prepared backup=None且目标仍缺失。Prepared正常分支只清理Journal明确拥有的staging并保持目标不变；阶段落盘滞后时，所有实际存在的target/capture/prepared backup先获取Lease再分类。BridgeApplied/ConfigApplied恢复优先级固定为：当前目标→replaced snapshot/removed tombstone/conflict-preserved-current→prepared backup→Journal摘要；高优先级文件Lease失败时不得降级到prepared backup，任何`ActiveArtifactHandleConflict`、ExternalModification或preserved conflict都不覆盖并返回Conflict。

Atomic existing-file replacement固定调用`ReplaceFileW(target, replacement_temp, transaction_owned_replaced_snapshot, ...)`。成功后固定获取target Lease→snapshot Lease→分别通过Handle计算摘要→验证两个file ID不同；两个Lease均成功、target=`targetDigest`、snapshot=`originalDigest`才允许继续。任一Lease失败直接`ActiveArtifactHandleConflict`，禁止按路径读取、清snapshot或继续下一文件。snapshot稳定但不等于originalDigest时才返回`CapturedLateModification`。只有target/snapshot Lease都成功且摘要稳定，才可决定第二次恢复；执行前释放相关Lease，再以`ReplaceFileW(current_target, replaced_snapshot, conflict-preserved-current, ...)`恢复真实外改并保存CodePulse Target，随后重新获取restored target和conflict-preserved-current Lease并通过Handle验证。第二次操作后任一Lease/摘要失败都保留两版并Conflict；snapshot Lease失败时绝不自动执行第二次ReplaceFileW。

Atomic absent-file publication固定为同目录no-replace move/rename，不带`MOVEFILE_REPLACE_EXISTING`。目标在最后一次检查后出现时返回`DestinationAppeared`，外部目标字节与transaction temp都保留；成功后立即获取target Lease并只通过Handle验证targetDigest，Lease失败或摘要不符时target保留且Conflict。Atomic removal capture固定把Bridge/Record no-replace原子rename到本transactionId removed tombstone，禁止直接`DeleteFileW`；成功后取得tombstone Lease、通过Handle验证摘要并确认target absent。tombstone Lease失败时不按路径读取、不永久删除、不进入Uninstalled invariant；稳定摘要不符且target仍absent时才允许释放Lease后no-replace恢复，并在恢复后重新获取target Lease验证；目标已重建时保留两者并Conflict。

稳定Journal存在时，恢复以其transactionId为唯一权威ID，只处理该ID的Journal temp、三目标staging与backup，其他ID文件仅诊断。稳定Journal不存在时只枚举`.<journal-filename>.codepulse-<32hex>.tmp`：候选必须完整反序列化、文件名ID=内容ID、stage=Prepared、三目标仍Original/ExpectedAbsent且同ID无目标staging/backup，才作为Prepared-only孤立temp删除；一个或多个合法候选都可清理。损坏、ID不符、stage非Prepared、目标变化或同ID staging存在时保留并`OrphanTransactionConflict`，Runtime不启动、目标不改。此算法依赖单实例插件；未来移除单实例前必须先加进程间事务锁。

回滚按 action 区分：Install 的 Bridge 原先不存在，只有确认配置不再引用稳定路径才能处理新 EXE；Repair 的 Bridge 原先存在，优先使用ReplaceFileW实际捕获且摘要等于originalDigest的replaced snapshot恢复同路径旧EXE/旧记录，prepared backup只作低优先级后备；稳定路径仍被 Hook 引用不构成冲突，引用检查只防删除。Uninstall 不经过 BridgeApplied，使用 Prepared→ConfigApplied(marker absent)→stop/clear→capture Bridge/record tombstone→StructureCommitted；只有已经成功取得tombstone Lease并完成Handle摘要验证的部分捕获，才可继续处理仍存在的剩余目标；任一捕获后Lease失败、外部修改或配置重新引用稳定路径时立即停止并Conflict，保留目标与tombstone。

StructureCommitted 使用 action-specific invariant：Install/Repair 要求 Marker=Exact、Bridge/记录=Target、PE/hash/piped 契约有效且最终target/snapshot Lease仍持有，返回 `InstalledOrRepaired`；Uninstall 要求 Marker=Absent、配置不再引用稳定 Bridge、Bridge/记录目标路径均 absent且对应tombstone Lease稳定并受当前Journal控制，返回 `Uninstalled`。Bridge相关Lease保持到BridgeApplied落盘，Config/Bridge/Record最终Lease保持到StructureCommitted落盘；阶段推进失败不得提前释放并继续，Lease不写Journal，崩溃恢复重新获取。StructureCommitted落盘后释放普通Lease，正常artifact只调用`delete_verified_artifact_by_handle`：以`GENERIC_READ | DELETE`、仅`FILE_SHARE_READ`、`OPEN_EXISTING`打开，使用同一Handle取得file ID并计算expectedDigest，再`SetFileInformationByHandle(FileDispositionInfo)`标记同一对象删除，关闭后验证路径absent。Handle失败/delete pending/路径复用只Warning并保留StructureCommitted Journal供startup retry，不回滚正确Hook/Bridge；Conflict snapshot/tombstone/conflict-preserved-current永不进入普通cleanup。

Uninstall 使用相同 Journal但不经过 BridgeApplied：Prepared 后先删除 marker并推进 ConfigApplied，验证 marker=Absent且无稳定 Bridge 引用后停止 Runtime/清空 Store，再逐文件原子捕获 Bridge/记录到removed tombstone并取得tombstone Lease；Bridge目标absent但Record仍present时继续捕获Record，反向同理；两目标absent且tombstone均在Lease下通过Handle摘要验证并受Journal控制后，才通过`Uninstalled` invariant并保持Lease推进StructureCommitted，随后释放普通Lease并通过Handle-based cleanup删除。恢复时若配置被用户修改、Bridge/记录是ExternalModification、tombstone Lease/Handle摘要异常、目标路径被重新创建或配置重新引用稳定Bridge，则Conflict并保留所有版本。

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

pub struct CodexIntegrationRecoveryResult {
    pub outcome: CodexIntegrationRecoveryOutcome,
    pub inspection: CodexIntegrationInspection,
    pub listening_status: CodexListeningStatus,
}

#[tauri::command]
pub async fn retry_codex_integration_recovery(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexIntegrationRecoveryResult, String>;
```

retry与apply共用integration operation mutex。不存在稳定Journal且不存在孤立Journal temp时返回`NoPendingTransaction`；否则只重跑`recover_interrupted_codex_integration_transaction()`，对实际存在的target/replaced snapshot/conflict-preserved-current/tombstone/prepared backup重新获取Lease并通过Handle分类，不强制删Journal、不忽略摘要、不采用用户新字节为Original、不改Feature键。任一应存在文件的Lease失败继续`IntegrationTransactionConflict`，不得改用路径读取或低优先级prepared backup；外部编辑器/进程关闭writer、writable mapping或delete handle后，用户再次安全retry才可继续。成功后重新静态Inspection、执行Runtime启停决策并发布最新ListeningStatus；仍有外改或活跃句柄时保持字节、Journal和备份。用户手工把文件恢复为Journal已知Original/Target/ExpectedAbsent后可再次重试，无需重装CodePulse。

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
| 04A | `docs/superpowers/plans/2026-07-16-codex-status-island-04a-inspection-planner.md` | TempDir 只读静态 inspection、Feature alias 事实、绑定稳定Bridge路径的标准JSON/TOML Fixture CodePulse-owned projection、generation runtime facts、独立listening派生、action matrix与纯计划 | 不写盘、不安装 Bridge、不注册 apply 命令、不修改 Vue |
| 04B | `docs/superpowers/plans/2026-07-16-codex-status-island-04b-writer-installer.md` | 统一Integration Journal、ID-first纯prepare、optimistic precondition check、existing ReplaceFileW双Lease、absent target Lease、removal tombstone Lease、跨阶段Lease持有、Handle-based cleanup、精确孤立temp恢复、action-specific invariant、四命令与安全retry | 不实现设置页；disabled只开放安全uninstall；无force/discard入口 |
| 04C | `docs/superpowers/plans/2026-07-16-codex-status-island-04c-settings-e2e.md` | 静态/动态分离设置卡、alias提示/Conflict安全重试、disabled marker卸载、显示偏好、active writer/writable mapping/Lease阻写阻删/同Handle cleanup等精确竞态、孤立Journal/事务混合恢复与路径绑定projection自动/真实E2E | 不新增配置写入逻辑、不宣称环境阻塞的CLI已通过 |

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

  预期：TempDir静态inspection、Feature标准键/弃用别名事实、冲突禁用、标准JSON/TOML Fixture的AST注入、显式expected_bridge_path、CodePulse-owned projection与路径矩阵、独立用户group不影响Exact/混合group Repair保留用户handler、generation listening派生、local disabled安全uninstall与planner测试全部通过；inspection JSON无动态字段；没有writer、installer、Tauri apply或Vue文件。

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
- Produce for 04C: inspect/preview/apply/retry Tauri commands 与权威 listening status

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

  预期：transactionId在Config/Bridge prepare前分配、Prepared前零staging；optimistic precondition check、prepared backup/target temp完整性与all-staging-ready通过；existing ReplaceFileW后target/snapshot Lease、late modification第二次ReplaceFileW前释放与后置重新冻结、absent publish后target Lease、Uninstall tombstone Lease、跨Journal阶段持有和同Handle cleanup通过；active writer/writable mapping/delete access均进入可重试Conflict，Lease阻止新write/rename/delete；稳定/孤立Journal精确恢复、Integration Journal四阶段和Bridge/记录混合状态逐文件恢复、Install/Repair/Uninstall rollback与action-specific invariant、Conflict安全retry/NoPendingTransaction、篡改保护、PE Machine+GUI、SnapshotStore/generation/owner生命周期通过；local disabled uninstall不安装Bridge或启动HTTP。

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
- `codepulse-hooks-exact.json` 与 `.toml` 是唯一标准结构，完整八事件、command+Windows override、timeout=2、无 matcher/statusMessage/async；JSON/TOML分别通过serde_json/toml_edit AST注入。Exact显式绑定`paths.installed_bridge`，只提取双command精确匹配、无额外参数且matcher合法的CodePulse-owned projection；wrong-path不可能Exact，用户独立Hook不进入projection，混合group Repair后用户handler保留且CodePulse group独立。Inspection、Planner、Repair、快照与E2E共用同一loader。
- 静态 inspection 的 managedEntry=exact/modified/duplicate 或带安全 marker 且表示可解析时按决策启动；absent/disabled/managed disabled/ambiguous conflict 不常驻；partial 等动态 phase 只由 listening status 派生。
- Runtime stop/uninstall/无旧合法 Runtime 的 install 失败按固定顺序发布更高 revision 空快照；重新安装后的任务 revision 继续递增，旧 Vue 任务被清除。
- 每个新 Runtime generation 清空认证事实，旧 reporter/关闭回调被忽略；重新安装在第一条真实新 Hook 前保持 awaiting_trust/partial。
- Discovery 的 shutdown/invalidate/serve/drop/stop/Exit 全部比较 version/PID/token/startedAt；旧 Runtime 不误删新文件。
- Integration Journal的正式顺序是allocate ID→prepare Config/Bridge→persist Prepared→optimistic precondition check→verified owned staging/all-staging-ready→atomic existing/absent/removal→StableArtifactLease/Handle摘要→持Lease推进阶段。Prepared前崩溃零staging；Prepared后提前发现变化时不创建新staging。每个prepared backup通过Lease匹配originalDigest；existing文件必须由ReplaceFileW捕获replaced snapshot并同时冻结target/snapshot，absent文件no-replace发布后冻结target，Uninstall原子rename后冻结tombstone。任一Lease/摘要不符不得继续下一文件，active writer/mapping/delete access进入`ActiveArtifactHandleConflict`；BridgeApplied/ConfigApplied按Lease稳定的当前目标和捕获artifact恢复。StructureCommitted后只对正常artifact使用同一`GENERIC_READ | DELETE` Handle验证file ID/摘要并`SetFileInformationByHandle(FileDispositionInfo)`，Conflict artifacts保留；cleanup Handle失败只warning并由startup recovery重试。
- 稳定Journal存在时只处理其权威ID；无稳定Journal时仅合法Prepared-only孤立Journal temp可清理，异常temp保留并OrphanTransactionConflict、Runtime停止。Conflict UI只提供“重新尝试安全恢复”；retry共用operation mutex、无事务返回NoPendingTransaction、成功后重新Inspection/Runtime决策/ListeningStatus，不存在force overwrite/discard/ignore功能。
- 用户其他 Hook 在 install/repair/uninstall 后语义保持；卸载不恢复整份旧备份。
- idlePersistent 不启动服务，也不把未安装、禁用、冲突或服务错误伪装为已就绪。
- Bridge crate root 与打包/安装同时验证 Windows GUI Subsystem 和目标 PE Machine；旧 target、错架构或 Console Subsystem 不能通过门禁，真实多 Hook 验收无控制台闪烁。
- `AtomicIntegrationFs`除既有五个注入点外还提供`BeforeStableLeaseAcquire`、`AfterStableLeaseAcquireBeforeHash`、`AfterHashBeforeStagePersist`、`BeforeVerifiedHandleDelete`；范围脚本阻止snapshot/tombstone路径型关键摘要、原子操作后缺Lease、recovery在Lease失败后降级、阶段落盘前释放Lease、路径型`DeleteFileW` cleanup及Conflict artifact进入普通cleanup。
- 验收记录路径唯一为 `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`。
- 全部完成后停止，不自动开展下一版功能。
