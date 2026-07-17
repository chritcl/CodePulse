# 阶段四 B：Writer、Bridge Installer 与 Tauri Commands 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 04A 只读 inspection/planner 已审核通过后，实现并发安全且可跨进程恢复的统一 Integration Transaction、目标架构正确的 Bridge 稳定安装、Tauri inspect/preview/apply/安全恢复命令，以及由 startup inspection/install/uninstall 驱动的 HTTP/Actor 生命周期。

**架构：** apply coordinator 在重新 inspection/双摘要后先分配 transactionId，再让 writer 和 installer 纯准备 `ConfigApplyTransaction`/`BridgeInstallTransaction`；完整 Prepared Journal 原子持久化前不创建 staging、不修改目标。Prepared 后的三文件摘要重读统一称为optimistic precondition check，只负责提前发现变化；prepared backup/temp与all-staging-ready守住首个原子操作。existing目标由`ReplaceFileW`替换并把实际旧内容捕获为transaction-owned replaced snapshot，absent目标由no-replace同目录原子move发布，Uninstall把Bridge/Record原子rename为removed tombstone；每次原子操作成功后立即以仅共享读的`StableArtifactLease`冻结实际target与capture，关键摘要和身份只从Handle取得，Lease保持到对应Journal阶段落盘。两个句柄共享同一 transactionId，并由 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json` 的唯一 Integration Journal 协调；Journal 以 Prepared、BridgeApplied、ConfigApplied、StructureCommitted 四阶段记录三类目标的摘要和temp/prepared backup/replaced snapshot/tombstone/conflict-preserved-current，但不序列化Lease。startup orchestrator 严格执行统一恢复→静态 inspection→runtime generation 决策→状态发布；孤立 Journal temp 只按精确 Prepared-only 规则处理。apply command 只在 action-specific StructureCommitted 前允许逐文件回滚；安全 retry 命令重新获取Lease并只重跑同一恢复状态机。StructureCommitted后先释放普通事务Lease，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记；stop/uninstall 时清空 Manager 持有的唯一进程级 `CodexSnapshotStore`。Vue 设置页不在本批次实现。

**技术栈：** Rust、sha2、Windows `CreateFileW`/`MoveFileExW`/`ReplaceFileW`/`GetFileInformationByHandle`/`GetFileInformationByHandleEx`/`SetFileInformationByHandle`、Tauri 2.11.5 async runtime、Tokio、阶段一 PE/路径契约与阶段二 Runtime Manager；不新增前端依赖。

## 全局约束

- 前置门禁：04A 全部通过并已单独 review。
- 本计划服从设计→Roadmap→详细计划的规范层级；安全执行顺序若影响产品流程必须先同步设计，公共接口或全局不变量变化必须同步Roadmap与全部消费者。
- writer、installer、runtime、self-check 与 commands 只消费同一个 `CodexIntegrationPaths`。
- 唯一事务路径字段是 `integration_transaction_file`；只有 `paths.rs` 可以拼接 `codex-integration-transaction.json`，Writer、Installer、Startup、Commands 与测试只消费字段。
- `features.hooks=false` 的 install/repair 在进入 installer/runtime/writer 前返回 HooksDisabled；有安全 marker 的 uninstall 允许进入 writer，但不安装 Bridge、不启动 HTTP。managed disabled 三种 action 全部零写入。
- runtime startup 只由 04A decision 或 install/repair self-check 启动；idlePersistent 没有调用路径。
- `CodexRuntimeManager::new(app, paths, snapshot_store)` 显式接收 setup 唯一创建的 Store；04B 不增加第二个 managed state，startup/commands/Actor/stop/restart 都通过 `runtime.snapshot_store()`。
- Feature alias conflict 或非布尔在进入 installer/runtime/writer 前返回 ConfigConflict；三种 action 均零写入、Runtime RemainStopped并发布 config_conflict。
- modified 允许服务启动但禁止后台覆盖配置；只有显式 Repair preview/apply 可修改。
- 卸载先移除并验证 marker，再停服务并发布更高 revision 空快照，最后把Bridge/Record原子rename到removed tombstone；捕获或StructureCommitted后清理失败不恢复 Hook。
- 每个新 Runtime generation 清空认证事实；旧 generation reporter/关闭回调不得更新新 Runtime。
- Discovery 的 stop/exit/drop 清理只使用完整 `DiscoveryOwner`；不允许只比 PID 或 startedAt。
- 正式顺序统一为 allocate transactionId → pure prepare Config/Bridge → persist Prepared Journal → create owned staging → apply；禁止 prepare handle 后再分配 transactionId。
- Prepared Journal持久化后、create owned staging前必须对Config/Bridge/Record执行optimistic precondition check；每个prepared backup/temp验证摘要，全部staging/capture路径与当前Journal ID形成屏障。该检查不是原子CAS，不得用早期expectedDigest或最后一次重读结果作为覆盖依据。
- 所有 transaction temp/prepared backup/replaced snapshot/removed tombstone/conflict-preserved-current 路径都由 transactionId+target filename 确定性推导并写入同一 Journal；Prepared 恢复只清理该 Journal 明确拥有且可证明为普通staging的路径，不扫描其他 `.codepulse-*` 文件。`CodexIntegrationPaths` 不增加 staging 字段，禁止第二日志。
- Conflict不得提供强制覆盖、强制丢弃或忽略摘要；只能通过`retry_codex_integration_recovery`在用户手工恢复到Journal已知状态后重跑安全恢复。
- 普通`StableArtifactLease`、`StableArtifactIdentity`与`AppliedArtifactLeases`只属于当前进程内事务句柄，不得derive Serialize/Deserialize，不进入Journal、不成为第二套状态源；普通Lease固定以`GENERIC_READ | FILE_READ_ATTRIBUTES`、仅`FILE_SHARE_READ`、`OPEN_EXISTING`取得，持有到对应Journal阶段或StructureCommitted落盘。StructureCommitted后释放它；cleanup必须新开`GENERIC_READ | DELETE`、仅`FILE_SHARE_READ`、`OPEN_EXISTING`的Handle。禁止给普通Lease增加`DELETE`或把两者描述为同一Handle。
- 本计划包含04B-1、04B-2、04B-3三个强制审核停点；每个停点完成后立即停止，未获批准不得继续下一个，04B-3审核通过后才允许进入04C。
- 2026-07-17 重新核对 Microsoft 官方 [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)、[ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)、[MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)、[SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)、[GetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle)、[GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)、[FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)、[CreateFileMappingW](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-createfilemappingw)、[MapViewOfFile](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile)、[DeleteFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew)与[Closing and Deleting Files](https://learn.microsoft.com/en-us/windows/win32/fileio/closing-and-deleting-files)。官方语义固定本计划：`CreateFileW`在省略`FILE_SHARE_WRITE`时会因既有写访问或write-access file mapping返回sharing violation，省略`FILE_SHARE_DELETE`排斥delete/rename访问；`FILE_ID_INFO`的volume serial与128位file ID共同标识文件；`ReplaceFileW`捕获实际被替换文件且三路径同卷；no-replace move不覆盖；`SetFileInformationByHandle(FileDispositionInfo)`以带`DELETE`的同一Handle标记对象删除。路径摘要后再按路径恢复或删除不能证明是同一file ID。

## 三个强制实施与审核边界

| 审核点 | 仅允许范围 | 明确禁止 | 进入条件与停点 |
|---|---|---|---|
| 04B-1 事务与原子文件基础设施 | Integration Journal；transactionId与owned staging；Prepared/BridgeApplied/ConfigApplied/StructureCommitted；optimistic precondition check；all-staging-ready；`ReplaceFileW`；absent no-replace publish；removal tombstone；普通StableArtifactLease；file identity；Handle摘要；recovery；orphan Journal temp；fault injection | Tauri commands、Runtime启停、设置页、真实Bridge安装编排、`ConfigApplyTransaction`、`BridgeInstallTransaction` | 04A已审核；完成后强制停止review |
| 04B-2 Config Writer与Bridge Installer | `ConfigApplyTransaction`；`BridgeInstallTransaction`；PE Machine/WindowsGui/hash/piped；Install/Repair/Uninstall coordinator；action-specific invariant；rollback优先级；StructureCommitted前后清理边界 | Tauri commands、Runtime启停、设置页 | 04B-1已审核；完成后强制停止review |
| 04B-3 Tauri Commands与Runtime编排 | inspect/preview/apply/retry commands；operation mutex；startup recovery；Inspection驱动Runtime start/stop；SnapshotStore clear；generation/DiscoveryOwner；ListeningStatus；self-check；公开错误映射 | 设置页与04C验收实现 | 04B-2已审核；完成后强制停止review，之后才允许04C |

三个审核点复用同一`integration_transaction_file`、同一`Prepared → BridgeApplied → ConfigApplied → StructureCommitted`状态机、同一SnapshotStore和同一组固定公开接口；不得借审核点创建第二套Journal、动态phase、状态机、Store或命令。

---

## 04B-1／任务 1：实现事务与原子文件基础设施

**独立交付物：** 配置与 Bridge 共享一个可持久化、可跨进程恢复的 Journal；只有 inspection 输入和 preview 均未变化时才创建 Prepared，任一崩溃点都能按阶段和摘要恢复且不覆盖用户新字节。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/transaction.rs`
- Create: `src-tauri/src/codex/integration/transaction_tests.rs`

**消费接口：** 04A `PreparedCodexHookChange`、`expectedDigest`、`previewDigest`、`CodexIntegrationPaths.integration_transaction_file`、Bridge 安装前后摘要与安装记录摘要。

**产生接口：**

```rust
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

pub struct TransactionArtifactExpectation<'a> {
    pub existed_before: bool,
    pub original_digest: Option<&'a str>,
    pub target_exists: bool,
    pub target_digest: &'a str,
}

pub struct ObservedTransactionArtifact<'a> {
    pub exists: bool,
    pub digest: Option<&'a str>,
}

pub fn classify_transaction_artifact(
    expected: TransactionArtifactExpectation<'_>,
    observed: ObservedTransactionArtifact<'_>,
) -> TransactionArtifactState;

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

pub enum AtomicIntegrationFsInjectionPoint {
    BeforeAtomicReplace,
    AfterTargetOpenedOrPrepared,
    AfterAtomicReplaceBeforeVerification,
    BeforeConflictRestore,
    AfterRemovalCaptureBeforeVerification,
    BeforeStableLeaseAcquire,
    AfterStableLeaseAcquireBeforeHash,
    AfterHashBeforeStagePersist,
    BeforeVerifiedHandleDelete,
}

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

pub enum CodexIntegrationRecoveryOutcome {
    NoPendingTransaction,
    CleanedOrphanPreparedTemps,
    CleanedPreparedTransaction,
    RestoredBridgeApplied,
    PromotedStructureCommitted,
    RolledBackConfigApplied,
    CleanedStructureCommitted,
    Conflict,
    Warning,
}

pub fn recover_interrupted_codex_integration_transaction(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationRecoveryOutcome, CodexIntegrationError>;
```

Journal禁止包含配置正文、Token、Hook输入、用户命令、项目路径正文、Bridge二进制内容、Handle、file ID或`StableArtifactLease`。`target_bridge_exists`/`target_record_exists`支持Uninstall缺失目标；为false时对应target digest固定为SHA-256(empty bytes)，存在性位区分缺失与零字节文件。Config的事务Target固定为存在且可解析，但`existed_before`允许为false，以支持新Hook文件按Absent语义首次发布。`transaction_id`固定为16个CSPRNG随机字节的小写32 hex，必须在`prepare_config_apply()`/`prepare_bridge_install()`之前分配；Config/Bridge句柄必须保存并测试同一个值。Config、Bridge和Record的temp、prepared backup、replaced snapshot、conflict-preserved-current与removed tombstone路径完全由`transactionId + target filename`确定性推导并写入同一Journal；固定后缀分别区分`.tmp`、`.prepared.bak`、`.replaced.snapshot`、`.conflict-current`、`.removed.tombstone`，禁止与transactionId无关的随机名。prepared backup是Prepared后创建的计划开始版本；replaced snapshot是`ReplaceFileW`实际替换瞬间捕获的旧目标；removed tombstone是Uninstall原子rename捕获且StructureCommitted前不可永久删除的目标。Journal自身的原子写temp由`paths.integration_transaction_file + transactionId`确定为`.<journal-filename>.codepulse-<transactionId>.tmp`；只有`transaction.rs`可更新Journal元数据，writer/installer不得创建第二日志或自行替换Journal。

`StableArtifactLease`固定以`CreateFileW`打开：DesiredAccess=`GENERIC_READ | FILE_READ_ATTRIBUTES`，ShareMode=`FILE_SHARE_READ`，CreationDisposition=`OPEN_EXISTING`。严禁为验证Lease添加`FILE_SHARE_WRITE`或`FILE_SHARE_DELETE`。这使既有活动写句柄、write-access file mapping、delete/rename access阻止Lease取得；Lease成功后，新的写访问、writable mapping所需写Handle、删除与重命名访问都因sharing violation失败，普通只读访问仍可建立。调用最多三次、间隔50ms的短重试；三次后仍是共享冲突，生产层只返回`StableArtifactLeaseError::SharingViolation`，再统一映射为`CodexIntegrationError::ActiveArtifactHandleConflict`，不无限等待。Win32原始`ERROR_SHARING_VIOLATION`不能可靠区分冲突来源；生产代码、日志与UI不得声称识别活动writer、writable mapping、delete/rename Handle或具体占用进程。UI固定使用“目标文件正在被其他程序占用，请关闭相关程序后重新尝试安全恢复。”。测试可以分别制造各场景，但生产断言必须相同。

Lease成功后，必须从同一Handle用`GetFileInformationByHandleEx(FileIdInfo)`取得64位volume serial与128位file ID，用`FileStandardInfo`取得size，用`FileBasicInfo`取得必要属性；`GetFileInformationByHandle`只用于交叉验证兼容字段，不允许回退到路径身份。`hash_artifact_through_lease()`使用该Handle的`ReadFile`/句柄位置读取全部字节，摘要前后再次取得identity/size并与Lease初值比较；禁止`std::fs::read(path)`、`File::open(path)`或任何重新按路径打开的关键事务摘要。需要确认Lease.path仍指向同一对象时，在原Lease仍持有下重新取得只读Lease并比较volume serial+file ID；不同即`IdentityChanged`，保留全部证据并Conflict。

`AppliedArtifactLeases`由04B-1提供，供04B-2的进程内coordinator handle消费，不derive序列化。`target=Some`是Existing/Absent成功结果的硬约束；Removal后原路径必须absent，因此`target=None`且`removed_tombstone=Some`是唯一合法结果。结果Lease按调用方指定的正式阶段持有；阶段写入失败时不释放Lease并继续其他目标，而是保留current target/capture/prepared backup/Journal并返回`IntegrationTransactionConflict`。StructureCommitted持久化成功后先释放普通事务Lease，再进入cleanup Handle流程；进程崩溃由OS关闭Handle，recovery重新获取普通Lease，Journal仍是唯一跨进程事实。Runtime启停、self-check和公开状态映射全部留给04B-3。

recovery必须先区分稳定Journal是否存在。稳定Journal存在时，完整解析它并以其中的transactionId为唯一权威ID，只处理该ID的Journal temp和Journal明确列出的Config/Bridge/Record staging/capture artifacts；其他ID文件都不删除，只记录不含用户正文的诊断项。稳定Journal不存在时，只枚举Journal目录中精确匹配`.<journal-filename>.codepulse-<32hex>.tmp`的候选，禁止扫描普通`*.codepulse-*`。每个候选都必须满足：文件名ID为32 hex；内容完整反序列化；内容ID等于文件名；stage=Prepared；Journal列出的Config/Bridge/Record仍为Original/ExpectedAbsent；不存在同ID的任何target temp/prepared backup/replaced snapshot/conflict-preserved-current/removed tombstone。全部满足的Prepared-only temp都可删除并返回`CleanedOrphanPreparedTemps`。任一候选损坏、ID不匹配、stage非Prepared、目标改变或存在同ID capture artifact时，保留全部异常证据并返回稳定`OrphanTransactionConflict`，不修改目标；是否停止Runtime由04B-3负责。

上述“稳定 Journal 不存在时可以判定孤立 temp”依赖 CodePulse 单实例插件：启动恢复期间不存在另一个正常 CodePulse 集成事务。测试必须显式固定这一前提；未来若移除单实例插件，必须先引入进程间 Integration Transaction 锁，再允许继续使用该恢复算法。

transaction prepare 是严格无目标副作用阶段：允许读取、计算摘要/目标字节/确定性staging/capture路径、验证PE/hash/piped进程契约并把材料保存在内存；禁止修改稳定Bridge、安装记录、Hook配置，禁止创建prepared backup/temp/snapshot/tombstone/Journal。coordinator构造含全部路径/摘要的Journal并成功持久化Prepared后，先执行一次三文件 **optimistic precondition check**：重新读取Config、Bridge、Record，分别调用`verify_artifact_matches_expected_original()`按Journal的existedBefore/originalDigest/targetDigest分类，只有三者都为Original/ExpectedAbsent才创建prepared backup/temp。Target或ExternalModification返回`ConcurrentModification`（恢复场景映射稳定Conflict）、保留Journal、不采用变化后的字节作为新Original，且不创建新staging、不修改目标。该检查只能提前发现修改，不能保证检查与后续Windows原子操作之间没有变化，禁止称为原子Compare-And-Swap。

每个existedBefore=true的prepared backup必须从当前目标重新读取原始字节，计算摘要并与Journal.originalDigest相等后，才以`create_new(true)`创建；随后write→flush→close→获取prepared backup Lease→通过Handle再次核对originalDigest。任一摘要、写入或Lease失败时不得开始任何目标操作。existedBefore=false时prepared backup必须为None且目标仍不存在；此时若目标出现，按ExternalModification处理。所有target temp同样在close后获取Lease并通过Handle验证targetDigest；这些staging Lease在首个原子操作前释放，以允许对应rename，但原子操作完成后必须获取结果Lease。targetExists=false的Uninstall不创建空payload temp，而是为removed tombstone准备确定性且必须不存在的目标路径，不能用零字节文件冒充absent。

第一个原子文件操作前存在不可绕过的all-staging-ready屏障：Config/Bridge/Record的prepared backup/temp（或removal无payload状态）全部准备并通过摘要验证；replaced snapshot、conflict-preserved-current、removed tombstone路径全部已写入Journal且操作前不得意外存在；重新读取的稳定Prepared Journal仍是当前transactionId。任何staging缺失、摘要错误、捕获路径意外出现或Journal ID/stage不符都不得开始。

`AtomicIntegrationFs`必须提供三种不同接口，writer与installer共同调用，禁止通用`move_with_replace(...)`：

- `atomically_replace_existing_artifact()`只处理`existed_before=true && target_exists=true`。先optimistic precondition check，再验证replacement temp的targetDigest与稳定Journal transactionId/阶段；随后调用`ReplaceFileW(target, replacement, transaction_owned_replaced_snapshot, ...)`。成功后的固定顺序是`BeforeStableLeaseAcquire`→获取target Lease→获取snapshot Lease→`AfterStableLeaseAcquireBeforeHash`→用两个Handle分别计算摘要→验证volume serial/file ID组合不同→`AfterHashBeforeStagePersist`。只有target=`targetDigest`、snapshot=`originalDigest`且两个Lease均成功才返回`AppliedExpectedOriginal`；任一Lease失败返回`ActiveArtifactHandleConflict`，不按路径读摘要、不清snapshot、不继续下一文件。snapshot稳定但不等于originalDigest才返回`CapturedLateModification`。
- `atomically_publish_absent_artifact()`只处理`existed_before=false && target_exists=true`。使用同目录no-replace原子move/rename，明确不带`MOVEFILE_REPLACE_EXISTING`。目标在最后一次检查后出现时原子操作失败并返回`DestinationAppeared`，保留外部目标和transaction temp；成功后立即获取新target Lease并只通过Handle验证targetDigest。外部在move后立即打开写入时，Lease失败或最终摘要不符；两种情况都不采用当前字节为事务Target、不删除target，保留Journal并Conflict。
- `atomically_capture_artifact_for_removal()`提供通用removal基础。在调用方完成业务前置检查后执行optimistic precondition check，把target no-replace原子rename到本transactionId removed tombstone；禁止`DeleteFileW`。成功后获取tombstone Lease、只通过Handle计算expectedDigest，并在Lease持有时验证原target absent。旧写句柄继续指向tombstone、writable mapping未释放或delete access仍活动时Lease失败；此时不按路径读取、不永久删除，保留Journal等待安全retry。配置引用检查和`Uninstalled` invariant属于04B-2 coordinator。

Existing replacement的snapshot只有在第一次`ReplaceFileW`后的target与snapshot Lease都成功、Handle摘要稳定且snapshot不等于originalDigest时，才固定重新分类当前target；snapshot Lease失败时禁止第二次ReplaceFileW。当前target仍等于本事务Target时，先记录稳定snapshot digest并释放相关Lease，再调用`ReplaceFileW(current_target, replaced_snapshot, transaction_owned_conflict_preserved_current, ...)`，把真实外部修改恢复到target并保存CodePulse Target；完成后重新获取restored target Lease与conflict-preserved-current Lease，分别验证restored target=第一次稳定snapshot digest、conflict-preserved-current=targetDigest。两个Lease都成功才记录恢复结果并返回Conflict；任一Lease/摘要失败时不清理任一版本，保留Journal和两个版本并Conflict。当前target已不等于本事务Target时，不覆盖当前target，同时保留replaced snapshot、prepared backup与当前target。不得用prepared backup覆盖late snapshot，不得自动选定哪个外部版本更正确。

Removal tombstone的Lease成功但Handle摘要不等于expectedDigest时不永久删除：若target路径仍absent，先释放会阻止rename的tombstone Lease，再只允许no-replace原子rename tombstone回原路径，随后获取restored target Lease并通过Handle验证；若target已重新创建，保留tombstone与新target并Conflict。Lease本身失败时禁止进入自动恢复rename。sharing violation、权限和`ReplaceFileW`部分失败状态都在能够取得Lease后按实际目标/snapshot/tombstone重新分类，绝不能假设Win32失败时所有路径原样，也不能在Lease失败后按路径降级。

阶段与恢复矩阵固定为。`recover_interrupted_codex_integration_transaction()`在分类任何实际存在的target、replaced snapshot、conflict-preserved-current、removed tombstone或prepared backup前，必须重新取得Lease并只通过Handle读取身份/摘要；Journal明确期望absent且`CreateFileW`返回`FileMissing`的可选路径只作为`ExpectedAbsent`，任何预期应存在的文件缺失及其他Lease错误都立即Conflict。BridgeApplied/ConfigApplied的检查优先级始终是：1当前目标；2replaced snapshot、removed tombstone、conflict-preserved-current；3prepared backup；4Journal摘要：

- Prepared：语义上没有已确认目标替换；正常分支不改目标，只清理Journal明确列出的本transactionId普通staging并返回CleanedPreparedTransaction。不得glob/扫描其他`.codepulse-*`。若实际target或捕获artifact显示原子操作已发生但阶段落盘滞后，进入BridgeApplied/ConfigApplied对应安全分支；ExternalModification时Conflict。
- BridgeApplied：配置仍为Original/ExpectedAbsent时，Bridge/Record均Original/ExpectedAbsent只清理；snapshot Lease成功且Handle摘要=originalDigest、target Lease成功且Handle摘要=targetDigest时逐文件恢复实际被替换版本；一个Target、另一个Original/ExpectedAbsent是合法双文件中间崩溃，只处理稳定Target。snapshot表示late modification时优先于prepared backup，按第二次ReplaceFileW双Lease规则处理；高优先级artifact的Lease失败时不降级到prepared backup。任一`ActiveArtifactHandleConflict`、ExternalModification、conflict-preserved-current或无法解释的snapshot都保留Journal/全部证据并Conflict。
- ConfigApplied：04B-1只输出Config/Bridge/Record的逐文件`Original|Target|ExpectedAbsent|ExternalModification`观察与稳定capture，不执行Install/Repair/Uninstall invariant或业务rollback选择；04B-2 coordinator消费这些事实决定action-specific分支。所有底层恢复在使用当前target、snapshot/conflict-current/prepared backup前都先Lease→identity→Handle摘要；准备ReplaceFileW/rename前只释放相关Lease，操作后立即重新获取结果Lease。
- StructureCommitted：保留已提交目标。持久化成功后释放普通Lease，普通prepared backup、正常original snapshot、已由04B-2 invariant批准的removed tombstone和transaction temp才能进入`delete_verified_artifact_by_handle()`；Conflict的replaced snapshot/tombstone/conflict-preserved-current永不进入普通成功清理。任一cleanup失败保留StructureCommitted Journal并返回Warning，不回滚结构。

恢复不得盲信阶段：若Prepared的实际逐文件状态已经出现Bridge/Record Target或对应snapshot，按BridgeApplied分支恢复；若BridgeApplied的Config已经是Target或存在Config snapshot，按ConfigApplied分支恢复。这覆盖任一原子操作成功但下一阶段Journal尚未持久化的崩溃窗口。既非已知目标状态、又不能由snapshot/tombstone解释的状态统一ExternalModification/Conflict。

`delete_verified_artifact_by_handle(path, expected_digest)`固定实现语义：StructureCommitted后先释放普通事务Lease；在`BeforeVerifiedHandleDelete`注入点后，以`CreateFileW(path, GENERIC_READ | DELETE, FILE_SHARE_READ, ..., OPEN_EXISTING, ...)`新开cleanup Handle。使用新取得的同一 cleanup Handle 完成`StableArtifactIdentity`读取、expected digest计算、identity/digest再次验证和`SetFileInformationByHandle(FileDispositionInfo { DeleteFile: TRUE })`删除标记，关闭后检查路径absent、delete pending或path reuse。摘要不符返回`RetainedDigestMismatch`且不删除；Handle无法取得时禁止调用路径型`DeleteFileW`，返回`RetainedActiveHandle` Warning；仍有兼容只读Handle导致delete pending时返回`DeletePending`，关闭后同名路径被外部重建则比较新Lease的file ID并返回`PathReusedAfterDelete`，绝不删除新对象。禁止给原普通Lease增加`DELETE`、释放Handle后按路径删除、先按路径读摘要再重新按路径删除，或把cleanup Handle与事务Lease描述成同一Handle。Journal只有在所有普通cleanup完成后才删除；cleanup失败不回滚正确提交，Conflict artifact在类型与调用点两层被排除。

- [ ] **步骤 1：先写摘要竞争、Journal 捕获路径与 prepared backup 失败测试**

  用通用artifact fixture覆盖expectedDigest/previewDigest不符与任一目标变化；每例断言不创建temp/prepared backup/snapshot/tombstone/Journal。成功路径仅验证transactionId在Prepared前已经分配并进入唯一Journal，不在04B-1实现或调用`ConfigApplyTransaction`、`BridgeInstallTransaction`。Prepared已持久化后先运行三目标optimistic precondition check；固定竞态为任一目标在staging前变化时不创建新staging、不修改目标。该检查只用于提前发现修改，不把它当作最后时刻竞态的完整证明。

  修改已有文件的prepared backup路径固定为`.<filename>.codepulse-<transactionId>.prepared.bak`，新建Hook文件prepared backup=None。Journal未持久化前所有捕获路径不存在；持久化后创建prepared backup必须断言“当前原字节摘要=Journal.originalDigest → create_new(true) → write/flush/close → 重读prepared backup → 摘要仍=originalDigest”。任一摘要不符、路径已存在、flush失败或重读不符时，三个目标都不得开始原子操作。序列化Journal必须包含三类target temp，以及Config/Bridge/Record适用的`prepared_backup_path`、`replaced_snapshot_path`、`conflict_preserved_current_path`、`removed_tombstone_path`；每个路径含同一transactionId，概念与后缀互不混用；不含配置正文、token、Hook stdin、用户command、项目cwd或Bridge bytes。

  孤立 Journal temp 固定测试：无稳定 Journal+一个合法 Prepared-only temp → 删除；无稳定 Journal+两个合法 Prepared-only temp → 两者都删除；内容 ID 与文件名不符 → 保留并 `OrphanTransactionConflict`；stage=BridgeApplied → 保留并 Conflict；Prepared temp但存在同 ID Bridge staging/capture artifact → 保留并 Conflict；稳定 Journal ID=A且存在 ID=B 的 Journal temp或普通目标 staging → 只处理 A并保留、诊断 B。测试不得再要求另一个合法 Prepared-only Journal temp永久保留，也不得扫描普通目标 `*.codepulse-*.tmp|bak`。模拟首次 Prepared 原子替换前崩溃时，只有符合完整孤立条件的 Journal temp可由文件名和内容 ID 精确认领并清理。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::journal -- --nocapture
  Pop-Location
  ```

  预期：统一Journal与事务基础不存在，测试失败；04B-1不创建writer或installer。

- [ ] **步骤 2：先写 existing/absent/removal、Stable Lease 与Handle cleanup精确竞态矩阵**

  `AtomicIntegrationFs`必须暴露精确注入点`BeforeAtomicReplace`、`AfterTargetOpenedOrPrepared`、`AfterAtomicReplaceBeforeVerification`、`BeforeConflictRestore`、`AfterRemovalCaptureBeforeVerification`、`BeforeStableLeaseAcquire`、`AfterStableLeaseAcquireBeforeHash`、`AfterHashBeforeStagePersist`、`BeforeVerifiedHandleDelete`；不能只在调用`MoveFileExW`前注入。测试抽象必须能建立已有写句柄、write-access file mapping、Lease成功后的新写/rename/delete请求、Lease释放后到原子恢复之间的竞态，以及cleanup Handle取得失败。保留Journal与temp create/write/flush/close/重读parse故障注入，同时覆盖`ReplaceFileW`官方失败状态`ERROR_UNABLE_TO_REMOVE_REPLACED`、`ERROR_UNABLE_TO_MOVE_REPLACEMENT`、`ERROR_UNABLE_TO_MOVE_REPLACEMENT_2`及其他错误（含sharing/access/invalid parameter），并在每次失败后只在取得Lease后按实际target/replacement/snapshot重新分类。另覆盖snapshot路径创建失败、snapshot Lease/Handle摘要失败、第二次安全恢复ReplaceFileW及后置Lease失败、no-replace rename返回目标已存在、tombstone rename/Lease失败、StructureCommitted后cleanup Handle失败。任何失败都不得无痕丢失当前target、replaced snapshot、tombstone或prepared backup。

  Existing正常路径固定断言：optimistic check通过→外部不修改→`ReplaceFileW`成功→target Lease→snapshot Lease→两个file ID不同→Handle snapshot=originalDigest→Handle target=targetDigest→`AppliedExpectedOriginal`并继续。最后时刻竞态固定在`AfterTargetOpenedOrPrepared`注入：“最后一次检查之后、系统原子替换内部之前”外部修改Config→ReplaceFileW捕获snapshot→两个Lease成功后Handle snapshot!=originalDigest→`CapturedLateModification`→不继续下一个文件。若当前target仍为CodePulse Target，只有两个Lease都稳定才在`BeforeConflictRestore`释放相关Lease并调用第二次ReplaceFileW；随后必须重新取得restored target/conflict-preserved-current Lease并通过Handle验证。snapshot Lease失败时禁止第二次ReplaceFileW；第二次后任一Lease失败时两个版本都保留并Conflict。

  Absent路径固定断言：检查时目标absent→`BeforeAtomicReplace`后外部创建目标→no-replace publish失败并返回`DestinationAppeared`→外部目标字节不变、transaction temp保留；publish成功后外部立即写打开target时，target Lease失败或Handle摘要不符，target保留且Conflict。Removal固定断言：Bridge/Record rename到tombstone后旧写句柄仍继续写→tombstone Lease失败→不按路径读取、不永久删除；旧句柄关闭后retry才获取Lease并用最终摘要分类；tombstone后目标路径被重新创建时两者保留。两个内部`commit()`不能删除尚未StructureCommitted的Journal或Conflict artifacts。

  精确句柄竞态测试名称与断言固定为：

  1. `existing_snapshot_active_writer_conflicts`：外部以`GENERIC_WRITE`及兼容`FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`打开原目标→`ReplaceFileW`成功→旧Handle继续指向snapshot→snapshot Lease取得失败→不读取不稳定摘要、不清snapshot、Conflict；
  2. `snapshot_retry_classifies_final_late_bytes`：第一次Replace后旧Handle继续写snapshot→CodePulse不得判断为Original→外部关闭Handle→retry取得Lease→读取最终snapshot digest→按late modification双Lease规则处理；
  3. `writable_mapping_never_allows_capture_cleanup`：原目标存在`PAGE_READWRITE`/`FILE_MAP_WRITE`映射→ReplaceFileW成功或sharing failure均可→映射对应capture Lease失败时不分类、不清理并Conflict；
  4. `lease_blocks_new_writer_and_keeps_digest`：Lease成功→另一线程请求`GENERIC_WRITE`得到`ERROR_SHARING_VIOLATION`→Lease期间两次Handle摘要一致；
  5. `lease_blocks_rename_and_delete`：Lease成功→另一线程rename/delete均sharing violation→volume serial/file ID与路径保持稳定；
  6. `absent_publish_immediate_writer_conflicts`：no-replace成功→外部立即写打开新target→Lease失败或digest不符→target保留、Journal保留、Conflict；
  7. `tombstone_old_writer_conflicts_then_retries`：rename到tombstone→旧写Handle继续写→Lease失败且不永久删除→关闭Handle后retry以最终Handle摘要重新分类；
  8. `second_restore_reacquires_both_leases`与`second_restore_active_handle_preserves_both`：稳定late snapshot→释放Lease→第二次ReplaceFileW→重新取得restored target/conflict-current Lease并验证；任一存在活跃写Handle时不清任何版本并Conflict；
  9. `verified_handle_cleanup_deletes_same_file_id`、`verified_handle_cleanup_blocks_path_replacement`、`verified_handle_cleanup_failure_is_warning`：StructureCommitted后先释放普通事务Lease，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和`FileDispositionInfo`删除标记；验证后外部替换路径被cleanup Handle阻止；cleanup失败保留文件与StructureCommitted Journal、返回Warning且不回滚。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::atomic -- --nocapture
  Pop-Location
  ```

  预期：故障注入测试失败。

- [ ] **步骤 3：先写九组固定崩溃恢复测试**

  测试名称与断言固定覆盖：

  1. Prepared Journal 写入前崩溃 → 稳定配置/Bridge/记录无变化且无不可追踪 staging；
  2. Prepared Journal 写入后、prepared backup/temp 只创建一部分时崩溃 → 目标不变，只清理本 transactionId 明确拥有的普通 staging；另一个 transactionId 的 staging/capture artifact 同时存在时不得删除；BridgeApplied Journal 已推进但 Bridge/记录均为 Original/ExpectedAbsent 时同样返回 CleanedPreparedTransaction且不改目标；
  3. BridgeApplied：artifact B=Target、artifact C=Original → 只恢复稳定Target，Original保持；
  4. BridgeApplied：artifact B=Original、artifact C=Target → 只恢复稳定Target，Original保持；
  5. BridgeApplied：artifact B=Target、artifact C=ExpectedAbsent → 只处理本事务Target；反向混合同理；不在04B-1判断Install/Repair语义；
  6. ConfigApplied：Config=Target、artifact B=Target、artifact C=Original → 输出逐文件稳定观察与capture，不执行action-specific顺序；
  7. ConfigApplied：三者Target → 输出可供04B-2 invariant使用的稳定事实，但04B-1不提升业务结果；
  8. artifact B=ExternalModification、artifact C=Target → Conflict，不覆盖外改；Config外改同理；
  9. StructureCommitted后、清理前崩溃 → 只清理当前transactionId的普通prepared backup、正常original snapshot、已批准tombstone、temp/Journal，不回滚结构；Conflict artifacts不清理。

  在九组基础上用通用Config/Bridge/Record artifact fixture增加精确原子回归：Prepared已持久化后目标外改且staging前由optimistic check发现；existing正常ReplaceFileW后target/snapshot双Lease且file ID不同；检查后/替换内部前外改由snapshot捕获；snapshot Lease失败不执行第二次ReplaceFileW；late snapshot且当前target=Target时释放Lease后二次ReplaceFileW并重新取得restored/conflict-current双Lease；late snapshot且当前target又外改时两者保留；absent目标最后时刻出现时no-replace失败，成功后target Lease；prepared backup Lease/摘要不符时零目标操作。04B-1只验证恢复基础，不运行真实Install/Repair/Uninstall coordinator或action-specific invariant；这些行为留到04B-2。

  removal基础另固定三组：artifact rename到tombstone后旧writer仍活动，tombstone Lease失败且不永久删除；tombstone后目标路径被重新创建，两者保留并Conflict；普通tombstone保持Lease推进StructureCommitted后先释放普通Lease，再使用新取得的同一 cleanup Handle 删除。真实Uninstall coordinator与`Uninstalled` invariant留到04B-2。

  另覆盖通用恢复优先级：当前target→replaced snapshot/tombstone/conflict-current→prepared backup→Journal摘要；任何高优先级Lease失败时不降级到prepared backup。Prepared+两artifact部分Target按BridgeApplied逐文件恢复；BridgeApplied+Config Target按ConfigApplied输出稳定观察；Journal损坏、IdentityChanged、ActiveArtifactHandleConflict或任一摘要既非原也非目标都Conflict且不覆盖。action-specific rollback与路径引用规则留到04B-2。recovery面对外部编辑器持有Handle先Conflict，关闭Handle后同一安全retry才能继续。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::recovery -- --nocapture
  Pop-Location
  ```

  预期：统一恢复函数不存在，测试失败。

- [ ] **步骤 4：实现统一Journal、原子文件与恢复基础**

  transactionId固定为32 hex；五类路径后缀按本任务接口固定且创建使用`create_new(true)`或Windows原子API。`classify_transaction_artifact()`按存在性/摘要输入逐文件分类；`verify_artifact_matches_expected_original()`每次重读path并返回Original/ExpectedAbsent/Target/ExternalModification，只作为原子操作前optimistic precondition check。原子操作后的分类与recovery基础必须使用`acquire_stable_artifact_lease()`+`hash_artifact_through_lease()`。04B-1只提供通用Prepared Journal、staging/all-staging-ready和三个原子接口，不实现Config Writer、Bridge Installer或真实action coordinator。

  Existing必须用`ReplaceFileW`并验证target/snapshot双Lease与不同file ID；late snapshot按“第一次双Lease稳定→释放→第二次ReplaceFileW→结果双Lease”规则恢复或保留全部版本。Absent必须no-replace发布后取得target Lease；Removal必须rename到tombstone后取得tombstone Lease，不能调用DeleteFileW。恢复基础支持四正式阶段但不在本审核点实现真实Config/Bridge编排或action-specific invariant。StructureCommitted是唯一跨进程提交点；之后先释放普通事务Lease，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记。稳定Journal存在时只处理权威ID；无稳定Journal时只执行精确Prepared-only孤立清理。所有unsafe块添加中文安全前提，保证UTF-16缓冲区与`FILE_DISPOSITION_INFO`调用期间存活、三条ReplaceFileW路径同卷，并把sharing violation统一映射为可恢复错误。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests -- --nocapture
  Pop-Location
  ```

  预期：ID-first prepare、Prepared 前零 staging、摘要、确定性 staging、原子序列、四阶段、九组逐文件崩溃恢复、阶段落盘滞后、通用恢复优先级、Conflict 与 cleanup Warning 全部通过；成功路径无 BOM/temp/Journal残留。04B-1不执行action-specific rollback。

- [ ] **步骤 5：完成04B-1门禁并强制停止review**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n 'join\("CodePulse"\)|join\("runtime"\)|join\("bin"\)|codex-integration-transaction' src-tauri/src/codex/integration --glob '!transaction_tests.rs'
  git diff --check
  ```

  预期：目录/事务文件名拼接无命中；所有检查通过；diff中没有writer/installer/Tauri commands、Runtime、设置页或真实Bridge安装编排。到此必须停止，未经04B-1 review批准不得继续04B-2。

  建议提交信息：

  ```text
  统一恢复 Codex 配置与 Bridge 事务
  ```

---

## 04B-2／任务 2：实现 Config Writer、Bridge Installer 与 action coordinator

**独立交付物：** 在04B-1审核通过后，Config Writer与Bridge Installer共同消费唯一Journal和原子基础；installer只接受与编译target一致且Subsystem=WindowsGui的合法PE，并由同一coordinator组织Install/Repair/Uninstall、action-specific invariant、rollback与清理边界。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/writer.rs`
- Create: `src-tauri/src/codex/integration/writer_tests.rs`
- Create: `src-tauri/src/codex/integration/pe.rs`
- Create: `src-tauri/src/codex/integration/pe_tests.rs`
- Create: `src-tauri/src/codex/integration/installer.rs`
- Create: `src-tauri/src/codex/integration/installer_tests.rs`
- Create: `src-tauri/src/codex/integration/coordinator.rs`
- Create: `src-tauri/src/codex/integration/coordinator_tests.rs`

**消费接口：** `paths.packaged_bridge`、`paths.installed_bridge`、`paths.install_record`、`env!("CODEPULSE_TARGET_TRIPLE")`、04A BridgeState/BridgeInstallRecord。

**产生接口：**

```rust
pub struct AppliedConfigFileChange {
    pub config_path: PathBuf,
    pub prepared_backup_path: Option<PathBuf>,
    pub new_digest: String,
}

pub struct AppliedConfigChange {
    pub files: Vec<AppliedConfigFileChange>,
    pub warnings: Vec<String>,
}

pub struct ConfigApplyTransaction;

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

pub enum CodexIntegrationCommitInvariant {
    InstalledOrRepaired,
    Uninstalled,
}

pub struct ObservedBridgeState {
    pub bridge_state: TransactionArtifactState,
    pub record_state: TransactionArtifactState,
    pub pe_hash_piped_contract_valid: bool,
    pub config_references_stable_bridge: bool,
}

pub fn validate_structure_commit(
    action: CodexHookAction,
    inspection: &CodexIntegrationInspection,
    bridge: &ObservedBridgeState,
) -> Result<CodexIntegrationCommitInvariant, CodexIntegrationError>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindowsPeMachine { Amd64, Arm64 }

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindowsPeSubsystem { WindowsGui }

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WindowsPeMetadata {
    pub machine: WindowsPeMachine,
    pub subsystem: WindowsPeSubsystem,
}

pub fn expected_pe_machine(
    target_triple: &str,
) -> Result<WindowsPeMachine, CodexIntegrationError>;

pub fn read_pe_metadata(
    path: &Path,
) -> Result<WindowsPeMetadata, CodexIntegrationError>;

pub fn verify_bridge_pe_metadata(
    path: &Path,
    target_triple: &str,
) -> Result<WindowsPeMetadata, CodexIntegrationError>;

pub struct BridgeInstallTransaction;
pub struct BridgeInstallOutcome {
    pub warnings: Vec<String>,
}

pub fn prepare_bridge_install(
    paths: &CodexIntegrationPaths,
    target_triple: &str,
    action: BridgeAction,
    transaction_id: &str,
) -> Result<BridgeInstallTransaction, CodexIntegrationError>;

impl BridgeInstallTransaction {
    pub fn apply(&mut self) -> Result<(), CodexIntegrationError>;
    pub fn commit(self) -> Result<BridgeInstallOutcome, CodexIntegrationError>;
    pub fn rollback(self) -> Result<(), CodexIntegrationError>;
}
```

`prepare_config_apply()`与`prepare_bridge_install()`都只验证/计算目标材料、原/目标摘要及由transactionId确定的temp/prepared backup/replaced snapshot/conflict-preserved-current/removed tombstone路径，并把待写字节保存在内存；禁止创建artifact、替换目标或创建Journal。调用方用相同transactionId构造并持久化完整Prepared Journal后，由同一coordinator完成三文件optimistic precondition check、prepared backup/temp Lease完整性与all-staging-ready屏障，才调用两个`apply()`。writer与installer只能调用04B-1统一existing/absent/removal原子接口，不得各自实现替换。任一`CapturedLateModification`、`DestinationAppeared`、`ActiveArtifactHandleConflict`或Handle摘要失败都停止，不继续下一文件，并按Lease稳定的实际target/capture action-aware恢复。Bridge/Record完成后保持Lease推进同一Journal到BridgeApplied，Config完成后保持全部最终Lease推进ConfigApplied；两个`commit()`只终结进程内资源。StructureCommitted落盘后释放普通事务Lease，并使用新取得的同一 cleanup Handle 完成普通artifact的身份校验、摘要校验和删除标记；Conflict artifacts保留。

`rollback()`必须action-aware：Install的`bridge_existed_before=false`只有在配置已回滚且不再引用稳定路径时才处理新Bridge；Repair的`bridge_existed_before=true`优先恢复ReplaceFileW实际捕获且Lease摘要=originalDigest的replaced snapshot到同路径，再恢复旧install record，prepared backup仅在高优先级capture不存在且其自身Lease/摘要稳定的安全分支作为后备。Hook一直引用相同路径不构成冲突，引用检查只防删除、不阻止同路径恢复。逐文件恢复先为当前target与所有Journal列出的capture/prepared backup重新获取Lease；任何高优先级Lease失败不降级、不覆盖并返回Conflict。执行恢复原子操作前释放相关Lease，完成后重新获取结果Lease验证。

`coordinator.rs`是04B-2内部模块，不新增Tauri command或第二套公开接口。它独占Install/Repair/Uninstall事务编排：重新inspection与双摘要由未来命令层提供后，执行ID分配、Prepared持久化、staging屏障、Bridge/Record应用、必要临时Runtime请求描述、Config应用、action-specific invariant、rollback和StructureCommitted清理边界。04B-3命令层只能调用这一内部coordinator并映射结果，不得复制十九步流程或另写原子文件规则。04B-2测试使用fake Runtime请求端口记录“需要启动/停止/clear”的意图，不实际启停Runtime；真实Runtime调用留到04B-3。

- [ ] **步骤 1：先写 PE/COFF 解析失败矩阵**

  fixture 覆盖空文件、只有 MZ、e_lfanew 越界、无 `PE\0\0`、未知 Machine、x64 target+ARM64 EXE、ARM64 target+x64 EXE、不支持 triple、Optional Header 太短、非法 PE Magic、x64/ARM64+Console Subsystem=3、未知 Subsystem；正例只允许 `0x8664`/x64+WindowsGui=2 与 `0xAA64`/ARM64+WindowsGui=2。每例同时与 Plan 01 PowerShell 验证脚本的期望码对齐。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::pe_tests -- --nocapture
  Pop-Location
  ```

  预期：旧 MZ-only 校验不能通过新增测试。

- [ ] **步骤 2：先写Config Writer、installer与action coordinator失败测试**

  覆盖transactionId先分配，两个prepare阶段只产生摘要/目标字节/确定性五类路径且文件系统零写入；未持久化Prepared Journal时Config/Bridge/Record不变。Prepared后先optimistic precondition check，再创建本ID prepared backup/temp并以Lease通过all-staging-ready。已有Config/Bridge/Record必须由ReplaceFileW捕获snapshot并取得target/snapshot双Lease；首次创建必须no-replace publish并取得target Lease。正常existing路径snapshot Handle=originalDigest、target Handle=targetDigest且file ID不同；最后一次检查之后、系统原子替换内部之前修改任一目标时snapshot捕获late modification且不继续；不同占用场景都只断言`SharingViolation`/`ActiveArtifactHandleConflict`。target_triple安装记录只在完整PE metadata通过后生成、current不重写、篡改不自动覆盖。Config/Bridge handle的transactionId用`assert_eq!`固定相同；Install/Repair/Uninstall分别验证action-specific invariant与rollback优先级。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::install -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::coordinator_tests -- --nocapture
  Pop-Location
  ```

  预期：installer 尚未实现，测试失败。

- [ ] **步骤 3：先写进程自检与回滚失败测试**

  安装后用 `std::process::Command` 执行 `--codepulse-self-check`，显式 `stdin/stdout/stderr` piped，要求一秒内 stdout 精确 `{}`、stderr 空、exit 0；同时以 Hook 参数写入测试 JSON验证 GUI Subsystem 仍能读写管道。无法启动、超时或输出违约时逐文件恢复安装前状态：首次 Install 只有配置已不引用稳定路径才删除新副本；Repair 即使 Hook 始终引用稳定路径也必须恢复同路径旧 EXE/旧记录且不返回引用冲突。再注入 Bridge 已替换/记录仍旧、Bridge 仍旧/记录已替换两种失败，断言只回滚 Target artifact。

  精确竞态专例固定为：`AfterTargetOpenedOrPrepared`修改Bridge，ReplaceFileW snapshot捕获late modification；Bridge正常Target后Record替换瞬间捕获late modification或Record Lease失败，不继续Config且Repair只使用稳定Lease恢复Bridge；snapshot旧写Handle仍活动时不执行二次ReplaceFileW，关闭Handle后retry读取最终digest；late snapshot且当前target仍为CodePulse Target时释放第一次双Lease、二次ReplaceFileW、再获取restored/conflict-current双Lease；第二次后任一活跃写Handle时不清两版本。任一原子操作报告成功但Handle目标摘要不是targetDigest，不继续记录或配置。文件占用与Lease取得重试固定3次、间隔50ms，测试注入sleeper不真实等待；每次重试前可再做optimistic check，但安全性以原子操作捕获结果和后置Lease为准。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::rollback -- --nocapture
  Pop-Location
  ```

  预期：self-check/rollback 测试失败。

- [ ] **步骤 4：实现Config Writer、PE校验、installer与action coordinator**

  Rust解析顺序与PowerShell完全一致：DOS Header≥64字节；MZ；e_lfanew；PE签名；COFF Machine；Optional Header与WindowsGui Subsystem。writer以04A AST目标字节构造`ConfigApplyTransaction`，installer在内存准备目标材料时调用完整metadata、SHA-256与piped契约；Prepared前不得创建staging或替换稳定路径。Prepared后的prepared backup完整性与all-staging-ready由统一coordinator提供，两者只调用统一原子接口并保存结果Lease。Install/Repair固定Bridge→必要临时Runtime→Config→action-specific invariant；Uninstall固定Config marker absent→stop/clear→Bridge/Record removal→Uninstalled invariant。rollback按action和稳定capture优先级逐文件恢复。StructureCommitted后释放普通Lease，再使用新取得的同一 cleanup Handle 完成身份/摘要验证与删除标记；cleanup失败只Warning，不回滚已正确提交的Hook/Bridge。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::pe_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::installer_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::coordinator_tests -- --nocapture
  Pop-Location
  ```

  预期：PE Machine/Subsystem 失败矩阵、安装、升级、篡改、GUI 管道自检和回滚全部通过。

- [ ] **步骤 5：完成04B-2门禁并强制停止review**

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-codex-bridge-resource-validation.ps1
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  git diff --check
  ```

  预期：Config Writer、Bridge Installer、action coordinator、PE/管道契约、action-specific invariant、rollback和清理边界全部通过；没有Tauri commands、Runtime或设置页。到此必须停止，未经04B-2 review批准不得继续04B-3。

  建议提交信息：

  ```text
  校验并安装目标架构正确的 Codex Bridge
  ```

---

## 04B-3／任务 3：按startup inspection恢复事务、启停Runtime并扩展self-check

**独立交付物：** 应用启动严格遵循固定顺序；只有合法/可识别 Hook 才创建新 generation，卸载/不允许状态会 owner-aware 停止、发布更高 revision 空快照并删除自己的发现文件。

**Files:**

- Modify: `src-tauri/src/codex/service.rs`
- Modify: `src-tauri/src/codex/service_tests.rs`
- Create: `src-tauri/src/codex/integration/startup.rs`
- Create: `src-tauri/src/codex/integration/startup_tests.rs`
- Modify: `src-tauri/src/codex/commands.rs`（扩展 self-check 三项，不复制命令）
- Modify: `src-tauri/src/lib.rs`（在 manager manage 后启动 integration startup orchestrator）

**消费接口：** 04A `derive_startup_runtime_decision()`、`derive_codex_listening_status()` 与 generation `CodexRuntimeFacts`；任务 1 recovery；任务 2完整 PE/installer；阶段二 manager start/stop、进程级 `CodexSnapshotStore` 与 Discovery owner。Rust facts 字段固定为 `runtime_generation`/`authenticated_generation`，serde 到 04C 才是 camelCase。

**产生接口：**

```rust
pub async fn initialize_codex_integration(
    runtime: CodexRuntimeManager,
) -> Result<CodexIntegrationInspection, CodexIntegrationError>;
```

- [ ] **步骤 1：先写启动顺序失败测试**

  fake journal/inspection/runtime/store/publisher 断言精确调用顺序：构造 paths 与唯一 `Arc<CodexSnapshotStore>` → `CodexRuntimeManager::new(app, paths, Arc::clone(&store))` → `app.manage(runtime)` → `recover_interrupted_codex_integration_transaction()` → 静态 inspect → decision → ensure_started 或 stop_if_unused → 若 disallow 则同一 Store.clear/发布空快照 → 由 inspection+runtime facts 派生并发布 listening status。setup fixture 计数 `CodexSnapshotStore::new()` 恰好一次，并用 `Arc::ptr_eq` 证明 startup、Actor、stop/restart与 dormant command 都经 Manager 使用同一 Store。禁止调用旧的配置单事务恢复函数。

  启动恢复分支还必须证明：稳定 Journal存在时只处理其权威transactionId，其他ID目标staging/capture artifact只记诊断不删除；稳定 Journal不存在时，一个或两个满足“文件名/内容32hex一致、stage=Prepared、三目标仍Original/ExpectedAbsent、同ID无目标staging/capture artifact”的合法 Prepared-only Journal temp都被删除；ID不符、stage=BridgeApplied、目标变化或同ID Bridge staging存在时保留temp并返回 `OrphanTransactionConflict`，Runtime不启动且目标不变。测试fixture显式启用单实例前提；若该前提关闭，启动恢复必须拒绝运行而不是猜测并发状态。

  recover conflict 必须 stop_if_unused(StartupInspectionDisallows)，按停止顺序清空旧任务并发布 config_conflict，`errorCode` 精确为 `IntegrationTransactionConflict`、`OrphanTransactionConflict`或由`ActiveArtifactHandleConflict`归一后的`IntegrationTransactionConflict`且不 start；target/replaced snapshot/conflict-current/tombstone/prepared backup任一应存在文件的Lease失败时不按路径分类、不删除或覆盖。外部Handle关闭后安全retry重新获取Lease再继续。inspection 读失败发布 config_conflict/service_error 的稳定码但不阻止音乐、托盘、窗口初始化。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::startup_tests::order -- --nocapture
  Pop-Location
  ```

  预期：startup orchestrator 不存在，测试失败。

- [ ] **步骤 2：先写 runtime 条件矩阵失败测试**

  exact、modified、可安全 marker present 分别调用一次 ensure_started(StartupInspection)；not_installed、disabled、managed disabled、Feature alias conflict/非布尔、任意 representation conflict/ambiguous、确认卸载调用 stop_if_unused(StartupInspectionDisallows)。Feature alias conflict 必须发布 config_conflict；modified 发布 partial 且不调用 writer。无法安全识别 marker 的 conflict 不得启动。idlePersistent true/false 不进入输入。重复 initialize 在 Runtime 已运行时幂等，不创建第二 listener/Actor/generation。

  另覆盖旧 Store 有运行中任务且 revision=20 → startup inspection disallows → 停止接收/关闭旧 Actor → Store.clear 得 revision=21 空快照并发布 → listening phase=not_installed/disabled/conflict；`get_codex_snapshot()` 仍成功。随后重新允许启动分配新 generation，authenticatedGeneration=None、lastEventAt/sources/旧错误/端口已清除，第一条真实事件前 awaiting_trust/partial，旧 generation 晚到 reporter 被忽略。

  `RuntimeGenerationReplaced` 与 `RuntimeErrorStateCleared` 两个 stop reason 复用完全相同的停止/clear/发布顺序；generation 替换前必须先让旧 listener/Actor 停止并发布空快照，不能让两个 generation 同时提交 Store。Runtime 错误后决定清理当前状态时也必须清空旧任务，不能只更新 listening error。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::startup_tests::runtime -- --nocapture
  Pop-Location
  ```

  预期：runtime 条件测试失败。

- [ ] **步骤 3：先写扩展 self-check 失败测试**

  在阶段二三项上增加 BridgeResourcePresent、BridgeInstalled、HookConfigValid；资源项验证可读、SHA-256、PE Machine、Optional Header Magic/长度与 WindowsGui Subsystem；稳定副本验证 hash/target/piped self-check；Hook 验证完整解析/marker。模拟 self-check 不能写 authenticatedGeneration或把 awaiting_trust 改为 running；只有 current generation Actor 的真实 authenticated event 可以。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::startup_tests::self_check -- --nocapture
  Pop-Location
  ```

  预期：扩展检查不存在，测试失败。

- [ ] **步骤 4：实现 startup orchestrator**

  `initialize_app()` 只 spawn orchestrator，不直接 start HTTP。orchestrator 从 manager 取得同一个 paths 与 `runtime.snapshot_store()`，先调用统一 Integration Transaction 恢复：稳定 Journal存在时只接受其ID；稳定 Journal不存在时只枚举精确 Journal temp模式并执行 Prepared-only判定；所有实际存在的事务artifact在分类前先获取Lease并通过Handle读取。任一 `IntegrationTransactionConflict`/`OrphanTransactionConflict`/`ActiveArtifactHandleConflict` 都停止 Runtime、保留证据并发布带稳定errorCode的config_conflict，绝不按路径降级。StructureCommitted恢复先释放普通事务Lease，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记；cleanup失败发布Warning并保留Journal但不回滚结构。只有恢复成功后才取得静态 inspection并调用 04A decision；成功/失败均使用 `derive_codex_listening_status()` 发布完整 CodexListeningStatus，绝不把动态 phase 写回 inspection。modified 只启动接收链路，不自动修复。stop 使用 handle 的完整 Owner；runtime 目录探针只在 paths.runtime_dir 内创建/rename/delete临时文件，不递归删除、不放宽 ACL、不跟随 reparse point。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::startup_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  Pop-Location
  ```

  预期：启动顺序、条件矩阵、自检与 manager 回归通过。

- [ ] **步骤 5：提交 startup 生命周期**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets --all-features -- -D warnings
  Pop-Location
  rg -n "idlePersistent|codexIdlePersistent" src-tauri/src/codex
  git diff --check
  ```

  预期：Rust runtime 无 UI 显示偏好；检查通过。

  建议提交信息：

  ```text
  按 Codex 集成检查管理 Runtime 生命周期
  ```

---

## 04B-3／任务 4：公开inspect/preview/apply/安全恢复命令并组织运行时编排

**独立交付物：** 四个 Tauri 命令提供无副作用 inspect/preview、摘要锁定的 apply与Conflict后的安全恢复重试；所有 action 有确定顺序与回滚，且没有强制覆盖、强制删除事务或忽略摘要的入口。

**Files:**

- Create: `src-tauri/src/codex/integration/commands.rs`
- Create: `src-tauri/src/codex/integration/commands_tests.rs`
- Modify: `src-tauri/src/codex/commands.rs`（re-export/状态合并）
- Modify: `src-tauri/src/lib.rs`（注册四个 integration commands）

**消费接口：** 04A inspection/planner；本计划 writer/installer/startup；阶段二 manager。

**产生接口：**

```rust
pub struct CodexHookChangeResult {
    pub inspection: CodexIntegrationInspection,
    pub listening_status: CodexListeningStatus,
    pub self_check: CodexSelfCheckResult,
}

pub struct CodexIntegrationRecoveryResult {
    pub outcome: CodexIntegrationRecoveryOutcome,
    pub inspection: CodexIntegrationInspection,
    pub listening_status: CodexListeningStatus,
}

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

#[tauri::command]
pub async fn retry_codex_integration_recovery(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexIntegrationRecoveryResult, String>;
```

`retry_codex_integration_recovery()` 固定获取与 apply 相同的 integration operation mutex；没有稳定 Journal且没有孤立 Journal temp时返回 `NoPendingTransaction`。其余情况只重新调用 `recover_interrupted_codex_integration_transaction()`：不强制删除 Journal，不忽略 originalDigest/targetDigest，不把用户新字节采用为新的 Original，不修改 `features.hooks` 或 `features.codex_hooks`。恢复成功后重新执行静态 Inspection，按 Inspection 决定 Runtime 启停，派生并发布最新 ListeningStatus；仍有 ExternalModification时继续返回稳定 Conflict并保持目标字节、Journal和备份不变。用户手工把相关文件恢复为 Journal 已知的 Original、Target、ExpectedAbsent之一后再次点击，恢复函数重新分类并可安全回滚、清理或在 invariant通过时提升StructureCommitted，不要求重装CodePulse。

- [ ] **步骤 1：先写 disabled action matrix 命令测试**

  固定序列：inspection hooksFeature=disabled + marker absent → preview install 返回 HooksDisabled → prepared plan 不存在 → Bridge installer、writer、ensure_started 计数均为 0 → 路径快照不变；disabled + marker present + repair 同样 HooksDisabled。disabled + 安全 marker exact/modified/duplicate + uninstall → preview/apply 成功，Bridge installer 与 ensure_started 计数为 0，writer 只删除 CodePulse marker，其他 Hook 深度相等，再把稳定 Bridge/Record原子捕获为本transactionId tombstone并在StructureCommitted后清理。用户手动把 hooks 改为 true 并重新 inspect 后 install/repair preview 才成功。只有旧 `codex_hooks` 时按 effectiveState 执行并返回弃用 Issue；两个 Feature 键冲突或任一非布尔时 install/repair/uninstall 全部 ConfigConflict，Prepared plan/Journal/Bridge temp/writer/runtime 计数均为 0。managed disabled 与 representation conflict/ambiguous 不提供任何 apply 路径。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::disabled -- --nocapture
  Pop-Location
  ```

  预期：若 command 先安装 Bridge 或启动 HTTP，测试失败。

- [ ] **步骤2：先写命令委托04B-2 coordinator与Runtime回调测试**

  04B-3不再实现下列事务步骤；命令测试注入04B-2已审核coordinator的调用记录，只断言apply将inspection/双摘要和同一operation mutex交给它，并按其Runtime请求意图执行ensure_started/stop/clear、ListeningStatus与self-check。记录仍必须完整呈现既有顺序以防命令层绕开coordinator：

  ```text
  1. 重新静态 inspection
  2. 重新计算 expectedDigest/previewDigest
  3. 分配唯一 transactionId
  4. 用同一 transactionId 先 prepare Config、再 prepare Bridge，纯计算两类目标材料
  5. 验证 PE Machine/WindowsGui、hash 和 Bridge piped 启动契约
  6. 构造包含三类目标摘要与全部 owned staging 路径的完整 Prepared Journal
  7. 原子持久化 Prepared Journal
  8. 重新读取Config/Bridge/Record执行optimistic precondition check；三者仍为Original/ExpectedAbsent后才创建本transactionId的prepared backup/temp，并在all-staging-ready屏障通过Lease验证originalDigest/targetDigest、全部capture路径与当前Prepared Journal ID
  9. Bridge/安装记录按existing调用ReplaceFileW后获取target/snapshot Lease，按absent发布后获取target Lease，只以Handle验证file ID与摘要并保存进事务handle；任一CapturedLateModification、DestinationAppeared或ActiveArtifactHandleConflict立即停止并保留逐文件rollback/capture
  10. 保持Bridge/Record Lease，把同一 Journal 推进 BridgeApplied
  11. Runtime 未启动时在共享只读兼容的Lease下ensure_started(InstallSelfCheck/RepairSelfCheck)
  12. 确认Bridge/Record Lease仍为本事务Target且无late snapshot；Config执行optimistic precondition check后按existing/absent原子语义应用，取得结果Lease并只以Handle验证targetDigest/snapshot，再完成ConfigApplyTransaction且不创建第二日志
  13. 保持Config/Bridge/Record最终Lease，把同一 Journal 推进 ConfigApplied
  14. 只使用Lease身份与Handle摘要执行 InstalledOrRepaired post-write invariant
  15. 保持Lease把同一 Journal 推进 StructureCommitted
  16. 释放普通事务Lease，commit Config/Bridge进程内handle，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记
  17. 派生并发布 awaiting_trust 或 partial ListeningStatus
  18. 运行完整 self-check
  19. 返回 inspection/listeningStatus/selfCheck
  ```

  调用记录器必须专门断言transactionId在`prepare_config_apply`/`prepare_bridge_install`前分配，两个prepare收到同一ID；Prepared原子写入前任何故障都无目标变化、无staging。Prepared写入后、staging前先对三目标执行optimistic precondition check；任一变化都不创建新staging。prepared backup/temp创建一半崩溃时，下次恢复只清本transactionId普通staging，不删除并存的另一ID文件；全部staging完成但任一摘要错误、capture路径意外存在或Prepared Journal不再是当前ID时不开始第一个原子操作。

  逐文件失败矩阵已由04B-2 coordinator测试拥有；本步骤只把其稳定结果/错误注入命令层，断言CapturedLateModification、DestinationAppeared、ActiveArtifactHandleConflict、action-specific rollback结果不会触发第二套文件逻辑。首次Install失败按coordinator结果停止临时Runtime、Store.clear/发布空快照并owner-aware删除discovery；Repair失败保持原合法链路。命令测试不得直接构造ReplaceFileW或prepared backup流程。

  Commands层Exact回归必须传入`paths.installed_bridge`：稳定Bridge双command正确→Exact；其他EXE+marker不得成为安全Marker；旧路径、基础/Windows command任一个错误、附加`--extra`→Modified。用户同事件独立matcher group不进入CodePulse projection且仍Exact；混合group→Modified，显式Repair后用户handler深度相等、CodePulse group独立。post-write invariant只接受该路径绑定projection为Exact。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::install_repair -- --nocapture
  Pop-Location
  ```

  预期：命令委托、Runtime回调和结果映射测试失败；不新增事务或rollback实现。

- [ ] **步骤3：先写coordinator结果、Runtime生命周期与Uninstall命令映射测试**

  action-specific结构提交边界与cleanup由04B-2 coordinator实现并已审核。本步骤注入`InstalledOrRepaired`/`Uninstalled`/Conflict/Warning结果，断言命令层只执行对应Runtime、Store、ListeningStatus和self-check映射；StructureCommitted之后self-check失败保留结构，cleanup Warning不触发rollback。

  Uninstall命令只把用户确认与双摘要交给04B-2 coordinator，并按其`Uninstalled`结果执行stop/clear/publish not_installed；不得重新实现ConfigApplied、tombstone、invariant或cleanup。测试用coordinator spy确认命令未直接调用原子文件接口或`DeleteFileW`。

  Uninstall恢复矩阵仍由04B-2测试所有文件分支；04B-3只覆盖这些结果到公开命令响应和Runtime状态的映射。捕获或Lease失败时命令不得恢复Hook、重启Runtime或尝试路径降级；local hooks=false同样只允许委托安全Uninstall。

  再覆盖安装生命周期：安装完成且 generation=1 收到真实事件 → running；确认卸载 → generation=None/authenticatedGeneration=None/更高 revision 空快照/not_installed；重新安装 → generation=2、authenticatedGeneration=None、awaiting_trust，绝不能沿用 generation=1 直接 running；generation=1 晚到 reporter 忽略；generation=2 第一条真实事件后才 running。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::uninstall -- --nocapture
  Pop-Location
  ```

  预期：卸载生命周期测试失败。

- [ ] **步骤 4：先写 Conflict 安全重试失败测试**

  固定覆盖：Conflict后不修改任何文件直接retry → recovery为所有实际存在artifact重新获取Lease；活动writer/mapping/delete access仍在时继续Conflict且Config/Bridge/Record字节与Journal不变；外部关闭Handle后retry取得Lease并按最终Handle摘要继续。用户手工把Config恢复为Original → retry完成action-aware回滚并以Handle cleanup Journal；用户把三者恢复为Target且action-specific invariant通过 → retry在Lease下提升StructureCommitted并只清理正常artifact；并发双击retry → operation mutex只执行一次恢复状态机，第二次得到串行后的结果；没有稳定Journal且没有孤立temp → NoPendingTransaction；retry成功 → 重新Inspection、按决策启停Runtime并发布新的ListeningStatus。另覆盖孤立Journal temp从异常状态由用户处理后重新满足Prepared-only条件，retry可清理；仍异常则继续OrphanTransactionConflict。所有用例断言没有force overwrite、force discard、ignore digest、路径摘要降级或Feature键修改调用。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::recovery_retry -- --nocapture
  Pop-Location
  ```

  预期：安全重试命令与串行恢复编排尚未实现，测试失败。

- [ ] **步骤 5：实现串行 apply 与四个 Tauri 命令**

  manager内integration operation mutex保证apply与retry互斥串行；inspect/preview可并发读。apply锁内重新计算双摘要后只调用04B-2已审核coordinator，并根据返回的Runtime请求意图和稳定结果更新Store、ListeningStatus与self-check；ID分配、Prepared/staging、三个原子接口、Lease、invariant和rollback全部留在coordinator。Commands不实现第二套原子文件逻辑、不手写Fixture。Uninstall支持local disabled安全marker且不启动Runtime。

  retry只调用统一恢复函数并复用startup的“恢复→Inspection→Runtime decision→ListeningStatus”后半段；没有Journal/孤立temp返回NoPendingTransaction，成功返回`CodexIntegrationRecoveryResult`，Conflict返回稳定`IntegrationTransactionConflict`/`OrphanTransactionConflict`。阻塞文件I/O放入`tauri::async_runtime::spawn_blocking`；每次返回静态inspection、单独派生的完整listeningStatus与selfCheck或recovery outcome，错误对UI只返回稳定码/中文短句，不含token、配置正文或完整路径正文。`SharingViolation`统一映射`ActiveArtifactHandleConflict`，UI固定显示“目标文件正在被其他程序占用，请关闭相关程序后重新尝试安全恢复。”，不诊断具体冲突来源。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests -- --nocapture
  cargo test -p netspeed-dynamic --lib
  Pop-Location
  ```

  预期：disabled 零副作用、install/repair、uninstall、并发摘要和命令注册全部通过。

- [ ] **步骤 6：完成04B-3门禁并强制停止review**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration -- --nocapture
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::exit_tests -- --nocapture
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets --all-features -- -D warnings
  Pop-Location
  rg -n "CodexStatusSettingsCard|useCodexIntegration" src
  git diff --check
  git diff --name-only
  ```

  预期：startup、退出、inspect/preview/apply/retry、operation mutex、Runtime/Store/generation/owner/ListeningStatus/self-check和错误映射全部通过；没有设置页或useCodexIntegration，也没有第二套Journal、状态机、phase、SnapshotStore或公开接口。随后停止等待04B-3 review，未批准不得进入04C。

  建议提交信息：

  ```text
  公开 Codex 集成事务与生命周期命令
  ```

## 04B-1完成门禁

- `paths.integration_transaction_file` 是唯一 Journal；Writer/Installer 不拼接路径、不创建第二日志。transactionId 在 Config/Bridge prepare 前分配，两个 handle 收到同一 ID；prepare 只计算/验证且零目标副作用。Journal 不含正文、Token、Hook 输入、用户命令、项目路径正文或 Bridge bytes。
- Config/Bridge/Record 的target temp、prepared backup、replaced snapshot、conflict-preserved-current、removed tombstone路径全部由transactionId+target filename确定并写入同一Journal；Journal原子temp也由稳定Journal路径+transactionId确定，且须通过文件名/内容ID双校验。Prepared前崩溃无目标staging，Prepared后部分staging恢复只清当前ID的普通staging，不扫描或删除其他`.codepulse-*`。Prepared、BridgeApplied、ConfigApplied、StructureCommitted的Journal推进均走temp→write→flush→close→重读解析→原子替换。
- Prepared稳定Journal落盘后、任何staging创建前，Config/Bridge/Record必须重新读取并由`verify_artifact_matches_expected_original()`分类；只有三者均Original/ExpectedAbsent才继续。该optimistic precondition check只提前发现变化，不是原子CAS。每个prepared backup从当前原字节生成，create_new/write/flush/close后取得Lease并以Handle再次匹配originalDigest；existedBefore=false要求prepared backup=None且目标仍缺失。三类staging、全部capture路径及当前Prepared Journal ID通过all-staging-ready屏障前零目标操作。
- Stable Lease打开模式精确为`GENERIC_READ | FILE_READ_ATTRIBUTES`、仅`FILE_SHARE_READ`、`OPEN_EXISTING`；关键摘要只通过Handle计算，identity为volume serial+128位file ID+size。Lease成功会阻止新write/writable mapping/delete/rename且允许普通只读；测试分别制造活动writer、writable mapping、delete/rename Handle，但生产结果一律为`StableArtifactLeaseError::SharingViolation`并映射`CodexIntegrationError::ActiveArtifactHandleConflict`。Lease不序列化，阶段推进失败不提前释放并继续。
- Existing文件替换只走`atomically_replace_existing_artifact()`，由`ReplaceFileW`把实际旧内容捕获到transaction-owned replaced snapshot；之后必须依次取得target/snapshot Lease、用Handle验证target=targetDigest、snapshot=originalDigest且file ID不同才继续。snapshot Lease失败不读路径、不清理、不执行第二次ReplaceFileW；稳定late snapshot的第二次恢复执行前释放相关Lease，执行后重新取得restored target/conflict-current双Lease，任一失败保留两版。prepared backup不得覆盖late snapshot。
- Absent文件只走`atomically_publish_absent_artifact()`的同目录no-replace move；最后时刻出现目标必须返回`DestinationAppeared`且外部字节不变，发布成功后必须取得target Lease并通过Handle验证，禁止`MOVEFILE_REPLACE_EXISTING`。Removal只走`atomically_capture_artifact_for_removal()`，把Bridge/Record原子rename为removed tombstone；随后取得tombstone Lease并通过Handle验证摘要/target absent，Lease失败不分类、不永久删除、不进入Uninstalled。禁止用`DeleteFileW`直接删除，StructureCommitted前不得永久删除tombstone。
- 稳定Journal存在时只处理其权威transactionId，其他ID的Journal temp、目标staging/capture artifact只诊断不删除；稳定Journal不存在时只枚举`.<journal-filename>.codepulse-<32hex>.tmp`。合法Prepared-only且无同ID目标staging/capture artifact的一个或多个temp可清理；损坏、ID不符、非Prepared、目标变化或同ID artifact均保留并`OrphanTransactionConflict`，Runtime不启动。其他ID普通目标artifact不扫描不删除；单实例前提有测试，移除单实例前必须先加进程间事务锁。
- `TransactionArtifactState`对Config/Bridge/Record逐文件分类；通用recovery在使用当前target、replaced snapshot/tombstone/conflict-preserved-current、prepared backup前重新取得Lease并以Handle摘要分类，保持“当前目标→capture→prepared backup→Journal摘要”优先级。高优先级Lease失败不降级，late snapshot优先于prepared backup，ExternalModification不覆盖；九组固定恢复、阶段落盘滞后、用户并发修改、ActiveArtifactHandleConflict与损坏Journal测试通过。04B-1只输出稳定分类和capture事实，Repair/Install/Uninstall专属rollback规则留给04B-2。
- 04B-1不出现Tauri commands、Runtime启停、设置页、真实Bridge安装编排、`ConfigApplyTransaction`或`BridgeInstallTransaction`；完成本节所有门禁后强制停止review。

## 04B-2完成门禁

- writer返回`ConfigApplyTransaction`，通过摘要、optimistic precondition check、Prepared后prepared backup/同目录temp、重新解析与统一原子接口实现；installer返回`BridgeInstallTransaction`，两者不得各自实现替换规则。两个内部commit只终结进程内资源，action-specific invariant后的StructureCommitted是跨进程提交点。
- Bridge 资源与稳定副本都验证 PE 签名/Machine/Optional Header/WindowsGui；x64/ARM64 反配、Console Subsystem、不支持 triple 和旧 target 误复制被拒绝；piped Bridge 契约通过。
- local disabled 的 install/repair 不写配置/Bridge、不启动 HTTP；安全 marker uninstall 允许且不启动 Runtime；managed disabled 与 ambiguous conflict 全部只读。
- Install/Repair按固定19步执行：allocate ID→pure prepare→persist Prepared→owned staging→atomic apply→post-op Lease→持Leasepersist stage。InstalledOrRepaired要求Marker=Exact、Bridge/Record=Target、PE/hash/piped有效且正常snapshot在Lease下等于originalDigest；ConfigApplied混合状态按action-aware规则逐文件恢复。Uninstalled要求Marker=Absent、无稳定路径引用、Bridge/Record目标absent且tombstone Lease稳定并受当前Journal控制；Marker absent但目标仍存在、tombstone Lease失败或无法解释不得提交。StructureCommitted后self-check失败保留正确结构并返回partial/service_error。
- StructureCommitted后先释放普通事务Lease，再由`delete_verified_artifact_by_handle`新开`GENERIC_READ | DELETE`、仅`FILE_SHARE_READ`、`OPEN_EXISTING`的Handle；使用新取得的同一 cleanup Handle 完成file identity读取、expected digest计算、identity/digest复核和`SetFileInformationByHandle(FileDispositionInfo)`删除标记，关闭后检查路径absent、delete pending或path reuse。禁止给原Lease增加`DELETE`、按路径`DeleteFileW`或“路径摘要后删除同名路径”。cleanup失败只Warning并保留StructureCommitted Journal供startup recovery，不回滚Hook/Bridge；Conflict artifact永不进入普通cleanup。
- 首次Install失败停止临时Runtime、发布更高revision空快照并owner-aware删除discovery；Repair失败保持原合法链路；Uninstall先发布空快照再not_installed，最后原子捕获Bridge/Record为tombstone，StructureCommitted后才清理。
- `AtomicIntegrationFs`在`BeforeAtomicReplace`、`AfterTargetOpenedOrPrepared`、`AfterAtomicReplaceBeforeVerification`、`BeforeConflictRestore`、`AfterRemovalCaptureBeforeVerification`、`BeforeStableLeaseAcquire`、`AfterStableLeaseAcquireBeforeHash`、`AfterHashBeforeStagePersist`、`BeforeVerifiedHandleDelete`提供精确注入点。测试覆盖existing snapshot旧写Handle、继续写后retry、writable mapping、Lease阻止新write/rename/delete、Absent发布后立即writer、tombstone旧writer、第二次恢复双Lease及Handle cleanup三场景；任何失败不得丢失当前目标、replaced snapshot、tombstone或prepared backup。
- 04B-2不出现Tauri commands、Runtime或设置页；完成本节所有门禁后强制停止review。

## 04B-3完成门禁

- startup严格构造唯一Store并注入Manager→恢复Integration Transaction→静态inspection→decision→generation runtime→独立listening status；`Arc::ptr_eq`/单次构造通过，modified启动但不自动覆盖，Feature alias conflict停止，旧generation上报不影响新Runtime。
- SnapshotStore跨stop/start保持revision；每个Runtime使用新generation和完整DiscoveryOwner；RunEvent/stop不误删新Runtime文件。
- inspect/preview/apply/retry 四个命令均注册；`CodexHookChangeResult` 同时返回静态 inspection、独立 listeningStatus 与 selfCheck，恢复命令返回outcome/inspection/listeningStatus，错误不泄密；无 Vue 设置页。
- `retry_codex_integration_recovery`与apply共用operation mutex，只重跑统一恢复并为所有实际存在artifact重新取得Lease；无事务返回NoPendingTransaction，外部Handle关闭后可按最终Handle摘要继续，手工恢复到Original/Target/ExpectedAbsent后可安全回滚或提交。成功后重新Inspection、Runtime决策并发布ListeningStatus；仍冲突则字节与Journal不变。不存在路径读取降级、强制覆盖、强制删除事务、忽略摘要或改Feature键的入口。
- 范围脚本必须阻止snapshot/tombstone路径型关键摘要、ReplaceFileW后缺target/snapshot Lease、no-replace后缺target Lease、removal后缺tombstone Lease、recovery在Lease失败后降级路径读取、StructureCommitted直接路径型DeleteFileW、Conflict artifact被普通cleanup删除，以及Lease在阶段Journal持久化前释放。
- 公开错误模型不区分共享冲突来源；`SharingViolation`统一映射`ActiveArtifactHandleConflict`与通用UI文案，不声称识别具体进程、Handle类型或writable mapping。
- 04B-1/2/3复用唯一Journal、四正式阶段状态机、SnapshotStore和固定公开接口；全部通过后停止，未经04B-3 review不得执行04C。
