# 阶段四 B：Writer、Bridge Installer 与 Tauri Commands 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 04A 只读 inspection/planner 已审核通过后，实现并发安全且可跨进程恢复的统一 Integration Transaction、目标架构正确的 Bridge 稳定安装、Tauri inspect/preview/apply 命令，以及由 startup inspection/install/uninstall 驱动的 HTTP/Actor 生命周期。

**架构：** apply coordinator 在重新 inspection/双摘要后先分配 transactionId，再让 writer 和 installer 纯准备 `ConfigApplyTransaction`/`BridgeInstallTransaction`；完整 Prepared Journal 原子持久化前不创建 staging、不修改目标。两个句柄共享同一 transactionId，并由 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json` 的 Integration Journal 协调；Journal 以 Prepared、BridgeApplied、ConfigApplied、StructureCommitted 四阶段记录三类目标的逐文件摘要与 transaction-owned temp/backup。startup orchestrator 严格执行统一恢复→静态 inspection→runtime generation 决策→状态发布；apply command 只在 action-specific StructureCommitted 前允许逐文件回滚，并在 stop/uninstall 时清空 Manager 持有的唯一进程级 `CodexSnapshotStore`。Vue 设置页不在本批次实现。

**技术栈：** Rust、sha2、Windows `MoveFileExW`、Tauri 2.11.5 async runtime、Tokio、阶段一 PE/路径契约与阶段二 Runtime Manager；不新增前端依赖。

## 全局约束

- 前置门禁：04A 全部通过并已单独 review。
- writer、installer、runtime、self-check 与 commands 只消费同一个 `CodexIntegrationPaths`。
- 唯一事务路径字段是 `integration_transaction_file`；只有 `paths.rs` 可以拼接 `codex-integration-transaction.json`，Writer、Installer、Startup、Commands 与测试只消费字段。
- `features.hooks=false` 的 install/repair 在进入 installer/runtime/writer 前返回 HooksDisabled；有安全 marker 的 uninstall 允许进入 writer，但不安装 Bridge、不启动 HTTP。managed disabled 三种 action 全部零写入。
- runtime startup 只由 04A decision 或 install/repair self-check 启动；idlePersistent 没有调用路径。
- `CodexRuntimeManager::new(app, paths, snapshot_store)` 显式接收 setup 唯一创建的 Store；04B 不增加第二个 managed state，startup/commands/Actor/stop/restart 都通过 `runtime.snapshot_store()`。
- Feature alias conflict 或非布尔在进入 installer/runtime/writer 前返回 ConfigConflict；三种 action 均零写入、Runtime RemainStopped并发布 config_conflict。
- modified 允许服务启动但禁止后台覆盖配置；只有显式 Repair preview/apply 可修改。
- 卸载先移除并验证 marker，再停服务并发布更高 revision 空快照，最后删 Bridge；删除 EXE 失败不恢复 Hook。
- 每个新 Runtime generation 清空认证事实；旧 generation reporter/关闭回调不得更新新 Runtime。
- Discovery 的 stop/exit/drop 清理只使用完整 `DiscoveryOwner`；不允许只比 PID 或 startedAt。
- 正式顺序统一为 allocate transactionId → pure prepare Config/Bridge → persist Prepared Journal → create owned staging → apply；禁止 prepare handle 后再分配 transactionId。
- 所有 transaction temp/backup 路径都由 transactionId+target filename 确定性推导并写入 Journal；Prepared 恢复只清理该 Journal 明确拥有的路径，不扫描其他 `.codepulse-*` 文件。`CodexIntegrationPaths` 不增加 staging 字段。
- 本计划完成后停止等待 review，不自动进入 04C。

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
    pub backup_path: Option<PathBuf>,
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

Journal 禁止包含配置正文、Token、Hook 输入、用户命令、项目路径正文或 Bridge 二进制内容。`target_bridge_exists`/`target_record_exists` 支持 Uninstall 缺失目标；为 false 时对应 target digest 固定为 SHA-256(empty bytes)，存在性位区分缺失与零字节文件。配置目标在当前动作中固定为存在的可解析文件。`transaction_id` 固定为 16 个 CSPRNG 随机字节的小写 32 hex，必须在 `prepare_config_apply()`/`prepare_bridge_install()` 之前分配；Config/Bridge 句柄必须保存并测试同一个值。配置、Bridge 和记录的 temp/backup 路径完全由 `transactionId + target filename` 确定性推导，固定形如 `.<filename>.codepulse-<transactionId>.tmp|bak` 并写入 Journal，禁止与 transactionId 无关的随机 temp 名。Journal 自身的原子写 temp 由 `paths.integration_transaction_file + transactionId` 确定为 `.<journal-filename>.codepulse-<transactionId>.tmp`；启动恢复只检查这一精确命名空间，且只有文件可完整反序列化、内容 transactionId 与文件名一致时才能清理，格式损坏或 ID 不符则保留诊断并返回 Conflict，禁止泛扫其他 `.codepulse-*`。Journal 创建和每次阶段推进统一执行：该事务的 Journal temp → write → flush → close → 重新读取并反序列化完整 Journal → `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`。只有 `transaction.rs` 调用该写入器；writer/installer 不原地改 Journal。

transaction prepare 是严格无目标副作用阶段：允许读取、计算摘要/目标字节/确定性 staging 路径、验证 PE/hash/piped 进程契约并把材料保存在内存；禁止修改稳定 Bridge、安装记录、Hook 配置，禁止创建 backup/temp/Journal。coordinator 构造含全部路径/摘要的 Journal并成功持久化 Prepared 后，才创建本 transactionId 的 backup/temp。Prepared 写入前崩溃因此必须满足稳定配置/Bridge/记录无变化且没有 staging 文件。

阶段与恢复矩阵固定为：

- Prepared：在任何 staging 创建/目标替换前写入，包含原配置/Bridge/记录摘要、全部目标摘要与 transaction-owned temp/backup 路径。配置、Bridge、记录仍为 Original/ExpectedAbsent 时，无 staging、部分 staging 或全部 staging 都不改目标，只删除 Journal 明确列出的当前 transactionId 文件并返回 CleanedPreparedTransaction；不得 glob/扫描其他 `.codepulse-*`。任一实际目标已为 Target时按阶段落盘滞后进入下一分支；ExternalModification 时 Conflict。
- BridgeApplied（Install/Repair）：配置仍为 Original/ExpectedAbsent 时，Bridge/记录均 Original/ExpectedAbsent 表示阶段推进领先实际修改，只清理并返回 CleanedPreparedTransaction；均 Target时逐文件回滚到事务前状态；Bridge=Target+Record=Original/ExpectedAbsent，或 Bridge=Original/ExpectedAbsent+Record=Target，都是合法双文件中间崩溃，只回滚 Target 文件，另一个保持，最终恢复完整事务前状态。首次 Install 的 ExpectedAbsent 回滚为在确认无配置引用后删除新文件；Repair 的 Original 回滚为恢复备份旧字节/旧记录到相同路径，稳定路径仍被 Hook 引用不构成冲突。任一 ExternalModification 时不覆盖、保留 Journal/备份/诊断并返回 Conflict。
- ConfigApplied（Install/Repair）：配置为 Target且 Bridge/记录均 Target 时执行 `InstalledOrRepaired` invariant，通过才推进 StructureCommitted；验证失败且无 ExternalModification 时先回滚 Config，再逐文件回滚 Bridge/记录。Bridge/记录 Original/Target 混合是合法崩溃窗口：只要三者都是本事务已知 Original/Target/ExpectedAbsent，就不提交部分结构，必须先回滚 Config、确认配置不再依赖待删除的新 Bridge，再逐文件恢复 Bridge/记录。配置仍为 Original/ExpectedAbsent 时按 BridgeApplied 分支恢复。任一 ExternalModification 时不覆盖用户字节、不删除仍可能被引用的 Bridge，返回 Conflict并保留备份。
- StructureCommitted：永远保留当前正确配置和 Bridge，只清理 backup/temp/Journal并返回 CleanedStructureCommitted；任何清理失败只返回 Warning，不回滚结构。

恢复不得盲信阶段：若 Prepared 的实际逐文件状态已经出现 Bridge/记录 Target，按 BridgeApplied 分支恢复；若 BridgeApplied 的配置已经是 Target，按 ConfigApplied 分支恢复。这覆盖任一目标 MoveFileExW 成功但下一阶段 Journal 尚未持久化的崩溃窗口。既非 Original/Target/ExpectedAbsent 的状态统一 ExternalModification/Conflict。

- [ ] **步骤 1：先写摘要竞争、Journal 内容与备份失败测试**

  覆盖 expectedDigest 不符、previewDigest 不符、preview 后用户增加 handler、修改任一 Feature 键、改变企业约束、替换 Bridge 资源/副本/记录；每例断言不分配 transactionId、不调用 transaction prepare、不创建 temp/backup/Journal。成功路径用调用记录器精确断言 `allocate_transaction_id` 先于 `prepare_config_apply` 和 `prepare_bridge_install`，两个 prepare 收到同一 ID，禁止“prepare handle 后分配 ID”。修改已有文件的确定性 backup 路径为 `.<filename>.codepulse-<transactionId>.bak`，新建 Hook 文件 backup=None；Journal 未持久化前 backup 不存在，持久化后创建的 backup 字节等于写前原始字节。序列化 Journal 后断言包含 `target_temp_path`/`bridge_temp_path`/`record_temp_path` 及可选 backup 路径，且每个路径都含同一 transactionId；不含配置正文、token、Hook stdin、用户 command、项目 cwd 或 Bridge bytes；Journal 路径精确为 `paths.integration_transaction_file`，Journal 原子 temp 的文件名和反序列化内容包含同一 transactionId。模拟首次 Prepared 原子替换前崩溃，断言目标三文件不变、无目标 staging，遗留 Journal temp 可由文件名和内容 ID 精确认领；恢复只清该文件，另一 transactionId 的 Journal temp 与目标 staging 均保留。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::concurrency -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::journal -- --nocapture
  Pop-Location
  ```

  预期：统一 Journal 和 writer 不存在，测试失败。

- [ ] **步骤 2：先写 Journal/配置同目录原子替换故障矩阵**

  通过 `AtomicIntegrationFs` 注入 Journal 与配置 temp create/write/flush/close/重读 parse/每一个 MoveFileExW 失败；逐项断言目标保持上一个已持久化阶段可恢复状态。每次成功阶段变化均捕获调用序列，精确等于 temp→write→flush→close→reread/parse→MoveFileExW。`prepare_config_apply()` 与 `prepare_bridge_install()` 接收已有 transactionId且保持零写入；Prepared Journal 成功持久化前故障时稳定配置/Bridge/记录无变化、没有任何 staging。Journal 落盘后才允许创建明确路径的 backup/temp，且不得创建第二个日志。`rollback_if_unchanged()` 只在摘要仍等于事务 target 时恢复；用户再次修改时 Conflict并保留备份/诊断。两个内部 `commit()` 后不能 rollback，但也不能删除尚未 StructureCommitted 的 Journal。

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
  2. Prepared Journal 写入后、backup/temp 只创建一部分时崩溃 → 目标不变，只清理本 transactionId 明确拥有的 staging；另一个 transactionId 的 temp/backup 同时存在时不得删除；BridgeApplied Journal 已推进但 Bridge/记录均为 Original/ExpectedAbsent 时同样返回 CleanedPreparedTransaction且不改目标；
  3. BridgeApplied：Bridge=Target、Record=Original → 只恢复旧 Bridge，记录保持，最终完整原状态；
  4. BridgeApplied：Bridge=Original、Record=Target → 只恢复旧记录，Bridge 保持，最终完整原状态；
  5. 首次 Install：Bridge=Target、Record=ExpectedAbsent → 删除新 Bridge后两者均 ExpectedAbsent；反向混合只删除新记录；
  6. ConfigApplied：Config=Target、Bridge=Target、Record=Original → 先回滚 Config，再恢复 Bridge/记录；
  7. ConfigApplied：三者 Target且 InstalledOrRepaired invariant 通过 → 提升 StructureCommitted并保留新结构；invariant 失败且无外改 → 先 Config、后逐文件回滚；
  8. Bridge=ExternalModification、Record=Target → Conflict，不覆盖 Bridge、不删除仍可能被引用的稳定 EXE；配置外改同理；
  9. StructureCommitted 后、清理前崩溃 → 只清理当前 transactionId 的 backup/temp/Journal，不回滚结构。

  另覆盖 Repair 前 Hook 一直引用稳定路径：Repair rollback 恢复旧 EXE 与旧记录，不返回引用冲突；Install 前 Bridge 不存在但配置仍引用稳定路径时禁止删除；Prepared+Bridge/记录部分 Target按 BridgeApplied逐文件恢复；BridgeApplied+Config Target按 ConfigApplied验证；Journal损坏或任一摘要既非原也非目标都 ExternalModification/Conflict且不覆盖。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::recovery -- --nocapture
  Pop-Location
  ```

  预期：统一恢复函数不存在，测试失败。

- [ ] **步骤 4：实现统一 Journal、writer 与恢复矩阵**

  transactionId 固定为 32 hex；目标 temp/backup 名分别固定 `.<filename>.codepulse-<transactionId>.tmp|bak` 且创建使用 `create_new(true)`。`classify_transaction_artifact()` 按六项存在性/摘要输入逐文件分类。`prepare_config_apply()`/`prepare_bridge_install()` 只在内存中保存验证结果、目标摘要/字节和 staging 路径；coordinator 构造并原子持久化完整 Prepared Journal后才创建 staging。配置 apply 后按 JSON/TOML 重新解析。Bridge apply 后推进同一 Journal到 BridgeApplied，Config apply后推进 ConfigApplied，`validate_structure_commit()` 返回 action-specific invariant 后才推进 StructureCommitted。Config/Bridge `commit()` 只消费进程内 handle并清理可清理资源；StructureCommitted 是唯一跨进程提交点。所有 unsafe 块添加中文安全前提，保证 UTF-16 缓冲区在调用期间存活、源目标同卷。

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

`prepare_bridge_install()` 只验证资源、PE/hash/piped 契约、计算原/目标摘要与由 transactionId 确定的 backup/temp路径并把待写字节保存在内存；禁止创建备份/temp、替换 Bridge/记录或创建 Journal。调用方用相同 transactionId 构造并持久化完整 Prepared Journal后，才创建 staging并调用 `apply()`。`apply()` 逐文件替换 Bridge/记录后由统一 coordinator 推进同一 Journal到 BridgeApplied，installer 自己不得创建日志。内部备份不进入永久备份目录。`commit()` 只终结进程内资源；StructureCommitted 后清理失败返回 outcome warning，不回滚正确 Bridge。

`rollback()` 必须 action-aware：Install 的 `bridge_existed_before=false`，只有配置已回滚且不再引用稳定路径才删除新 Bridge；Repair 的 `bridge_existed_before=true`，必须恢复备份旧 EXE到同一路径并恢复旧 install record，Hook 一直引用相同路径不构成冲突，引用检查只防删除、不阻止同路径恢复。逐文件恢复只处理当前为 Target 的 artifact，Original/ExpectedAbsent 保持不动，ExternalModification 不覆盖并返回 Conflict。

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

  覆盖 transactionId 先分配，prepare 阶段只产生摘要/目标字节/确定性 backup/temp 路径且文件系统零写入；未持久化 Prepared Journal 时稳定 Bridge/记录绝不改变，也不存在 staging。Prepared 持久化后才创建本 ID 的 staging并 apply 首次同目录 temp+原子替换、写后 hash和安装记录。target_triple 安装记录只在完整 PE metadata 通过后生成、current 不重写、旧记录且副本等于旧 hash 才升级、副本 hash 与记录不符为 modified 且不自动覆盖、协议不匹配要求 Repair、资源错架构或 Console Subsystem 在创建 bin/temp 前失败、旧 target 目录 EXE 不被读取。Config/Bridge handle 的 transactionId 用 `assert_eq!` 固定相同，稳定路径只断言 paths 字段。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::install -- --nocapture
  Pop-Location
  ```

  预期：installer 尚未实现，测试失败。

- [ ] **步骤 3：先写进程自检与回滚失败测试**

  安装后用 `std::process::Command` 执行 `--codepulse-self-check`，显式 `stdin/stdout/stderr` piped，要求一秒内 stdout 精确 `{}`、stderr 空、exit 0；同时以 Hook 参数写入测试 JSON验证 GUI Subsystem 仍能读写管道。无法启动、超时或输出违约时逐文件恢复安装前状态：首次 Install 只有配置已不引用稳定路径才删除新副本；Repair 即使 Hook 始终引用稳定路径也必须恢复同路径旧 EXE/旧记录且不返回引用冲突。再注入 Bridge 已替换/记录仍旧、Bridge 仍旧/记录已替换两种失败，断言只回滚 Target artifact。文件占用替换重试固定 3 次、间隔 50ms，测试注入 sleeper 不真实等待。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::rollback -- --nocapture
  Pop-Location
  ```

  预期：self-check/rollback 测试失败。

- [ ] **步骤 4：实现 PE 校验和 installer**

  Rust 解析顺序与 PowerShell 完全一致：DOS Header ≥64 字节；MZ；0x3C 的 little-endian e_lfanew；边界；PE 签名；COFF Machine；COFF SizeOfOptionalHeader；PE32+ Magic=0x20B；Optional Header 足以读取偏移 68 的 Subsystem；Subsystem 必须为 `IMAGE_SUBSYSTEM_WINDOWS_GUI = 2`。installer 在内存准备目标材料时调用完整 metadata 验证，再校验 SHA-256 与 piped Bridge 启动契约；Prepared Journal 持久化前不得创建 bin staging或替换稳定路径。安装记录目标字节为 UTF-8 without BOM并包含 target triple，在 prepare 时只存在内存，在 `apply()` 内从 Journal 指定 record_temp_path 原子替换；rollback 不触碰 Hook 文件，但按 Install/Repair 差异逐文件恢复 Bridge/记录。

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

  fake journal/inspection/runtime/store/publisher 断言精确调用顺序：构造 paths 与唯一 `Arc<CodexSnapshotStore>` → `CodexRuntimeManager::new(app, paths, Arc::clone(&store))` → `app.manage(runtime)` → `recover_interrupted_codex_integration_transaction()` → 静态 inspect → decision → ensure_started 或 stop_if_unused → 若 disallow 则同一 Store.clear/发布空快照 → 由 inspection+runtime facts 派生并发布 listening status。setup fixture 计数 `CodexSnapshotStore::new()` 恰好一次，并用 `Arc::ptr_eq` 证明 startup、Actor、stop/restart与 dormant command 都经 Manager 使用同一 Store。禁止调用旧的配置单事务恢复函数。recover conflict 必须 stop_if_unused(StartupInspectionDisallows)，按停止顺序清空旧任务并发布 config_conflict 且不 start；inspection 读失败发布 config_conflict/service_error 的稳定码但不阻止音乐、托盘、窗口初始化。

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

  `initialize_app()` 只 spawn orchestrator，不直接 start HTTP。orchestrator 从 manager 取得同一个 paths 与 `runtime.snapshot_store()`，先调用统一 Integration Transaction 恢复，再取得静态 inspection并调用 04A decision；成功/失败均使用 `derive_codex_listening_status()` 发布完整 CodexListeningStatus，绝不把动态 phase 写回 inspection。modified 只启动接收链路，不自动修复。stop 使用 handle 的完整 Owner；runtime 目录探针只在 paths.runtime_dir 内创建/rename/delete临时文件，不递归删除、不放宽 ACL、不跟随 reparse point。

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

## 任务 4：公开 inspect/preview/apply 命令并组织安装、修复和卸载

**独立交付物：** 三个 Tauri 命令提供无副作用 inspect/preview 和摘要锁定的 apply；所有 action 有确定顺序与回滚。

**Files:**

- Create: `src-tauri/src/codex/integration/commands.rs`
- Create: `src-tauri/src/codex/integration/commands_tests.rs`
- Modify: `src-tauri/src/codex/commands.rs`（re-export/状态合并）
- Modify: `src-tauri/src/lib.rs`（注册三个 integration commands）

**消费接口：** 04A inspection/planner；本计划 writer/installer/startup；阶段二 manager。

**产生接口：**

```rust
pub struct CodexHookChangeResult {
    pub inspection: CodexIntegrationInspection,
    pub listening_status: CodexListeningStatus,
    pub self_check: CodexSelfCheckResult,
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
```

- [ ] **步骤 1：先写 disabled action matrix 命令测试**

  固定序列：inspection hooksFeature=disabled + marker absent → preview install 返回 HooksDisabled → prepared plan 不存在 → Bridge installer、writer、ensure_started 计数均为 0 → 路径快照不变；disabled + marker present + repair 同样 HooksDisabled。disabled + 安全 marker exact/modified/duplicate + uninstall → preview/apply 成功，Bridge installer 与 ensure_started 计数为 0，writer 只删除 CodePulse marker，其他 Hook 深度相等，再清理稳定 Bridge/记录。用户手动把 hooks 改为 true 并重新 inspect 后 install/repair preview 才成功。只有旧 `codex_hooks` 时按 effectiveState 执行并返回弃用 Issue；两个 Feature 键冲突或任一非布尔时 install/repair/uninstall 全部 ConfigConflict，Prepared plan/Journal/Bridge temp/writer/runtime 计数均为 0。managed disabled 与 representation conflict/ambiguous 不提供任何 apply 路径。

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
  8. 创建本 transactionId 的 backup/temp 文件
  9. apply Bridge/安装记录，保留逐文件 rollback handle
  10. 把同一 Journal 推进 BridgeApplied
  11. Runtime 未启动时 ensure_started(InstallSelfCheck/RepairSelfCheck)
  12. apply ConfigApplyTransaction，不创建第二个日志
  13. 把同一 Journal 推进 ConfigApplied
  14. 重新读取三类目标并执行 InstalledOrRepaired post-write invariant
  15. 把同一 Journal 推进 StructureCommitted
  16. commit Config/Bridge 进程内 handle并清理
  17. 派生并发布 awaiting_trust 或 partial ListeningStatus
  18. 运行完整 self-check
  19. 返回 inspection/listeningStatus/selfCheck
  ```

  调用记录器必须专门断言 transactionId 在 `prepare_config_apply`/`prepare_bridge_install` 前分配，两个 prepare 收到同一 ID；Prepared 原子写入前的任何故障都无目标变化、无 staging。Prepared 写入后 backup/temp 创建一半崩溃时，下次恢复只清本 transactionId 路径，不删除并存的另一 ID staging。

  失败矩阵必须逐文件覆盖：Bridge=Target/Record=Original 与反向混合都只回滚 Target；首次 Install Bridge=Target/Record=ExpectedAbsent 后恢复为两者均不存在；Config=Target、Bridge=Target、Record=Original 时先回滚 Config，再恢复 Bridge/记录；Bridge ExternalModification+Record Target 时 Conflict且不覆盖 Bridge。ConfigApplied 后 post-write invariant 失败，只有三者均无外改才先 `rollback_if_unchanged()`，再按 Install/Repair 规则恢复：Install 删除原本不存在的新 Bridge前必须确认配置不再引用；Repair 总是恢复同路径旧 EXE/旧记录，Hook 原先引用该路径不能阻止恢复。配置写入后用户再次修改则禁止覆盖，若仍引用稳定路径保留有效 Bridge。首次 Install 验证失败停止临时 Runtime、Store.clear/发布更高 revision空快照、owner-aware 删除 discovery；Repair 验证失败恢复 Repair 前结构且保持原合法 Runtime/任务，除非 Runtime 本身失败。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::install_repair -- --nocapture
  Pop-Location
  ```

  预期：事务顺序/回滚测试失败。

- [ ] **步骤 3：先写结构提交、自检失败与 Uninstall 测试**

  先覆盖 action-specific 结构提交边界：Install/Repair 的 Marker=Exact + Bridge/记录=Target + PE/hash/piped valid → `validate_structure_commit()` 返回 InstalledOrRepaired并推进 StructureCommitted；Marker Exact但 Bridge/记录不是完整 Target，或 Bridge 仍存在但记录缺失，都不得提交。之后完整 self-check 超时、ServiceListening/EventQueueOpen 等失败时，Hook/Bridge/记录保留、不恢复旧配置；result.selfCheck 带 fail/warning，listeningStatus 派生为 partial 或 service_error，绝不误报 running。StructureCommitted 后仅清理 backup/temp/Journal失败时，功能结构保留，warning 合并进对应 self-check item，后续 startup recovery只清理。

  Uninstall 也使用同一 Journal，但不经过 Install/Repair 的 BridgeApplied 语义。顺序固定为：重新静态 inspect/双摘要 → 分配 transactionId → 纯准备 Config/Bridge absent目标和 owned staging路径 → 构造并持久化 Prepared → 创建本 ID staging → Config transaction 精确移除 marker → Journal 推进 ConfigApplied → post-write inspection 验证 Marker=Absent且当前配置不再引用稳定 Bridge → stop_if_unused(Uninstalled)，内部停止接收、关闭旧 Actor/HTTP、owner-aware 删除 discovery、Store.clear并发布更高 revision 空快照、发布 listening phase=not_installed → 逐文件删除 installed_bridge/install_record → `validate_structure_commit()` 只有在 Marker=Absent、无稳定路径引用、Bridge/记录均 absent 时返回 Uninstalled → Journal 推进 StructureCommitted → 进程内 commit/清理。

  Uninstall 恢复矩阵必须覆盖：Bridge absent+Record present → 继续删 Record；Bridge present+Record absent → 再确认配置无引用后继续删 Bridge；Marker absent但 Bridge 仍存在 → 不得 StructureCommitted；Marker absent且 Bridge/记录 absent → Uninstalled/StructureCommitted。配置被用户修改、重新引用稳定路径，或任一待删文件为 ExternalModification时 Conflict并保留 Bridge/Journal。Bridge 删除失败返回 warning并保留 ConfigApplied Journal供下次恢复，不恢复 Hook、不重启 runtime、不还原整份旧备份。local hooks=false 的 uninstall 也走此路径，但不得先启动 Runtime或安装 Bridge。

  再覆盖安装生命周期：安装完成且 generation=1 收到真实事件 → running；确认卸载 → generation=None/authenticatedGeneration=None/更高 revision 空快照/not_installed；重新安装 → generation=2、authenticatedGeneration=None、awaiting_trust，绝不能沿用 generation=1 直接 running；generation=1 晚到 reporter 忽略；generation=2 第一条真实事件后才 running。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::uninstall -- --nocapture
  Pop-Location
  ```

  预期：卸载生命周期测试失败。

- [ ] **步骤 4：实现串行 apply 与三个 Tauri 命令**

  manager 内 integration operation mutex 保证 apply 串行；inspect/preview 可并发读。apply 在锁内重新计算 expectedDigest 和 previewDigest，任一变化停止；然后分配 ID，调用两个零副作用 transaction prepare，构造/持久化 Prepared，最后才创建 staging/apply。Install/Repair 精确按步骤 1–19 执行，以 action-specific invariant 后持久化 StructureCommitted 为跨进程结构提交点；self-check 位于该阶段和两个进程内 commit 之后。rollback 始终逐文件分类并遵守 Install 删除保护、Repair 同路径恢复规则。Install/Repair 的目标 CodePulse 组必须由 04A 标准 Fixture AST loader 产生，Commands 不手写事件列表或路径替换。Uninstall 支持 local disabled 安全 marker且不启动 Runtime。阻塞文件 I/O 放入 `tauri::async_runtime::spawn_blocking`；每次返回静态 inspection、单独派生的完整 listeningStatus 与 selfCheck，错误对 UI 只返回稳定码/中文短句，不含 token、配置正文或完整路径正文。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests -- --nocapture
  cargo test -p netspeed-dynamic --lib
  Pop-Location
  ```

  预期：disabled 零副作用、install/repair、uninstall、并发摘要和命令注册全部通过。

- [ ] **步骤 5：完成 04B 门禁并停止**

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

  预期：故障注入、PE、篡改、startup、退出、apply/uninstall 全部通过；没有设置页或 useCodexIntegration；随后停止等待 04B review。

  建议提交信息：

  ```text
  公开 Codex 集成事务与生命周期命令
  ```

## 04B 完成门禁

- `paths.integration_transaction_file` 是唯一 Journal；Writer/Installer 不拼接路径、不创建第二日志。transactionId 在 Config/Bridge prepare 前分配，两个 handle 收到同一 ID；prepare 只计算/验证且零目标副作用。Journal 不含正文、Token、Hook 输入、用户命令、项目路径正文或 Bridge bytes。
- Config/Bridge/记录 temp/backup 路径由 transactionId+target filename 确定并写入 Journal；Journal 原子 temp 也由稳定 Journal 路径+transactionId 确定，且须通过文件名/内容 ID 双校验。Prepared 前崩溃无目标 staging，Prepared 后部分 staging 恢复只清当前 ID，不扫描/删除其他 `.codepulse-*`。Prepared、BridgeApplied、ConfigApplied、StructureCommitted 的 Journal推进均走 temp→write→flush→close→重读解析→MoveFileExW。
- `TransactionArtifactState` 对 Config/Bridge/记录逐文件分类；BridgeApplied 和 ConfigApplied 的 Target/Original混合状态按合法崩溃窗口恢复，ExternalModification 不覆盖。Repair 始终恢复同路径旧 EXE/旧记录，路径引用只防 Install 删除；九组固定恢复、阶段落盘滞后、用户并发修改与损坏 Journal 测试通过。
- writer 返回 `ConfigApplyTransaction`，通过摘要、防并发、Prepared 后备份/同目录 temp、重新解析、原子替换与 `rollback_if_unchanged`；两个内部 commit 只终结进程内资源，action-specific invariant 后的 StructureCommitted 是跨进程提交点。
- Bridge 资源与稳定副本都验证 PE 签名/Machine/Optional Header/WindowsGui；x64/ARM64 反配、Console Subsystem、不支持 triple 和旧 target 误复制被拒绝；piped Bridge 契约通过。
- startup 严格构造唯一 Store并注入 Manager→恢复 Integration Transaction→静态 inspection→decision→generation runtime→独立 listening status；`Arc::ptr_eq`/单次构造通过，modified 启动但不自动覆盖，Feature alias conflict停止，旧 generation 上报不影响新 Runtime。
- local disabled 的 install/repair 不写配置/Bridge、不启动 HTTP；安全 marker uninstall 允许且不启动 Runtime；managed disabled 与 ambiguous conflict 全部只读。
- Install/Repair 按固定 19 步执行：allocate ID→pure prepare→persist Prepared→owned staging→apply。InstalledOrRepaired 要求 Marker=Exact、Bridge/记录=Target、PE/hash/piped有效；ConfigApplied 混合状态先 Config 后逐文件回滚。Uninstalled 要求 Marker=Absent、无稳定路径引用、Bridge/记录 absent；Marker absent但 Bridge仍存在不得提交。StructureCommitted 后 self-check 失败保留正确结构并返回 partial/service_error；cleanup 失败只 warning。
- 首次 Install 失败停止临时 Runtime、发布更高 revision 空快照并 owner-aware 删除 discovery；Repair 失败保持原合法链路；Uninstall 先发布空快照再 not_installed，最后删 Bridge。
- SnapshotStore 跨 stop/start 保持 revision；每个 Runtime 使用新 generation 和完整 DiscoveryOwner；RunEvent/stop 不误删新 Runtime 文件。
- inspect/preview/apply 注册，`CodexHookChangeResult` 同时返回静态 inspection、独立 listeningStatus 与 selfCheck，错误不泄密；无 Vue 设置页。
- 全部通过后停止，未经 review 不得执行 04C。
