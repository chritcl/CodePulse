# 阶段四：Codex Hook 安全接入总览与审核索引

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement exactly one reviewed batch at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把阶段四拆为 04A、04B-1、04B-2、04B-3、04C 五个可独立拒绝和验收的审核边界，在不破坏用户 Hook、不自动开启全局 Hooks 的前提下完成只读检查、配置写入、Bridge 安装、设置页和分层验收。

**架构：** 04A 只读文件并产生 Feature 标准键/弃用别名事实、绑定稳定 Bridge 路径的 CodePulse-owned Fixture投影、静态 inspection、generation-aware listening 派生和 planner 结果；04B-1 只建立唯一 Integration Journal、原子文件、Lease、恢复和 fault injection 基础；04B-2 在其审核通过后接入 Config Writer、Bridge Installer 与 action coordinator；04B-3 再接入公开 Tauri commands、startup recovery、唯一 SnapshotStore 清空和 generation/owner-aware Runtime 编排。StructureCommitted 后先释放普通事务 Lease，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记。04C 只消费 04B-3 已审核的公开命令与唯一动态`CodexListeningStatus`，完成 UI、显示偏好、自动行为矩阵和 App/CLI 真实环境验收。五个审核边界严格串行，每个边界完成后都必须停止等待 review。

**技术栈：** Rust、serde_json、toml_edit 0.25、sha2、Windows `CreateFileW`/`MoveFileExW`/`ReplaceFileW`/`GetFileInformationByHandleEx`/`SetFileInformationByHandle`、Tauri 2.11.5、Vue 3、Pinia/localStorage、Vitest、PowerShell；不新增前端生产依赖。

## 全局约束

- 本总览只索引阶段四，不承载可直接实施的混合任务。
- 规范层级固定为：设计文档负责产品目标、用户行为、功能范围和可见状态；Roadmap负责跨阶段架构、公开接口、状态所有权和全局不变量；详细计划负责具体顺序、失败处理、测试和审核门禁。详细计划不能静默违背设计；安全顺序变化必须同步设计，公共接口或全局不变量变化必须同步Roadmap及全部消费者计划。
- CodePulse只管理用户层`%USERPROFILE%\.codex`中的CodePulse Hook；不修改仓库层`.codex`、插件Hook或企业托管配置，也不扫描全部仓库。Inspection只能陈述用户层管理事实，UI不得声称“全局唯一Hook”，也不创建`DuplicateCodePulseHookAcrossLayers`状态。
- 多个活动配置层中的匹配Hook可同时执行，多个command Hook可并发启动。Bridge的随机`eventId`只表示单次投递；阶段二Actor仅对稳定标识完整的Tool/Subagent/Turn事件构造有界逻辑事件键，对SessionStarted执行幂等元数据更新，对PermissionRequested执行等待状态幂等与`非等待→等待`提醒边沿抑制。Bridge不扫描配置层或持久化去重状态，Vue不承担任何去重。
- 所有模块消费阶段一唯一的 `CodexIntegrationPaths`；不得自行拼接 CodePulse/runtime/bin。
- 本地数据根目录由 `app.path().local_data_dir()?` 获得，再由路径对象生成 `%LOCALAPPDATA%\CodePulse`。
- 应用启动顺序固定为：构造路径对象与唯一 `Arc<CodexSnapshotStore>`并显式注入 Manager → 恢复 Integration Transaction → 只读静态 inspection → inspection 决定 runtime 启停 → 单独派生并发布 listening status。
- `features.hooks=false` 时 install/repair 禁止；marker absent 只展示手动开启引导；有安全 marker 时允许预览/确认精确 uninstall，且不安装 Bridge、不启动 HTTP。
- 企业托管禁用时只显示组织策略说明，不修改 `%ProgramData%\OpenAI\Codex\requirements.toml`。
- 本地 `features.codex_hooks` 作为已弃用别名只读识别且永不自动改写；与 `features.hooks` 同值时发弃用/重复 Issue，冲突或非布尔时三种 action 全部 ConfigConflict 且 Runtime 保持停止。官方 2026-07-16 文档未明确 managed requirements 接受旧别名，企业文件只按标准 `[features].hooks` 与 `allow_managed_hooks_only` 判定。
- `idlePersistent` 只影响 running 且无任务的展示，不能调用 runtime start/stop。
- “Codex状态集成”只作为状态分组，不提供监听布尔开关；全局Hooks只能由用户在Codex配置或官方UI手动修改。安装/修复和卸载各自独立preview/confirm；只有`idlePersistent`与`showCommandSummary`是普通显示偏好，二者都不能启停Runtime。
- 配置变更必须经过静态检查、预览和用户确认；确认前不分配transactionId、不prepare、不写Journal。确认后apply固定先分配transactionId，再pure prepare Config/Bridge/Record并持久化Prepared；pure prepare只计算内存事务材料和确定性路径，不创建正式staging或修改稳定目标。Prepared成功后、任何staging前必须对Config/Bridge/Record执行optimistic precondition check；随后创建并通过Handle验证prepared backup、target temp、removal staging，只有`all-staging-ready`通过才允许第一处原子文件操作。普通摘要重读不称为CAS：existing通过`ReplaceFileW`捕获实际旧版本，absent通过no-replace原子发布，removal通过tombstone原子捕获。
- Integration Journal 固定为 `paths.integration_transaction_file` 指向的 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json`，只有 `paths.rs` 可以拼接稳定文件名；Journal 原子写 temp 固定由该路径和 transactionId 推导为 `.<journal-filename>.codepulse-<transactionId>.tmp`。首次写入和每次阶段推进都执行同目录 temp→write→flush→close→重读解析→MoveFileExW。稳定Journal存在时只处理其权威ID；稳定Journal不存在时只枚举精确`.<journal-filename>.codepulse-<32hex>.tmp`并清理满足Prepared-only/目标仍原始/同ID无目标staging的候选，异常保留并`OrphanTransactionConflict`。禁止扫描普通`*.codepulse-*.tmp|bak`。
- CodePulse Hook 的唯一标准母版是 04A 创建的 `codepulse-hooks-exact.json`/`.toml`；JSON 只能通过 `serde_json` AST 修改 command value，TOML 只能通过 `toml_edit::DocumentMut` 修改 Value。Exact规范化显式接收`paths.installed_bridge`，只有基础command与Windows override都精确等于expected command、无附加参数且matcher结构标准的独立group才进入CodePulse-owned projection；用户独立Hook不进入projection，混合group为Modified。Inspection、Planner、Repair、快照测试与04C E2E只能消费同一loader，不能各自手写第二套八事件结构或执行原始文本路径替换。
- Bridge 安装前必须校验 DOS Header、`e_lfanew`、`PE\0\0`、目标 triple 对应的 COFF Machine、Optional Header Magic/长度和 `IMAGE_SUBSYSTEM_WINDOWS_GUI = 2`；Console Subsystem 必须拒绝。
- Runtime stop/uninstall/首次 install 失败必须通过进程级 SnapshotStore 发布更高 revision 空快照；dormant 快照查询不能依赖 Actor。
- 每个 Runtime 使用新的非零 generation、token、Actor/reporter 与 DiscoveryOwner；旧 generation 的事件和清理不得污染新 Runtime。
- 第一版排除 WSL；自动事件不能冒充 Codex App/CLI 的真实 Hook 信任验收。
- Transaction Conflict只允许“重新尝试安全恢复”；重试复用operation mutex与统一恢复，不强制覆盖/删除Journal、不忽略摘要、不采用外改字节为新Original、不修改Feature键。
- `StableArtifactLease`只存在于04B当前进程的普通事务句柄，不序列化、不写Journal、不改变唯一Journal/唯一SnapshotStore/Runtime generation/DiscoveryOwner所有权；稳定target、replacement结果、正常snapshot、tombstone等普通事务Lease以`GENERIC_READ | FILE_READ_ATTRIBUTES`、仅`FILE_SHARE_READ`取得并全部持有到StructureCommitted落盘，崩溃恢复重新获取。StructureCommitted后必须先释放全部普通Lease，再新开`GENERIC_READ | DELETE`、仅`FILE_SHARE_READ`的cleanup Handle；禁止给原Lease增加`DELETE`权限、复用它删除或把两者描述成同一生命周期。
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

本地 disabled 的动作矩阵固定为 install=HooksDisabled、repair=HooksDisabled、有安全 marker 的 uninstall=允许；managed disabled 三种 action 全部 ManagedDisabled；Feature alias conflict、representation conflict 与 ambiguous 禁止自动卸载。只有旧别名时按别名有效值运行并显示弃用提示；双键同值增加 `DeprecatedCodexHooksAlias` 与 `DuplicateHooksFeatureKeys`；双键冲突或非布尔进入 ConfigConflict。静态inspection与预览完成、用户确认后才允许分配唯一transactionId并调用`prepare_config_apply(..., transactionId)`与`prepare_bridge_install(..., transactionId)`；两个prepare只在内存中构造Config/Bridge/Record目标材料、验证打包Bridge的PE/hash/piped契约并计算确定性staging/capture路径，不创建正式artifact或修改稳定目标。完整Prepared Journal原子持久化成功后，必须先重新读取三目标并由`verify_artifact_matches_expected_original()`确认均为Original/ExpectedAbsent，才创建prepared backup/temp/removal staging。这个optimistic precondition check只验证预览时稳定目标未改变，不构成原子CAS；staging verification验证事务artifact符合计划摘要。所有staging通过Handle身份/摘要验证、capture路径条件和当前Prepared Journal ID共同形成唯一`all-staging-ready`屏障，之后existing/absent/removal才分别调用统一原子接口。两个handle共享同一transactionId并由同一Journal推进Prepared→BridgeApplied→ConfigApplied→StructureCommitted；两个`commit()`只终结进程内资源，StructureCommitted才是跨进程提交点。

`acquire_stable_artifact_lease()`固定调用`CreateFileW`，DesiredAccess=`GENERIC_READ | FILE_READ_ATTRIBUTES`、ShareMode=`FILE_SHARE_READ`、CreationDisposition=`OPEN_EXISTING`；严禁添加`FILE_SHARE_WRITE | FILE_SHARE_DELETE`。成功后从同一Handle取得volume serial、128位file ID、size与必要属性，`hash_artifact_through_lease()`只通过该Handle读取并在摘要前后复核身份/size；禁止`std::fs::read(path)`或重新按路径打开关键事务摘要。路径随后取得不同file ID时返回`IdentityChanged`并保留证据。`ERROR_SHARING_VIOLATION`不能可靠区分活动writer、writable mapping或delete/rename access，生产层只返回`StableArtifactLeaseError::SharingViolation`并统一映射成`CodexIntegrationError::ActiveArtifactHandleConflict`；UI只显示“目标文件正在被其他程序占用，请关闭相关程序后重新尝试安全恢复。”，不得声称识别具体进程、Handle类型或mapping。可复用最多三次、间隔50ms的短重试，仍失败立即停止Runtime、保留Journal/target/capture/prepared backup并发布config_conflict，只允许安全retry。

Install、Repair、Uninstall的正式顺序统一为：静态Inspection → 展示预览 → 用户确认 → 分配transactionId → pure prepare Config/Bridge/Record → 持久化Prepared → 三目标optimistic precondition check → 创建并验证prepared backup、target temp与removal staging → `all-staging-ready` → Bridge/Record原子操作 → BridgeApplied → 必要临时Runtime → Config原子操作 → ConfigApplied → action-specific invariant → StructureCommitted → 释放普通事务Lease → 新cleanup Handle清理普通事务产物 → 发布awaiting_trust、partial、not_installed或service_error → 完整self-check → 等待self-check完成后第一条新的当前generation真实认证Hook → running。Config应用前只核对仍持有的Bridge/Record Lease，不重跑optimistic precondition check；late modification由统一原子语义捕获。某action不涉及的资源可按已满足/无需变更推进，但不得调换阶段或增加phase。临时Runtime在self-check完成前收到的事件只记认证活动，不能进入running。

`target_bridge_exists`/`target_record_exists` 是支持 Uninstall 的附加存在性事实；为 false 时 target digest 固定为 SHA-256(empty bytes)，存在性位区分缺失与零字节文件。配置/Bridge/记录分别按 existedBefore、originalDigest、targetExists、targetDigest、当前存在性与当前 digest 分类成 `Original|Target|ExpectedAbsent|ExternalModification`；optimistic precondition check可按路径提前发现变化，但原子操作后的关键分类必须来自Lease。每个existedBefore prepared backup都必须由当前原字节生成，create_new/write/flush/close后取得prepared backup Lease并通过Handle确认originalDigest；existedBefore=false必须prepared backup=None且目标仍缺失。Prepared正常分支只清理Journal明确拥有的staging并保持目标不变；阶段落盘滞后时，所有实际存在的target/capture/prepared backup先获取Lease再分类。BridgeApplied/ConfigApplied恢复优先级固定为：当前目标→replaced snapshot/removed tombstone/conflict-preserved-current→prepared backup→Journal摘要；高优先级文件Lease失败时不得降级到prepared backup，任何`ActiveArtifactHandleConflict`、ExternalModification或preserved conflict都不覆盖并返回Conflict。

Atomic existing-file replacement固定调用`ReplaceFileW(target, replacement_temp, transaction_owned_replaced_snapshot, ...)`。成功后固定获取target Lease→snapshot Lease→分别通过Handle计算摘要→验证两个file ID不同；两个Lease均成功、target=`targetDigest`、snapshot=`originalDigest`才允许继续。任一Lease失败直接`ActiveArtifactHandleConflict`，禁止按路径读取、清snapshot或继续下一文件。snapshot稳定但不等于originalDigest时才返回`CapturedLateModification`。只有target/snapshot Lease都成功且摘要稳定，才可决定第二次恢复；执行前释放相关Lease，再以`ReplaceFileW(current_target, replaced_snapshot, conflict-preserved-current, ...)`恢复真实外改并保存CodePulse Target，随后重新获取restored target和conflict-preserved-current Lease并通过Handle验证。第二次操作后任一Lease/摘要失败都保留两版并Conflict；snapshot Lease失败时绝不自动执行第二次ReplaceFileW。

Atomic absent-file publication固定为同目录no-replace move/rename，不带`MOVEFILE_REPLACE_EXISTING`。目标在最后一次检查后出现时返回`DestinationAppeared`，外部目标字节与transaction temp都保留；成功后立即获取target Lease并只通过Handle验证targetDigest，Lease失败或摘要不符时target保留且Conflict。Atomic removal capture固定把Bridge/Record no-replace原子rename到本transactionId removed tombstone，禁止直接`DeleteFileW`；成功后取得tombstone Lease、通过Handle验证摘要并确认target absent。tombstone Lease失败时不按路径读取、不永久删除、不进入Uninstalled invariant；稳定摘要不符且target仍absent时才允许释放Lease后no-replace恢复，并在恢复后重新获取target Lease验证；目标已重建时保留两者并Conflict。

稳定Journal存在时，恢复以其transactionId为唯一权威ID，只处理该ID的Journal temp、三目标staging与backup，其他ID文件仅诊断。稳定Journal不存在时只枚举`.<journal-filename>.codepulse-<32hex>.tmp`：候选必须完整反序列化、文件名ID=内容ID、stage=Prepared、三目标仍Original/ExpectedAbsent且同ID无目标staging/backup，才作为Prepared-only孤立temp删除；一个或多个合法候选都可清理。损坏、ID不符、stage非Prepared、目标变化或同ID staging存在时保留并`OrphanTransactionConflict`，Runtime不启动、目标不改。此算法依赖单实例插件；未来移除单实例前必须先加进程间事务锁。

回滚按 action 区分：Install 的 Bridge 原先不存在，只有确认配置不再引用稳定路径才能处理新 EXE；Repair 的 Bridge 原先存在，优先使用ReplaceFileW实际捕获且摘要等于originalDigest的replaced snapshot恢复同路径旧EXE/旧记录，prepared backup只作低优先级后备；稳定路径仍被 Hook 引用不构成冲突，引用检查只防删除。Uninstall同样执行Prepared→Bridge/Record capture→BridgeApplied→Config marker removal→ConfigApplied→StructureCommitted；只有已经成功取得tombstone Lease并完成Handle摘要验证的部分捕获，才可继续处理仍存在的剩余目标。任一捕获后Lease失败、外部修改或Config应用失败时立即停止并按Journal阶段与真实Handle身份恢复或Conflict，保留目标与tombstone；Runtime stop/clear属于StructureCommitted后的编排。

StructureCommitted 使用 action-specific invariant：Install要求Marker=Exact、原用户Hook保留、Bridge版本/摘要/PE属性正确、Record与最终结构一致且Runtime请求意图明确，但没有真实事件时不得声明running；Repair还要求缺失/旧Bridge与CodePulse Hook已修复、非CodePulse Hook未被破坏或误删；Uninstall要求只移除CodePulse Hook、用户其他Hook保持、Marker=Absent、配置不再引用稳定Bridge、Bridge/记录目标路径均absent且对应tombstone Lease稳定并受当前Journal控制。所有稳定target/capture普通Lease保持到StructureCommitted落盘；阶段推进失败不得提前释放并继续，Lease不写Journal，崩溃恢复重新获取。StructureCommitted落盘后释放全部普通事务Lease，正常artifact只调用`delete_verified_artifact_by_handle`：新开DesiredAccess=`GENERIC_READ | DELETE`、ShareMode=`FILE_SHARE_READ`、CreationDisposition=`OPEN_EXISTING`的cleanup Handle，使用新取得的同一 cleanup Handle 完成file identity读取、expected digest计算、identity/digest复核和`SetFileInformationByHandle(FileDispositionInfo)`删除标记；关闭后检查路径absent、delete pending或path reuse。禁止给原普通Lease增加`DELETE`、释放Handle后按路径`DeleteFileW`、先按路径读摘要再按路径删除，或把cleanup Handle描述成事务Lease。cleanup失败只Warning并保留StructureCommitted Journal供startup retry，不回滚正确结构、也不映射为整体安装失败；Conflict snapshot/tombstone/conflict-preserved-current永不进入普通cleanup。

Uninstall 使用相同 Journal与相同四阶段：Prepared 后先逐文件原子捕获Bridge/记录到removed tombstone并取得tombstone Lease，再持有Lease推进BridgeApplied；随后只删除CodePulse marker并推进ConfigApplied。Bridge目标absent但Record仍present时继续捕获Record，反向同理；两目标absent、marker=Absent、用户其他Hook保持且tombstone均在Lease下通过Handle摘要验证并受Journal控制后，才通过`Uninstalled` invariant并保持全部Lease推进StructureCommitted。之后先释放普通事务Lease，再使用新取得的cleanup Handle完成普通artifact清理；Runtime停止、Store高revision空快照和not_installed发布由后续Runtime编排完成。恢复时若配置被用户修改、Bridge/记录是ExternalModification、tombstone Lease/Handle摘要异常或目标路径被重新创建，则Conflict并保留所有版本。

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
04B-1 Transaction + Atomic Files
 ↓ review 并明确批准
04B-2 Config Writer + Bridge Installer
 ↓ review 并明确批准
04B-3 Tauri Commands + Runtime Orchestration
 ↓ review 并明确批准
04C Settings + A自动行为矩阵 + B App真实验收 + C独立CLI真实验收
 ↓ 最终 review
```

| 批次 | 详细计划 | 独立交付物 | 禁止范围 |
|---|---|---|---|
| 04A | `docs/superpowers/plans/2026-07-16-codex-status-island-04a-inspection-planner.md` | TempDir 只读静态 inspection、Feature alias 事实、绑定稳定Bridge路径的标准JSON/TOML Fixture CodePulse-owned projection、generation runtime facts、独立listening派生、action matrix与纯计划 | 不写盘、不安装 Bridge、不注册 apply 命令、不修改 Vue |
| 04B-1 | `docs/superpowers/plans/2026-07-16-codex-status-island-04b-writer-installer.md` | 唯一Integration Journal、transactionId与owned staging、四正式阶段、optimistic precondition check、all-staging-ready、`ReplaceFileW`、absent no-replace publish、removal tombstone、普通Lease/file identity/Handle摘要、recovery、孤立Journal temp与fault injection | 禁止Tauri commands、Runtime启停、设置页和真实Bridge安装编排；完成后强制review |
| 04B-2 | 同上 | `ConfigApplyTransaction`、`BridgeInstallTransaction`、Bridge PE Machine/WindowsGui/hash/piped契约、Install/Repair/Uninstall coordinator、action-specific invariant、rollback优先级和StructureCommitted清理边界 | 依赖04B-1审核通过；禁止Tauri commands、Runtime和设置页；完成后强制review |
| 04B-3 | 同上 | inspect/preview/apply/retry commands、operation mutex、startup recovery、Inspection驱动Runtime、SnapshotStore clear、generation/DiscoveryOwner、ListeningStatus、self-check与公开错误映射 | 依赖04B-2审核通过；完成后强制review，之后才允许04C |
| 04C | `docs/superpowers/plans/2026-07-16-codex-status-island-04c-settings-e2e.md` | 静态/动态分离设置卡、alias提示/Conflict安全重试、disabled marker卸载、显示偏好、不同句柄场景统一冲突、使用新取得的同一 cleanup Handle、稳定事件跨层逻辑键与Session/Permission幂等公开行为、事务恢复的A自动行为矩阵，以及B App/C CLI真实验收 | 不新增配置写入逻辑；自动测试不冒充真实环境；环境阻塞的CLI不得声明通过 |

04B-1、04B-2、04B-3只是同一详细计划内的三个实施与审核停点，继续复用唯一Journal、`Prepared → BridgeApplied → ConfigApplied → StructureCommitted`状态机和已固定的公开接口；不得派生第二套Journal、动态phase、SnapshotStore或公开命令。

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

  预期：只出现04A文件清单；审核者明确批准前不得执行04B-1。

## 审核批次 04B-1

**Files:**

- Execute plan: `docs/superpowers/plans/2026-07-16-codex-status-island-04b-writer-installer.md`
- Consume from 04A: `CodexIntegrationInspection`、`PreparedCodexHookChange`、`derive_startup_runtime_decision()`
- Produce for 04B-2: 唯一Journal、原子文件、普通Lease、恢复和fault injection基础

- [ ] **步骤 1：在 04A 已批准后仅执行 04B-1**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests -- --nocapture
  Pop-Location
  ```

  预期：只覆盖唯一Integration Journal、transactionId/owned staging、四正式阶段、optimistic precondition check、all-staging-ready、existing/absent/removal原子语义、普通Lease/file identity/Handle摘要、recovery、孤立Journal temp和fault injection；生产层不同占用来源统一得到`SharingViolation`。不得出现Tauri commands、Runtime启停、设置页或真实Bridge安装编排。

- [ ] **步骤 2：停下来审核 04B-1**

  运行：

  ```powershell
  git diff --name-only
  git diff --check
  ```

  预期：没有Tauri commands、Runtime、dashboard/settings Vue或真实Bridge安装编排；审核者明确批准前不得执行04B-2。

## 审核批次 04B-2

- [ ] **步骤 1：在04B-1已批准后仅执行04B-2**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::installer_tests -- --nocapture
  Pop-Location
  ```

  预期：只接入`ConfigApplyTransaction`、`BridgeInstallTransaction`、PE/hash/piped契约、Install/Repair/Uninstall coordinator、action-specific invariant、rollback优先级和StructureCommitted前后清理边界。普通Lease在StructureCommitted后释放；普通artifact使用新取得的同一 cleanup Handle 完成身份/摘要验证与删除标记，失败只Warning且不回滚已提交结构。不得出现Tauri commands、Runtime或设置页。

- [ ] **步骤 2：停下来审核 04B-2**

  运行：

  ```powershell
  git diff --name-only
  git diff --check
  ```

  预期：复用04B-1的唯一Journal、四阶段状态机和公开接口；审核者明确批准前不得执行04B-3。

## 审核批次 04B-3

- [ ] **步骤 1：在04B-2已批准后仅执行04B-3**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  Pop-Location
  ```

  预期：只接入inspect/preview/apply/retry commands、integration operation mutex、startup recovery、Inspection驱动Runtime start/stop、SnapshotStore clear、generation/DiscoveryOwner、ListeningStatus、self-check和稳定公开错误映射；占用冲突只显示通用安全恢复文案，不诊断来源。

- [ ] **步骤 2：停下来审核 04B-3**

  运行：

  ```powershell
  git diff --name-only
  git diff --check
  ```

  预期：没有第二套Journal、状态机、动态phase、SnapshotStore或公开接口；审核者明确批准前不得执行04C。

## 审核批次 04C

**Files:**

- Execute plan: `docs/superpowers/plans/2026-07-16-codex-status-island-04c-settings-e2e.md`
- Create verification at execution time only: `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`

- [ ] **步骤 1：在 04B-3 已批准后执行 04C 计划**

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

  预期：设置/UI与A自动行为矩阵通过；B App真实验收和C独立CLI真实验收分别记录。真实验收记录只在04C实际实施时创建。

- [ ] **步骤 2：停下来完成最终审核**

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  git diff --check
  git status --short
  ```

  预期：App 真实 Hook 信任结果如实记录；独立 CLI 不可用时写“环境阻塞”并阻止完整兼容声明。

## 阶段四总门禁

- 04A、04B-1、04B-2、04B-3、04C依序完成且每个边界后都有独立review结论；04B三个停点只使用同一Journal、状态机、公开接口和SnapshotStore。
- HooksDisabled 阻止 install/repair；local disabled 且存在可安全解析 marker 时只允许预览、确认并执行统一Uninstall事务，不安装Bridge、不启动HTTP；managed disabled 与 ambiguous conflict 不产生任何写计划或Journal。
- `features.codex_hooks` 仅只读兼容并显示弃用提示；同值双键发 Duplicate warning，冲突/非布尔时 Runtime 停止且 install/repair/uninstall 均 ConfigConflict；CodePulse 永不改写 Feature 键或企业文件。
- `codepulse-hooks-exact.json` 与 `.toml` 是唯一标准结构，完整八事件、command+Windows override、timeout=2、无 matcher/statusMessage/async；JSON/TOML分别通过serde_json/toml_edit AST注入。Exact显式绑定`paths.installed_bridge`，只提取双command精确匹配、无额外参数且matcher合法的CodePulse-owned projection；wrong-path不可能Exact，用户独立Hook不进入projection，混合group Repair后用户handler保留且CodePulse group独立。Inspection、Planner、Repair、快照与E2E共用同一loader。
- 静态 inspection 的 managedEntry=exact/modified/duplicate 或带安全 marker 且表示可解析时按决策启动；absent/disabled/managed disabled/ambiguous conflict 不常驻；partial 等动态 phase 只由 listening status 派生。
- Runtime stop/uninstall/无旧合法 Runtime 的 install 失败按固定顺序发布更高 revision 空快照；重新安装后的任务 revision 继续递增，旧 Vue 任务被清除。
- 每个新 Runtime generation 清空认证事实，旧 reporter/关闭回调被忽略；重新安装在第一条真实新 Hook 前保持 awaiting_trust/partial。
- Discovery 的 shutdown/invalidate/serve/drop/stop/Exit 全部比较 version/PID/token/startedAt；旧 Runtime 不误删新文件。
- Integration Journal的正式顺序是用户确认→allocate ID→pure prepare Config/Bridge/Record→persist Prepared→三目标optimistic precondition check→创建并验证staging→all-staging-ready→Bridge/Record atomic→BridgeApplied→Config atomic→ConfigApplied→action-specific invariant→StructureCommitted。Prepared前崩溃零正式Journal/staging；Prepared后提前发现变化时不创建新staging。每个prepared backup通过Handle匹配originalDigest；existing文件由ReplaceFileW捕获replaced snapshot并同时冻结target/snapshot，absent文件no-replace发布后冻结target，Uninstall原子rename后冻结tombstone。所有普通事务Lease保持到StructureCommitted，之后先释放，再只对普通artifact新开`GENERIC_READ | DELETE`、仅`FILE_SHARE_READ`的cleanup Handle并在同一Handle完成身份/摘要校验和删除标记；Conflict artifacts保留。cleanup失败只Warning并由startup recovery重试，不回滚正确提交，也不变成Conflict或整体安装失败。
- CodePulse只管理用户层Hook；跨用户层、仓库层或插件层重复启动时，Tool/Subagent/Turn由阶段二Actor的第二层有界逻辑键消除重复，Session/Permission由Actor的事件级幂等策略抑制重复副作用。不承诺Permission可通过现有字段无损精确去重，不显示无法证明的全局唯一状态，也不扫描仓库。
- 验收证据固定分为A自动行为矩阵、B Codex App真实验收、C独立CLI真实验收。直接POST、模拟`source='cli'`或mock父进程链不能替代真实CLI；CLI不可用只能记录“环境阻塞”，此时可单独通过App门禁，但不得声明Windows原生CLI与App完整正式兼容。
- 稳定Journal存在时只处理其权威ID；无稳定Journal时仅合法Prepared-only孤立Journal temp可清理，异常temp保留并OrphanTransactionConflict、Runtime停止。Conflict UI只提供“重新尝试安全恢复”；retry共用operation mutex、无事务返回NoPendingTransaction、成功后重新Inspection/Runtime决策/ListeningStatus，不存在force overwrite/discard/ignore功能。
- 用户其他 Hook 在 install/repair/uninstall 后语义保持；卸载不恢复整份旧备份。
- idlePersistent 不启动服务，也不把未安装、禁用、冲突或服务错误伪装为已就绪。
- Bridge crate root 与打包/安装同时验证 Windows GUI Subsystem 和目标 PE Machine；旧 target、错架构或 Console Subsystem 不能通过门禁，真实多 Hook 验收无控制台闪烁。
- `AtomicIntegrationFs`除既有五个注入点外还提供`BeforeStableLeaseAcquire`、`AfterStableLeaseAcquireBeforeHash`、`AfterHashBeforeStagePersist`、`BeforeVerifiedHandleDelete`；范围脚本阻止snapshot/tombstone路径型关键摘要、原子操作后缺Lease、recovery在Lease失败后降级、阶段落盘前释放Lease、路径型`DeleteFileW` cleanup及Conflict artifact进入普通cleanup。
- 验收记录路径唯一为 `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`。
- 全部完成后停止，不自动开展下一版功能。
