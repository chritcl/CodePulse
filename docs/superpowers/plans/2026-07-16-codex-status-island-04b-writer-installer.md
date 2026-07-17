# 阶段四 B：Writer、Bridge Installer 与 Tauri Commands 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 04A 只读 inspection/planner 已审核通过后，实现并发安全且可跨进程恢复的统一 Integration Transaction、目标架构正确的 Bridge 稳定安装、Tauri inspect/preview/apply/安全恢复命令，以及由 startup inspection/install/uninstall 驱动的 HTTP/Actor 生命周期。

**架构：** apply coordinator 在重新 inspection/双摘要后先分配 transactionId，再让 writer 和 installer 纯准备 `ConfigApplyTransaction`/`BridgeInstallTransaction`；完整 Prepared Journal 原子持久化前不创建 staging、不修改目标。Prepared 后的三文件摘要重读统一称为optimistic precondition check，只负责提前发现变化；prepared backup/temp与all-staging-ready守住首个原子操作。existing目标由`ReplaceFileW`替换并把实际旧内容捕获为transaction-owned replaced snapshot，absent目标由no-replace同目录原子move发布，Uninstall把Bridge/Record原子rename为removed tombstone。两个句柄共享同一 transactionId，并由 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json` 的唯一 Integration Journal 协调；Journal 以 Prepared、BridgeApplied、ConfigApplied、StructureCommitted 四阶段记录三类目标的摘要和temp/prepared backup/replaced snapshot/tombstone/conflict-preserved-current。startup orchestrator 严格执行统一恢复→静态 inspection→runtime generation 决策→状态发布；孤立 Journal temp 只按精确 Prepared-only 规则处理。apply command 只在 action-specific StructureCommitted 前允许逐文件回滚；安全 retry 命令只重跑同一恢复状态机；stop/uninstall 时清空 Manager 持有的唯一进程级 `CodexSnapshotStore`。Vue 设置页不在本批次实现。

**技术栈：** Rust、sha2、Windows `CreateFileW`/`MoveFileExW`/`ReplaceFileW`、Tauri 2.11.5 async runtime、Tokio、阶段一 PE/路径契约与阶段二 Runtime Manager；不新增前端依赖。

## 全局约束

- 前置门禁：04A 全部通过并已单独 review。
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
- 本计划完成后停止等待 review，不自动进入 04C。
- 2026-07-16 重新核对 Microsoft 官方 [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)、[MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)、[ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)、[DeleteFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew) 与 [Closing and Deleting Files](https://learn.microsoft.com/en-us/windows/win32/fileio/closing-and-deleting-files)。官方语义固定本计划：`FILE_SHARE_DELETE`允许后续delete/rename，冲突返回sharing violation；`ReplaceFileW`在一次调用内替换并可保存被替换文件，replacement/replaced/backup必须同卷；`MoveFileExW`只有带`MOVEFILE_REPLACE_EXISTING`才覆盖既有目标；`DeleteFileW`只是标记删除并等待最后句柄关闭，不能保留Journal受控旧版本。

---

## 任务 1：实现统一 Integration Journal、摘要防并发与四阶段恢复

**独立交付物：** 配置与 Bridge 共享一个可持久化、可跨进程恢复的 Journal；只有 inspection 输入和 preview 均未变化时才创建 Prepared，任一崩溃点都能按阶段和摘要恢复且不覆盖用户新字节。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/transaction.rs`
- Create: `src-tauri/src/codex/integration/transaction_tests.rs`
- Create: `src-tauri/src/codex/integration/writer.rs`
- Create: `src-tauri/src/codex/integration/writer_tests.rs`

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
) -> Result<AtomicArtifactApplyOutcome, CodexIntegrationError>;

pub fn atomically_capture_artifact_for_removal(
    target: &Path,
    tombstone: &Path,
    expected_digest: &str,
) -> Result<AtomicArtifactApplyOutcome, CodexIntegrationError>;

pub enum AtomicIntegrationFsInjectionPoint {
    BeforeAtomicReplace,
    AfterTargetOpenedOrPrepared,
    AfterAtomicReplaceBeforeVerification,
    BeforeConflictRestore,
    AfterRemovalCaptureBeforeVerification,
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

pub fn recover_interrupted_codex_integration_transaction(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationRecoveryOutcome, CodexIntegrationError>;
```

Journal禁止包含配置正文、Token、Hook输入、用户命令、项目路径正文或Bridge二进制内容。`target_bridge_exists`/`target_record_exists`支持Uninstall缺失目标；为false时对应target digest固定为SHA-256(empty bytes)，存在性位区分缺失与零字节文件。Config的事务Target固定为存在且可解析，但`existed_before`允许为false，以支持新Hook文件按Absent语义首次发布。`transaction_id`固定为16个CSPRNG随机字节的小写32 hex，必须在`prepare_config_apply()`/`prepare_bridge_install()`之前分配；Config/Bridge句柄必须保存并测试同一个值。Config、Bridge和Record的temp、prepared backup、replaced snapshot、conflict-preserved-current与removed tombstone路径完全由`transactionId + target filename`确定性推导并写入同一Journal；固定后缀分别区分`.tmp`、`.prepared.bak`、`.replaced.snapshot`、`.conflict-current`、`.removed.tombstone`，禁止与transactionId无关的随机名。prepared backup是Prepared后创建的计划开始版本；replaced snapshot是`ReplaceFileW`实际替换瞬间捕获的旧目标；removed tombstone是Uninstall原子rename捕获且StructureCommitted前不可永久删除的目标。Journal自身的原子写temp由`paths.integration_transaction_file + transactionId`确定为`.<journal-filename>.codepulse-<transactionId>.tmp`；只有`transaction.rs`可更新Journal元数据，writer/installer不得创建第二日志或自行替换Journal。

启动恢复必须先区分稳定 Journal 是否存在。稳定 Journal 存在时，完整解析它并以其中的 transactionId 为唯一权威 ID，只处理该 ID 的 Journal temp和Journal明确列出的Config/Bridge/Record staging/capture artifacts；其他 ID 文件都不删除，只记录不含用户正文的诊断项。稳定 Journal 不存在时，只枚举 Journal 目录中精确匹配 `.<journal-filename>.codepulse-<32hex>.tmp` 的候选，禁止扫描普通 `*.codepulse-*`。每个候选都必须满足：文件名 ID 为 32 hex；内容完整反序列化；内容 ID 等于文件名；stage=Prepared；Journal 列出的 Config/Bridge/Record 仍为 Original/ExpectedAbsent；不存在同 ID 的任何target temp/prepared backup/replaced snapshot/conflict-preserved-current/removed tombstone。全部满足的 Prepared-only temp 都可删除并返回 `CleanedOrphanPreparedTemps`。任一候选损坏、ID 不匹配、stage 非 Prepared、目标改变或存在同 ID capture artifact 时，保留全部异常证据并返回稳定 `OrphanTransactionConflict`，不启动 Runtime、不修改目标。

上述“稳定 Journal 不存在时可以判定孤立 temp”依赖 CodePulse 单实例插件：启动恢复期间不存在另一个正常 CodePulse 集成事务。测试必须显式固定这一前提；未来若移除单实例插件，必须先引入进程间 Integration Transaction 锁，再允许继续使用该恢复算法。

transaction prepare 是严格无目标副作用阶段：允许读取、计算摘要/目标字节/确定性staging/capture路径、验证PE/hash/piped进程契约并把材料保存在内存；禁止修改稳定Bridge、安装记录、Hook配置，禁止创建prepared backup/temp/snapshot/tombstone/Journal。coordinator构造含全部路径/摘要的Journal并成功持久化Prepared后，先执行一次三文件 **optimistic precondition check**：重新读取Config、Bridge、Record，分别调用`verify_artifact_matches_expected_original()`按Journal的existedBefore/originalDigest/targetDigest分类，只有三者都为Original/ExpectedAbsent才创建prepared backup/temp。Target或ExternalModification返回`ConcurrentModification`（恢复场景映射稳定Conflict）、保留Journal、不采用变化后的字节作为新Original，且不创建新staging、不修改目标。该检查只能提前发现修改，不能保证检查与后续Windows原子操作之间没有变化，禁止称为原子Compare-And-Swap。

每个existedBefore=true的prepared backup必须从当前目标重新读取原始字节，计算摘要并与Journal.originalDigest相等后，才以`create_new(true)`创建；随后write→flush→close→重新读取并再次核对originalDigest。任一摘要、写入或重读失败时不得开始任何目标操作。existedBefore=false时prepared backup必须为None且目标仍不存在；此时若目标出现，按ExternalModification处理。所有target temp同样在close后重读并验证targetDigest；targetExists=false的Uninstall不创建空payload temp，而是为removed tombstone准备确定性且必须不存在的目标路径，不能用零字节文件冒充absent。

第一个原子文件操作前存在不可绕过的all-staging-ready屏障：Config/Bridge/Record的prepared backup/temp（或removal无payload状态）全部准备并通过摘要验证；replaced snapshot、conflict-preserved-current、removed tombstone路径全部已写入Journal且操作前不得意外存在；重新读取的稳定Prepared Journal仍是当前transactionId。任何staging缺失、摘要错误、捕获路径意外出现或Journal ID/stage不符都不得开始。

`AtomicIntegrationFs`必须提供三种不同接口，writer与installer共同调用，禁止通用`move_with_replace(...)`：

- `atomically_replace_existing_artifact()`只处理`existed_before=true && target_exists=true`。先optimistic precondition check，再验证replacement temp的targetDigest与稳定Journal transactionId/阶段；随后调用`ReplaceFileW(target, replacement, transaction_owned_replaced_snapshot, ...)`。成功后立即验证target存在且摘要=targetDigest、snapshot存在，再读取snapshot摘要。snapshot=originalDigest返回`AppliedExpectedOriginal`；snapshot!=originalDigest返回`CapturedLateModification`/`LateConcurrentModification`，不继续下一文件、不采用为新Original。
- `atomically_publish_absent_artifact()`只处理`existed_before=false && target_exists=true`。使用同目录no-replace原子move/rename，明确不带`MOVEFILE_REPLACE_EXISTING`。目标在最后一次检查后出现时原子操作失败并返回`DestinationAppeared`，保留外部目标和transaction temp；成功后立即验证targetDigest，不符时Conflict且停止。
- `atomically_capture_artifact_for_removal()`只处理Uninstall removal。确认Config为本事务Target且不再引用稳定Bridge、执行optimistic precondition check后，把target no-replace原子rename到本transactionId removed tombstone；禁止`DeleteFileW`。随后验证target absent且tombstone摘要等于expectedDigest。

Existing replacement的snapshot若不等于originalDigest，固定重新分类当前target。当前target仍等于本事务Target时，允许第二次`ReplaceFileW(current_target, replaced_snapshot, transaction_owned_conflict_preserved_current, ...)`，把真实外部修改恢复到target并保存CodePulse Target；验证target digest=snapshot digest后仍返回Conflict并保留Journal/诊断。当前target已不等于本事务Target时，不覆盖当前target；同时保留replaced snapshot、prepared backup与当前target并返回Conflict。不得用prepared backup覆盖late snapshot，不得自动选定哪个外部版本更正确。

Removal tombstone摘要不等于expectedDigest时不永久删除：若target路径仍absent，只允许no-replace原子rename tombstone回原路径并验证；若target已重新创建，保留tombstone与新target并Conflict。sharing violation、权限和`ReplaceFileW`部分失败状态都按实际目标/snapshot/tombstone重新分类，绝不能假设Win32失败时所有路径原样。

阶段与恢复矩阵固定为。BridgeApplied/ConfigApplied的检查优先级始终是：1当前目标；2replaced snapshot、removed tombstone、conflict-preserved-current；3prepared backup；4Journal摘要：

- Prepared：语义上没有已确认目标替换；正常分支不改目标，只清理Journal明确列出的本transactionId普通staging并返回CleanedPreparedTransaction。不得glob/扫描其他`.codepulse-*`。若实际target或捕获artifact显示原子操作已发生但阶段落盘滞后，进入BridgeApplied/ConfigApplied对应安全分支；ExternalModification时Conflict。
- BridgeApplied（Install/Repair）：配置仍为Original/ExpectedAbsent时，Bridge/Record均Original/ExpectedAbsent只清理；snapshot=originalDigest且目标为Target时逐文件回滚实际被替换版本；一个Target、另一个Original/ExpectedAbsent是合法双文件中间崩溃，只回滚Target。snapshot表示late modification时优先于prepared backup，按第二次ReplaceFileW安全恢复规则处理；任一ExternalModification、conflict-preserved-current或无法解释的snapshot都保留Journal/全部证据并Conflict。
- ConfigApplied（Install/Repair）：配置为Target、Bridge/Record均Target且三者snapshot都证明实际旧内容等于各自originalDigest时，才执行`InstalledOrRepaired` invariant；验证失败且无外改时先回滚Config，再逐文件回滚Bridge/Record。Config snapshot为late modification时优先恢复/保护真实Config外改，Bridge/Record按action-aware规则处理；Bridge/Record任一late snapshot时不得继续Config。任一ExternalModification或preserved conflict不覆盖、不删除仍可能被引用Bridge，并保留全部artifacts。
- StructureCommitted：保留已提交目标，只清理prepared backup、摘要等于originalDigest的正常replaced snapshot、已满足Uninstalled invariant的removed tombstone、transaction temp与Journal并返回CleanedStructureCommitted；清理失败只Warning。Conflict的replaced snapshot/tombstone/conflict-preserved-current不得作为普通成功清理删除。

恢复不得盲信阶段：若Prepared的实际逐文件状态已经出现Bridge/Record Target或对应snapshot，按BridgeApplied分支恢复；若BridgeApplied的Config已经是Target或存在Config snapshot，按ConfigApplied分支恢复。这覆盖任一原子操作成功但下一阶段Journal尚未持久化的崩溃窗口。既非已知目标状态、又不能由snapshot/tombstone解释的状态统一ExternalModification/Conflict。

- [ ] **步骤 1：先写摘要竞争、Journal 捕获路径与 prepared backup 失败测试**

  覆盖 expectedDigest 不符、previewDigest 不符、preview 后用户增加 handler、修改任一 Feature 键、改变企业约束、替换 Bridge 资源/副本/记录；每例断言不分配 transactionId、不调用 transaction prepare、不创建 temp/prepared backup/snapshot/tombstone/Journal。成功路径用调用记录器精确断言 `allocate_transaction_id` 先于 `prepare_config_apply` 和 `prepare_bridge_install`，两个 prepare 收到同一 ID，禁止“prepare handle 后分配 ID”。Prepared 已持久化后先运行三文件optimistic precondition check；固定竞态为：用户修改 Config → staging 创建前检测到变化 → Config/Bridge/Record 都不写且不创建新 staging。另模拟 expectedDigest检查后、Prepared写入后修改任一目标，验证早期变化可被检查发现，但明确不把该用例当作最后时刻竞态的完整证明。

  修改已有文件的prepared backup路径固定为`.<filename>.codepulse-<transactionId>.prepared.bak`，新建Hook文件prepared backup=None。Journal未持久化前所有捕获路径不存在；持久化后创建prepared backup必须断言“当前原字节摘要=Journal.originalDigest → create_new(true) → write/flush/close → 重读prepared backup → 摘要仍=originalDigest”。任一摘要不符、路径已存在、flush失败或重读不符时，三个目标都不得开始原子操作。序列化Journal必须包含三类target temp，以及Config/Bridge/Record适用的`prepared_backup_path`、`replaced_snapshot_path`、`conflict_preserved_current_path`、`removed_tombstone_path`；每个路径含同一transactionId，概念与后缀互不混用；不含配置正文、token、Hook stdin、用户command、项目cwd或Bridge bytes。

  孤立 Journal temp 固定测试：无稳定 Journal+一个合法 Prepared-only temp → 删除；无稳定 Journal+两个合法 Prepared-only temp → 两者都删除；内容 ID 与文件名不符 → 保留并 `OrphanTransactionConflict`；stage=BridgeApplied → 保留并 Conflict；Prepared temp但存在同 ID Bridge staging/capture artifact → 保留并 Conflict；稳定 Journal ID=A且存在 ID=B 的 Journal temp或普通目标 staging → 只处理 A并保留、诊断 B。测试不得再要求另一个合法 Prepared-only Journal temp永久保留，也不得扫描普通目标 `*.codepulse-*.tmp|bak`。模拟首次 Prepared 原子替换前崩溃时，只有符合完整孤立条件的 Journal temp可由文件名和内容 ID 精确认领并清理。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::concurrency -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::journal -- --nocapture
  Pop-Location
  ```

  预期：统一 Journal 和 writer 不存在，测试失败。

- [ ] **步骤 2：先写 existing/absent/removal 三语义与精确竞态故障矩阵**

  `AtomicIntegrationFs`必须暴露精确注入点`BeforeAtomicReplace`、`AfterTargetOpenedOrPrepared`、`AfterAtomicReplaceBeforeVerification`、`BeforeConflictRestore`、`AfterRemovalCaptureBeforeVerification`；不能只在调用`MoveFileExW`前注入。保留Journal与temp create/write/flush/close/重读parse故障注入，同时覆盖`ReplaceFileW`官方失败状态`ERROR_UNABLE_TO_REMOVE_REPLACED`、`ERROR_UNABLE_TO_MOVE_REPLACEMENT`、`ERROR_UNABLE_TO_MOVE_REPLACEMENT_2`及其他错误（含sharing/access/invalid parameter），并在每次失败后按实际target/replacement/snapshot重新分类。另覆盖snapshot路径创建失败、snapshot摘要读取失败、第二次安全恢复ReplaceFileW失败、no-replace rename返回目标已存在、tombstone rename失败、StructureCommitted后tombstone清理失败。任何失败都不得无痕丢失当前target、replaced snapshot、tombstone或prepared backup。

  Existing正常路径固定断言：optimistic check通过→外部不修改→`ReplaceFileW`成功→snapshot=originalDigest→target=targetDigest→`AppliedExpectedOriginal`并继续。最后时刻竞态固定在`AfterTargetOpenedOrPrepared`注入：“最后一次检查之后、系统原子替换内部之前”外部修改Config→ReplaceFileW捕获snapshot!=originalDigest→`CapturedLateModification`→不继续下一个文件。若当前target仍为CodePulse Target，在`BeforeConflictRestore`后调用第二次ReplaceFileW，恢复snapshot并把CodePulse Target保存到conflict-preserved-current；若当前target又被外部修改，则不覆盖当前target，snapshot与当前target都保留并Conflict。

  Absent路径固定断言：检查时目标absent→`BeforeAtomicReplace`后外部创建目标→no-replace publish失败并返回`DestinationAppeared`→外部目标字节不变、transaction temp保留。Removal固定断言：Bridge/Record rename到tombstone前发生外部修改→tombstone捕获真实文件且摘要异常→不永久删除；tombstone后目标路径被重新创建→不把tombstone覆盖回目标，两者保留并Conflict。两个内部`commit()`不能删除尚未StructureCommitted的Journal或Conflict artifacts。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::atomic -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::writer_tests::atomic -- --nocapture
  Pop-Location
  ```

  预期：故障注入测试失败。

- [ ] **步骤 3：先写九组固定崩溃恢复测试**

  测试名称与断言固定覆盖：

  1. Prepared Journal 写入前崩溃 → 稳定配置/Bridge/记录无变化且无不可追踪 staging；
  2. Prepared Journal 写入后、prepared backup/temp 只创建一部分时崩溃 → 目标不变，只清理本 transactionId 明确拥有的普通 staging；另一个 transactionId 的 staging/capture artifact 同时存在时不得删除；BridgeApplied Journal 已推进但 Bridge/记录均为 Original/ExpectedAbsent 时同样返回 CleanedPreparedTransaction且不改目标；
  3. BridgeApplied：Bridge=Target、Record=Original → 只恢复旧 Bridge，记录保持，最终完整原状态；
  4. BridgeApplied：Bridge=Original、Record=Target → 只恢复旧记录，Bridge 保持，最终完整原状态；
  5. 首次 Install：Bridge=Target、Record=ExpectedAbsent → 在配置已回滚且无稳定路径引用时只移除本事务新 Bridge，使两者均 ExpectedAbsent；反向混合只移除本事务新记录；
  6. ConfigApplied：Config=Target、Bridge=Target、Record=Original → 先回滚 Config，再恢复 Bridge/记录；
  7. ConfigApplied：三者 Target且 InstalledOrRepaired invariant 通过 → 提升 StructureCommitted并保留新结构；invariant 失败且无外改 → 先 Config、后逐文件回滚；
  8. Bridge=ExternalModification、Record=Target → Conflict，不覆盖 Bridge、不删除仍可能被引用的稳定 EXE；配置外改同理；
  9. StructureCommitted 后、清理前崩溃 → 只清理当前 transactionId 的prepared backup、正常original snapshot、已提交tombstone、temp/Journal，不回滚结构；Conflict artifacts不清理。

  在九组基础上增加精确原子回归：Prepared已持久化后Config外改且staging前由optimistic check发现；existing正常ReplaceFileW snapshot=originalDigest；检查后/替换内部前外改由snapshot捕获；late snapshot且当前target=Target时二次ReplaceFileW恢复；late snapshot且当前target又外改时两者保留；absent目标最后时刻出现时no-replace失败；Bridge正常替换后Record捕获late modification时不继续Config且Repair恢复Bridge；Bridge/Record均Target后Config捕获late modification时Config外改不丢、两者按action-aware恢复；prepared backup摘要不符时零目标操作。

  Uninstall另固定三组：Bridge rename到tombstone前外改，tombstone捕获真实文件且不永久删除；tombstone后目标路径被重新创建，两者保留并Conflict；正常Uninstall时Bridge/Record进入tombstone，满足Uninstalled invariant，StructureCommitted后才删除tombstone。

  另覆盖 Repair 前 Hook 一直引用稳定路径：Repair rollback 恢复旧 EXE 与旧记录，不返回引用冲突；Install 前 Bridge 不存在但配置仍引用稳定路径时禁止删除；Prepared+Bridge/记录部分 Target按 BridgeApplied逐文件恢复；BridgeApplied+Config Target按 ConfigApplied验证；Journal损坏或任一摘要既非原也非目标都 ExternalModification/Conflict且不覆盖。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::recovery -- --nocapture
  Pop-Location
  ```

  预期：统一恢复函数不存在，测试失败。

- [ ] **步骤 4：实现统一 Journal、writer 与恢复矩阵**

  transactionId固定为32 hex；五类路径后缀按本任务接口固定且创建使用`create_new(true)`或Windows原子API。`classify_transaction_artifact()`按存在性/摘要输入逐文件分类；`verify_artifact_matches_expected_original()`每次重读path并返回Original/ExpectedAbsent/Target/ExternalModification，只作为optimistic precondition check。`prepare_config_apply()`/`prepare_bridge_install()`只在内存保存目标材料与确定性路径；coordinator持久化完整Prepared Journal、双重验证prepared backup/target temp并通过all-staging-ready后，才允许调用统一三个原子接口。

  Existing必须用`ReplaceFileW`并验证target/snapshot；late snapshot按二次安全ReplaceFileW规则恢复或保留全部版本。Absent必须no-replace发布；Removal必须rename到tombstone，不能调用DeleteFileW。配置apply后还要按JSON/TOML重新解析。Bridge apply后推进同一Journal到BridgeApplied，Config apply后推进ConfigApplied，action-specific invariant后才推进StructureCommitted。Config/Bridge`commit()`只消费进程内handle；StructureCommitted是唯一跨进程提交点。稳定Journal存在时只处理权威ID；无稳定Journal时只执行精确Prepared-only孤立清理。所有unsafe块添加中文安全前提，保证UTF-16缓冲区调用期间存活、三条ReplaceFileW路径同卷，并把sharing violation与官方部分失败码映射为可恢复错误。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  Pop-Location
  ```

  预期：ID-first prepare、Prepared 前零 staging、摘要、确定性 staging、原子序列、四阶段、九组逐文件崩溃恢复、阶段落盘滞后、action-aware rollback、Conflict 与 cleanup Warning 全部通过；成功路径无 BOM/temp/Journal残留。

- [ ] **步骤 5：提交统一事务基础**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n 'join\("CodePulse"\)|join\("runtime"\)|join\("bin"\)|codex-integration-transaction' src-tauri/src/codex/integration --glob '!transaction_tests.rs'
  git diff --check
  ```

  预期：目录/事务文件名拼接无命中；所有检查通过。

  建议提交信息：

  ```text
  统一恢复 Codex 配置与 Bridge 事务
  ```

---

## 任务 2：实现 PE 架构校验与 Bridge 稳定安装事务

**独立交付物：** installer 只接受与编译 target 一致且 Subsystem=WindowsGui 的合法 PE，支持首次安装、升级、篡改保护、piped 启动契约、自检与回滚。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/pe.rs`
- Create: `src-tauri/src/codex/integration/pe_tests.rs`
- Create: `src-tauri/src/codex/integration/installer.rs`
- Create: `src-tauri/src/codex/integration/installer_tests.rs`

**消费接口：** `paths.packaged_bridge`、`paths.installed_bridge`、`paths.install_record`、`env!("CODEPULSE_TARGET_TRIPLE")`、04A BridgeState/BridgeInstallRecord。

**产生接口：**

```rust
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

`prepare_bridge_install()`只验证资源、PE/hash/piped契约、计算原/目标摘要与由transactionId确定的temp/prepared backup/replaced snapshot/conflict-preserved-current/removed tombstone路径并把待写字节保存在内存；禁止创建任何artifact、替换Bridge/Record或创建Journal。调用方用相同transactionId构造并持久化完整Prepared Journal后，由coordinator完成三文件optimistic precondition check、prepared backup/temp完整性与all-staging-ready屏障，才调用`apply()`。`apply()`按Bridge/Record的existedBefore分别调用`atomically_replace_existing_artifact()`或`atomically_publish_absent_artifact()`；任一`CapturedLateModification`、`DestinationAppeared`或写后验证失败都停止，不继续下一文件，并按实际target/snapshot action-aware恢复。Bridge/Record完成后由统一coordinator推进同一Journal到BridgeApplied，installer不得创建日志或自写原子替换。`commit()`只终结进程内资源；StructureCommitted后只清正常artifacts，Conflict artifacts保留。

`rollback()`必须action-aware：Install的`bridge_existed_before=false`只有在配置已回滚且不再引用稳定路径时才处理新Bridge；Repair的`bridge_existed_before=true`优先恢复ReplaceFileW实际捕获且摘要=originalDigest的replaced snapshot到同路径，再恢复旧install record，prepared backup仅在没有late snapshot且snapshot不可用的安全分支作为后备。Hook一直引用相同路径不构成冲突，引用检查只防删除、不阻止同路径恢复。逐文件恢复先看当前target与捕获artifact；late snapshot高于prepared backup，ExternalModification不覆盖并返回Conflict。

- [ ] **步骤 1：先写 PE/COFF 解析失败矩阵**

  fixture 覆盖空文件、只有 MZ、e_lfanew 越界、无 `PE\0\0`、未知 Machine、x64 target+ARM64 EXE、ARM64 target+x64 EXE、不支持 triple、Optional Header 太短、非法 PE Magic、x64/ARM64+Console Subsystem=3、未知 Subsystem；正例只允许 `0x8664`/x64+WindowsGui=2 与 `0xAA64`/ARM64+WindowsGui=2。每例同时与 Plan 01 PowerShell 验证脚本的期望码对齐。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::pe_tests -- --nocapture
  Pop-Location
  ```

  预期：旧 MZ-only 校验不能通过新增测试。

- [ ] **步骤 2：先写 installer 安装/升级/篡改失败测试**

  覆盖transactionId先分配，prepare阶段只产生摘要/目标字节/确定性五类路径且文件系统零写入；未持久化Prepared Journal时稳定Bridge/Record不变。Prepared后先optimistic precondition check，再创建本ID prepared backup/temp并通过all-staging-ready。已有Bridge/Record必须由ReplaceFileW捕获snapshot；首次安装必须no-replace publish。正常existing路径snapshot=originalDigest且target=targetDigest；最后一次检查之后、系统原子替换内部之前修改Bridge/Record时snapshot捕获late modification且不继续；首次安装目标在publish前出现时`DestinationAppeared`且外部字节不变。target_triple安装记录只在完整PE metadata通过后生成、current不重写、篡改不自动覆盖。Config/Bridge handle的transactionId用`assert_eq!`固定相同。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::install -- --nocapture
  Pop-Location
  ```

  预期：installer 尚未实现，测试失败。

- [ ] **步骤 3：先写进程自检与回滚失败测试**

  安装后用 `std::process::Command` 执行 `--codepulse-self-check`，显式 `stdin/stdout/stderr` piped，要求一秒内 stdout 精确 `{}`、stderr 空、exit 0；同时以 Hook 参数写入测试 JSON验证 GUI Subsystem 仍能读写管道。无法启动、超时或输出违约时逐文件恢复安装前状态：首次 Install 只有配置已不引用稳定路径才删除新副本；Repair 即使 Hook 始终引用稳定路径也必须恢复同路径旧 EXE/旧记录且不返回引用冲突。再注入 Bridge 已替换/记录仍旧、Bridge 仍旧/记录已替换两种失败，断言只回滚 Target artifact。

  精确竞态专例固定为：`AfterTargetOpenedOrPrepared`修改Bridge，ReplaceFileW snapshot捕获late modification；Bridge正常Target后Record替换瞬间捕获late modification，不继续Config且Repair恢复Bridge；late snapshot且当前target仍为CodePulse Target时二次ReplaceFileW恢复snapshot并保存CodePulse Target；当前target再次外改时不覆盖并保留两版本。任一原子操作报告成功但目标摘要不是targetDigest，不继续记录或配置。文件占用替换重试固定3次、间隔50ms，测试注入sleeper不真实等待；每次重试前可再做optimistic check，但安全性仍以原子操作捕获结果为准。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::rollback -- --nocapture
  Pop-Location
  ```

  预期：self-check/rollback 测试失败。

- [ ] **步骤 4：实现 PE 校验和 installer**

  Rust解析顺序与PowerShell完全一致：DOS Header≥64字节；MZ；e_lfanew；PE签名；COFF Machine；Optional Header与WindowsGui Subsystem。installer在内存准备目标材料时调用完整metadata、SHA-256与piped契约；Prepared前不得创建bin staging或替换稳定路径。Prepared后的prepared backup完整性与all-staging-ready由统一coordinator提供，installer只调用统一existing/absent原子接口并验证Target/snapshot。安装记录目标字节为UTF-8 without BOM，在prepare时只存在内存；existing记录由ReplaceFileW捕获，absent记录no-replace发布。rollback不触碰Hook文件，但按Install/Repair与snapshot优先级逐文件恢复Bridge/记录。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::pe_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::installer_tests -- --nocapture
  Pop-Location
  ```

  预期：PE Machine/Subsystem 失败矩阵、安装、升级、篡改、GUI 管道自检和回滚全部通过。

- [ ] **步骤 5：提交 Bridge installer**

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-codex-bridge-resource-validation.ps1
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  git diff --check
  ```

  预期：PowerShell/Rust PE 矩阵和质量检查通过。

  建议提交信息：

  ```text
  校验并安装目标架构正确的 Codex Bridge
  ```

---

## 任务 3：按 startup inspection 恢复事务、启停 Runtime 并扩展 self-check

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

  recover conflict 必须 stop_if_unused(StartupInspectionDisallows)，按停止顺序清空旧任务并发布 config_conflict，`errorCode` 精确为 `IntegrationTransactionConflict` 或 `OrphanTransactionConflict` 且不 start；inspection 读失败发布 config_conflict/service_error 的稳定码但不阻止音乐、托盘、窗口初始化。

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

  `initialize_app()` 只 spawn orchestrator，不直接 start HTTP。orchestrator 从 manager 取得同一个 paths 与 `runtime.snapshot_store()`，先调用统一 Integration Transaction 恢复：稳定 Journal存在时只接受其ID；稳定 Journal不存在时只枚举精确 Journal temp模式并执行 Prepared-only判定。任一 `IntegrationTransactionConflict`/`OrphanTransactionConflict` 都停止 Runtime、保留证据并发布带稳定errorCode的config_conflict。只有恢复成功后才取得静态 inspection并调用 04A decision；成功/失败均使用 `derive_codex_listening_status()` 发布完整 CodexListeningStatus，绝不把动态 phase 写回 inspection。modified 只启动接收链路，不自动修复。stop 使用 handle 的完整 Owner；runtime 目录探针只在 paths.runtime_dir 内创建/rename/delete临时文件，不递归删除、不放宽 ACL、不跟随 reparse point。

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

## 任务 4：公开 inspect/preview/apply/安全恢复命令并组织安装、修复和卸载

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

- [ ] **步骤 2：先写 Install/Repair 统一 Journal 顺序与 post-write 失败测试**

  顺序必须逐项记录并断言：

  ```text
  1. 重新静态 inspection
  2. 重新计算 expectedDigest/previewDigest
  3. 分配唯一 transactionId
  4. 用同一 transactionId 先 prepare Config、再 prepare Bridge，纯计算两类目标材料
  5. 验证 PE Machine/WindowsGui、hash 和 Bridge piped 启动契约
  6. 构造包含三类目标摘要与全部 owned staging 路径的完整 Prepared Journal
  7. 原子持久化 Prepared Journal
  8. 重新读取Config/Bridge/Record执行optimistic precondition check；三者仍为Original/ExpectedAbsent后才创建本transactionId的prepared backup/temp，并在all-staging-ready屏障验证originalDigest/targetDigest、全部capture路径与当前Prepared Journal ID
  9. Bridge/安装记录按existing调用ReplaceFileW并验证replaced snapshot，按absent调用no-replace publish；任一CapturedLateModification或DestinationAppeared立即停止并保留逐文件rollback/capture handle
  10. 把同一 Journal 推进 BridgeApplied
  11. Runtime 未启动时 ensure_started(InstallSelfCheck/RepairSelfCheck)
  12. 确认Bridge/Record均为本事务Target且无late snapshot；Config执行optimistic precondition check后按existing/absent原子语义应用，立即验证targetDigest与snapshot，再完成ConfigApplyTransaction且不创建第二日志
  13. 把同一 Journal 推进 ConfigApplied
  14. 重新读取三类目标并执行 InstalledOrRepaired post-write invariant
  15. 把同一 Journal 推进 StructureCommitted
  16. commit Config/Bridge 进程内 handle并清理
  17. 派生并发布 awaiting_trust 或 partial ListeningStatus
  18. 运行完整 self-check
  19. 返回 inspection/listeningStatus/selfCheck
  ```

  调用记录器必须专门断言transactionId在`prepare_config_apply`/`prepare_bridge_install`前分配，两个prepare收到同一ID；Prepared原子写入前任何故障都无目标变化、无staging。Prepared写入后、staging前先对三目标执行optimistic precondition check；任一变化都不创建新staging。prepared backup/temp创建一半崩溃时，下次恢复只清本transactionId普通staging，不删除并存的另一ID文件；全部staging完成但任一摘要错误、capture路径意外存在或Prepared Journal不再是当前ID时不开始第一个原子操作。

  失败矩阵必须逐文件覆盖：Bridge正常ReplaceFileW后Record替换瞬间捕获late modification→不继续Config→Repair按snapshot优先恢复Bridge且Record外改保留；Bridge/Record=Target后Config替换瞬间捕获late modification→Config外改不丢→Bridge/Record按action-aware恢复。每个late snapshot都覆盖“当前target仍为CodePulse Target时二次ReplaceFileW安全恢复并保存CodePulse Target”和“当前target又被外改时不覆盖且两版本保留”。首次Install的Bridge/Record在检查时absent、rename前目标出现→DestinationAppeared且外部字节不变。Bridge=Target/Record=Original与反向混合仍只回滚Target；ConfigApplied失败按当前target→capture artifacts→prepared backup→Journal摘要优先级恢复。任一原子操作成功但写后不等于targetDigest立即停止。首次Install验证失败停止临时Runtime、Store.clear/发布空快照、owner-aware删除discovery；Repair验证失败保持原合法链路，任何prepared backup都不得覆盖late snapshot。

  Commands层Exact回归必须传入`paths.installed_bridge`：稳定Bridge双command正确→Exact；其他EXE+marker不得成为安全Marker；旧路径、基础/Windows command任一个错误、附加`--extra`→Modified。用户同事件独立matcher group不进入CodePulse projection且仍Exact；混合group→Modified，显式Repair后用户handler深度相等、CodePulse group独立。post-write invariant只接受该路径绑定projection为Exact。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::install_repair -- --nocapture
  Pop-Location
  ```

  预期：事务顺序/回滚测试失败。

- [ ] **步骤 3：先写结构提交、自检失败与 Uninstall 测试**

  先覆盖action-specific结构提交边界：Install/Repair的Marker=Exact+Bridge/记录=Target+PE/hash/piped valid，且所有replaced snapshot都等于对应originalDigest、无conflict-preserved-current，才返回InstalledOrRepaired并推进StructureCommitted。之后self-check失败保留结构。StructureCommitted只清prepared backup、正常original snapshot、已提交tombstone、temp/Journal；清理失败warning，Conflict artifacts不得被普通清理删除。

  Uninstall也使用同一Journal但不经过Install/Repair的BridgeApplied语义。顺序固定为：重新静态inspect/双摘要→分配transactionId→纯准备Config Target、Bridge/Record absent目标与owned capture路径→持久化Prepared→optimistic precondition check与all-staging-ready→Config按existing/absent原子语义应用并验证snapshot/targetDigest→推进ConfigApplied→验证Marker=Absent且无稳定Bridge引用→stop/clear/publish not_installed→对每个待删目标再次确认Config为本事务Target且无引用、执行optimistic precondition check、调用`atomically_capture_artifact_for_removal(target, tombstone, expectedDigest)`→验证target absent且tombstone摘要正确→只有Marker=Absent、无引用、Bridge/Record目标均absent且tombstone受当前Journal控制才返回Uninstalled→推进StructureCommitted→删除tombstone/正常artifacts。禁止直接DeleteFileW；任一捕获/验证失败停止后续目标。

  Uninstall恢复矩阵必须覆盖：Bridge tombstone已捕获+Record仍present→继续捕获Record；反向同理；Marker absent但任一目标仍present→不得StructureCommitted；两目标absent但tombstone不受Journal控制或摘要异常→不得提交。Bridge rename前发生外改→tombstone捕获真实文件且不永久删除；tombstone后目标路径被重新创建→不覆盖回去，两者保留并Conflict；正常Uninstall→两tombstone进入Journal→Uninstalled invariant→StructureCommitted后删除。tombstone摘要异常且target仍absent时只允许no-replace恢复；target已重建时保留两者。捕获失败保留ConfigApplied Journal供retry，不恢复Hook、不重启runtime。local hooks=false同样适用。

  再覆盖安装生命周期：安装完成且 generation=1 收到真实事件 → running；确认卸载 → generation=None/authenticatedGeneration=None/更高 revision 空快照/not_installed；重新安装 → generation=2、authenticatedGeneration=None、awaiting_trust，绝不能沿用 generation=1 直接 running；generation=1 晚到 reporter 忽略；generation=2 第一条真实事件后才 running。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::uninstall -- --nocapture
  Pop-Location
  ```

  预期：卸载生命周期测试失败。

- [ ] **步骤 4：先写 Conflict 安全重试失败测试**

  固定覆盖：Conflict后不修改任何文件直接retry → 仍Conflict且Config/Bridge/Record字节与Journal不变；用户手工把Config恢复为Original → retry完成action-aware回滚并清理Journal；用户把三者恢复为Target且action-specific invariant通过 → retry提升StructureCommitted并只清理；并发双击retry → operation mutex只执行一次恢复状态机，第二次得到串行后的结果；没有稳定Journal且没有孤立temp → NoPendingTransaction；retry成功 → 重新Inspection、按决策启停Runtime并发布新的ListeningStatus。另覆盖孤立Journal temp从异常状态由用户处理后重新满足Prepared-only条件，retry可清理；仍异常则继续OrphanTransactionConflict。所有用例断言没有force overwrite、force discard、ignore digest或Feature键修改调用。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::recovery_retry -- --nocapture
  Pop-Location
  ```

  预期：安全重试命令与串行恢复编排尚未实现，测试失败。

- [ ] **步骤 5：实现串行 apply 与四个 Tauri 命令**

  manager内integration operation mutex保证apply与retry互斥串行；inspect/preview可并发读。apply锁内重新计算双摘要，分配ID，纯prepare并持久化Prepared，执行optimistic precondition check、prepared backup/temp完整性与all-staging-ready，最后按existing/absent/removal调用统一原子接口。Install/Repair精确按步骤1–19执行，验证targetDigest与replaced snapshot；CapturedLateModification/DestinationAppeared立即停止并保留证据。StructureCommitted是跨进程提交点；rollback按当前target→capture artifacts→prepared backup→Journal摘要优先级并遵守action-aware规则。Commands不实现第二套原子文件逻辑、不手写Fixture。Uninstall支持local disabled安全marker且不启动Runtime。

  retry只调用统一恢复函数并复用startup的“恢复→Inspection→Runtime decision→ListeningStatus”后半段；没有Journal/孤立temp返回NoPendingTransaction，成功返回`CodexIntegrationRecoveryResult`，Conflict返回稳定`IntegrationTransactionConflict`/`OrphanTransactionConflict`。阻塞文件I/O放入`tauri::async_runtime::spawn_blocking`；每次返回静态inspection、单独派生的完整listeningStatus与selfCheck或recovery outcome，错误对UI只返回稳定码/中文短句，不含token、配置正文或完整路径正文。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests -- --nocapture
  cargo test -p netspeed-dynamic --lib
  Pop-Location
  ```

  预期：disabled 零副作用、install/repair、uninstall、并发摘要和命令注册全部通过。

- [ ] **步骤 6：完成 04B 门禁并停止**

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

  预期：故障注入、PE、篡改、startup、退出、apply/uninstall/retry全部通过；没有设置页或useCodexIntegration；随后停止等待04B review。

  建议提交信息：

  ```text
  公开 Codex 集成事务与生命周期命令
  ```

## 04B 完成门禁

- `paths.integration_transaction_file` 是唯一 Journal；Writer/Installer 不拼接路径、不创建第二日志。transactionId 在 Config/Bridge prepare 前分配，两个 handle 收到同一 ID；prepare 只计算/验证且零目标副作用。Journal 不含正文、Token、Hook 输入、用户命令、项目路径正文或 Bridge bytes。
- Config/Bridge/Record 的target temp、prepared backup、replaced snapshot、conflict-preserved-current、removed tombstone路径全部由transactionId+target filename确定并写入同一Journal；Journal原子temp也由稳定Journal路径+transactionId确定，且须通过文件名/内容ID双校验。Prepared前崩溃无目标staging，Prepared后部分staging恢复只清当前ID的普通staging，不扫描或删除其他`.codepulse-*`。Prepared、BridgeApplied、ConfigApplied、StructureCommitted的Journal推进均走temp→write→flush→close→重读解析→原子替换。
- Prepared稳定Journal落盘后、任何staging创建前，Config/Bridge/Record必须重新读取并由`verify_artifact_matches_expected_original()`分类；只有三者均Original/ExpectedAbsent才继续。该optimistic precondition check只提前发现变化，不是原子CAS。每个prepared backup从当前原字节生成，create_new/write/flush/close/重读后两次匹配originalDigest；existedBefore=false要求prepared backup=None且目标仍缺失。三类staging、全部capture路径及当前Prepared Journal ID通过all-staging-ready屏障前零目标操作。
- Existing文件替换只走`atomically_replace_existing_artifact()`，由`ReplaceFileW`把实际旧内容捕获到transaction-owned replaced snapshot；snapshot=originalDigest且target=targetDigest才继续。snapshot异常立即`CapturedLateModification`，不得继续下一文件；当前target仍为本事务Target时用第二次`ReplaceFileW`恢复snapshot并把CodePulse Target保存为conflict-preserved-current，当前target又外改时保留两版且不覆盖。prepared backup不得覆盖late snapshot。
- Absent文件只走`atomically_publish_absent_artifact()`的同目录no-replace move；最后时刻出现目标必须返回`DestinationAppeared`且外部字节不变，禁止`MOVEFILE_REPLACE_EXISTING`。Removal只走`atomically_capture_artifact_for_removal()`，把Bridge/Record原子rename为removed tombstone；禁止用`DeleteFileW`直接删除，StructureCommitted前不得永久删除tombstone。
- 稳定Journal存在时只处理其权威transactionId，其他ID的Journal temp、目标staging/capture artifact只诊断不删除；稳定Journal不存在时只枚举`.<journal-filename>.codepulse-<32hex>.tmp`。合法Prepared-only且无同ID目标staging/capture artifact的一个或多个temp可清理；损坏、ID不符、非Prepared、目标变化或同ID artifact均保留并`OrphanTransactionConflict`，Runtime不启动。其他ID普通目标artifact不扫描不删除；单实例前提有测试，移除单实例前必须先加进程间事务锁。
- `TransactionArtifactState`对Config/Bridge/Record逐文件分类；BridgeApplied和ConfigApplied按“当前目标→replaced snapshot/tombstone/conflict-preserved-current→prepared backup→Journal摘要”恢复，late snapshot优先于prepared backup，ExternalModification不覆盖。Repair始终恢复同路径旧EXE/旧记录，路径引用只防Install移除；九组固定恢复、阶段落盘滞后、用户并发修改与损坏Journal测试通过。
- writer返回`ConfigApplyTransaction`，通过摘要、optimistic precondition check、Prepared后prepared backup/同目录temp、重新解析与统一原子接口实现；writer和installer不得各自实现替换规则。两个内部commit只终结进程内资源，action-specific invariant后的StructureCommitted是跨进程提交点。
- Bridge 资源与稳定副本都验证 PE 签名/Machine/Optional Header/WindowsGui；x64/ARM64 反配、Console Subsystem、不支持 triple 和旧 target 误复制被拒绝；piped Bridge 契约通过。
- startup 严格构造唯一 Store并注入 Manager→恢复 Integration Transaction→静态 inspection→decision→generation runtime→独立 listening status；`Arc::ptr_eq`/单次构造通过，modified 启动但不自动覆盖，Feature alias conflict停止，旧 generation 上报不影响新 Runtime。
- local disabled 的 install/repair 不写配置/Bridge、不启动 HTTP；安全 marker uninstall 允许且不启动 Runtime；managed disabled 与 ambiguous conflict 全部只读。
- Install/Repair按固定19步执行：allocate ID→pure prepare→persist Prepared→owned staging→atomic apply。InstalledOrRepaired要求Marker=Exact、Bridge/Record=Target、PE/hash/piped有效且正常snapshot等于originalDigest；ConfigApplied混合状态按action-aware规则逐文件恢复。Uninstalled要求Marker=Absent、无稳定路径引用、Bridge/Record目标absent且tombstone受当前Journal控制；Marker absent但目标仍存在或tombstone无法解释不得提交。StructureCommitted后self-check失败保留正确结构并返回partial/service_error；普通cleanup失败只warning，Conflict artifacts保留。
- 首次Install失败停止临时Runtime、发布更高revision空快照并owner-aware删除discovery；Repair失败保持原合法链路；Uninstall先发布空快照再not_installed，最后原子捕获Bridge/Record为tombstone，StructureCommitted后才清理。
- `AtomicIntegrationFs`在`BeforeAtomicReplace`、`AfterTargetOpenedOrPrepared`、`AfterAtomicReplaceBeforeVerification`、`BeforeConflictRestore`、`AfterRemovalCaptureBeforeVerification`提供精确注入点。测试覆盖Existing正常/两种late modification恢复、Absent最后时刻出现、Bridge/Record与Config顺序、Uninstall三种tombstone竞态及全部原子API故障；任何失败不得丢失当前目标、replaced snapshot、tombstone或prepared backup。
- SnapshotStore 跨 stop/start 保持 revision；每个 Runtime 使用新 generation 和完整 DiscoveryOwner；RunEvent/stop 不误删新 Runtime 文件。
- inspect/preview/apply/retry 四个命令均注册；`CodexHookChangeResult` 同时返回静态 inspection、独立 listeningStatus 与 selfCheck，恢复命令返回outcome/inspection/listeningStatus，错误不泄密；无 Vue 设置页。
- `retry_codex_integration_recovery`与apply共用operation mutex，只重跑统一恢复；无事务返回NoPendingTransaction，手工恢复到Original/Target/ExpectedAbsent后可安全回滚或提交。成功后重新Inspection、Runtime决策并发布ListeningStatus；仍冲突则字节与Journal不变。不存在强制覆盖、强制删除事务、忽略摘要或改Feature键的入口。
- 全部通过后停止，未经 review 不得执行 04C。
