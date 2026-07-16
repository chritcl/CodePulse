# 阶段四 B：Writer、Bridge Installer 与 Tauri Commands 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 04A 只读 inspection/planner 已审核通过后，实现并发安全且可跨进程恢复的统一 Integration Transaction、目标架构正确的 Bridge 稳定安装、Tauri inspect/preview/apply 命令，以及由 startup inspection/install/uninstall 驱动的 HTTP/Actor 生命周期。

**架构：** writer 和 installer 仍分别返回 `ConfigApplyTransaction`/`BridgeInstallTransaction`，但两个句柄共享同一 transactionId并由 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json` 的 Integration Journal 协调；Journal 以 Prepared、BridgeApplied、ConfigApplied、StructureCommitted 四阶段记录可恢复摘要。startup orchestrator 严格执行统一恢复→静态 inspection→runtime generation 决策→状态发布；apply command 只在 StructureCommitted 前允许按摘要与引用保护回滚，并在 stop/uninstall 时清空 Manager 持有的唯一进程级 `CodexSnapshotStore`。Vue 设置页不在本批次实现。

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
    pub existed_before: bool,
    pub original_digest: Option<String>,
    pub target_digest: String,
    pub backup_path: Option<PathBuf>,
}

pub struct BridgeTransactionJournal {
    pub installed_path: PathBuf,
    pub install_record_path: PathBuf,
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

pub fn apply_prepared_config_change(
    paths: &CodexIntegrationPaths,
    prepared: &PreparedCodexHookChange,
    expected_digest: &str,
    preview_digest: &str,
    transaction_id: &str,
) -> Result<ConfigApplyTransaction, CodexIntegrationError>;

impl ConfigApplyTransaction {
    pub fn commit(self) -> Result<AppliedConfigChange, CodexIntegrationError>;
    pub fn rollback_if_unchanged(self) -> Result<(), CodexIntegrationError>;
}

pub fn recover_interrupted_codex_integration_transaction(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationRecoveryOutcome, CodexIntegrationError>;
```

Journal 禁止包含配置正文、Token、Hook 输入、用户命令、项目路径正文或 Bridge 二进制内容。`target_bridge_exists`/`target_record_exists` 支持 Uninstall 缺失目标；为 false 时对应 target digest 固定为 SHA-256(empty bytes)，存在性位区分缺失与零字节文件。`transaction_id` 固定为 16 个 CSPRNG 随机字节的小写 32 hex；Config/Bridge 句柄必须保存并测试同一个值。Journal 创建和每次阶段推进统一执行：同目录临时文件 → write → flush → close → 重新读取并反序列化完整 Journal → `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`。只有 `transaction.rs` 调用该写入器；writer/installer 不原地改 Journal。

阶段与恢复矩阵固定为：

- Prepared：在任何目标替换前写入，包含原配置/Bridge/记录摘要、备份与全部目标摘要。恢复时目标仍为原摘要才只清理 temp/backup/Journal并返回 CleanedPreparedTransaction；不改配置或 Bridge。
- BridgeApplied：Bridge/记录已替换、配置仍为事务前摘要。两者仍为目标摘要时恢复事务前 Bridge/记录并返回 RestoredBridgeApplied；用户/其他进程修改任一目标、配置不再为原摘要且也非事务目标、或当前 Hook 已引用新稳定 Bridge时返回 Conflict并保持诊断，禁止删除被引用 EXE。
- ConfigApplied：重新读取配置、Bridge与记录。三者均为事务目标且 post-write Inspection=Exact时推进 StructureCommitted、保留新结构并进入清理，返回 PromotedStructureCommitted。目标仍为事务写入字节但 Inspection非 Exact时，只有两侧都未外改才先回滚配置、确认配置不再引用新 Bridge、再回滚 Bridge/记录并返回 RolledBackConfigApplied。用户改任一目标时不覆盖用户字节、不删除仍可能被引用的 Bridge，返回 Conflict并保留备份。
- StructureCommitted：永远保留当前正确配置和 Bridge，只清理 backup/temp/Journal并返回 CleanedStructureCommitted；任何清理失败只返回 Warning，不回滚结构。

恢复不得盲信阶段：若 Prepared 的实际摘要已经是 Bridge目标，按 BridgeApplied 分支恢复；若 BridgeApplied 的配置已经是事务目标，按 ConfigApplied 分支恢复。这覆盖目标 MoveFileExW 成功但下一阶段 Journal 尚未持久化的崩溃窗口。既非原摘要也非目标摘要统一 Conflict。

- [ ] **步骤 1：先写摘要竞争、Journal 内容与备份失败测试**

  覆盖 expectedDigest 不符、previewDigest 不符、preview 后用户增加 handler、修改任一 Feature 键、改变企业约束、替换 Bridge 资源/副本/记录；每例断言不创建 temp/backup/Journal。修改已有文件前创建同目录时间戳备份，新建 Hook 文件 backup=None；备份字节等于写前原始字节。序列化 Journal 后断言只含允许元数据，不含配置正文、token、Hook stdin、用户 command、项目 cwd 或 Bridge bytes；路径精确为 `paths.integration_transaction_file`。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::concurrency -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::journal -- --nocapture
  Pop-Location
  ```

  预期：统一 Journal 和 writer 不存在，测试失败。

- [ ] **步骤 2：先写 Journal/配置同目录原子替换故障矩阵**

  通过 `AtomicIntegrationFs` 注入 Journal 与配置 temp create/write/flush/close/重读 parse/每一个 MoveFileExW 失败；逐项断言目标保持上一个已持久化阶段可恢复状态。每次成功阶段变化均捕获调用序列，精确等于 temp→write→flush→close→reread/parse→MoveFileExW。`apply_prepared_config_change()` 接收已有 transactionId且不得创建第二个日志。`rollback_if_unchanged()` 只在摘要仍等于事务 target 时恢复；用户再次修改时 Conflict并保留备份/诊断。两个内部 `commit()` 后不能 rollback，但也不能删除尚未 StructureCommitted 的 Journal。

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

  1. Prepared 后崩溃 → 下次启动只清理事务，配置和 Bridge/记录不变；
  2. BridgeApplied 后、Config 写入前崩溃 → 恢复旧 Bridge/记录，配置不变；
  3. ConfigApplied 后、post-write Inspection 前崩溃 → 下次启动重新执行 Exact 验证；
  4. ConfigApplied + 当前结构 Exact → 提升 StructureCommitted，保留新配置和 Bridge；
  5. ConfigApplied + Marker 非 Exact且配置/Bridge均未外改 → 先配置、后 Bridge双回滚；
  6. ConfigApplied 后用户修改配置 → 不覆盖用户字节、不删除仍被引用的 Bridge、返回 Conflict；
  7. StructureCommitted 后、清理前崩溃 → 只清理 backup/temp/Journal，不回滚结构；
  8. 首次 Install 在 BridgeApplied 崩溃 → 不留下孤立新 Bridge；
  9. Repair 在 BridgeApplied 崩溃 → 恢复 Repair 前 Bridge 与安装记录。

  另覆盖阶段落盘滞后与损坏 Journal：Prepared+Bridge目标摘要按 BridgeApplied恢复；BridgeApplied+Config目标摘要按 ConfigApplied验证；Journal损坏、摘要既非原也非目标都 Conflict且不覆盖。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests::recovery -- --nocapture
  Pop-Location
  ```

  预期：统一恢复函数不存在，测试失败。

- [ ] **步骤 4：实现统一 Journal、writer 与恢复矩阵**

  目标 temp 名固定 `.<filename>.codepulse-<16 hex>.tmp` 且 `create_new(true)`；配置写入后按 JSON/TOML 重新解析。`prepare_bridge_install()` 只能准备验证结果、目标摘要、备份和 temp，不得在 Prepared Journal 成功持久化前替换；`apply_prepared_config_change()` 不能另建日志。Bridge apply 后推进同一 Journal到 BridgeApplied，Config apply后推进 ConfigApplied，Exact+Bridge 契约通过后推进 StructureCommitted。Config/Bridge `commit()` 只消费进程内 handle并清理可清理资源；StructureCommitted 是唯一跨进程提交点。所有 unsafe 块添加中文安全前提，保证 UTF-16 缓冲区在调用期间存活、源目标同卷。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::transaction_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  Pop-Location
  ```

  预期：摘要、备份、原子序列、四阶段、九组崩溃恢复、阶段落盘滞后、Conflict 与 cleanup Warning 全部通过；成功路径无 BOM/temp/Journal残留。

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

`prepare_bridge_install()` 只验证资源、计算原/目标摘要、准备备份/temp与内部 handle，禁止替换 Bridge/记录；调用方先用相同 transactionId 持久化 Prepared Journal，再调用 `apply()`。`apply()` 替换 Bridge/记录后由统一 coordinator 推进同一 Journal到 BridgeApplied，installer 自己不得创建日志。内部备份不进入永久备份目录。`commit()` 只终结进程内资源；StructureCommitted 后清理失败返回 outcome warning，不回滚正确 Bridge。`rollback()` 在恢复/删除 Bridge 前检查当前 Hook 配置是否仍引用稳定路径；若 Config rollback 因用户并发修改而 conflict 且当前 marker 仍引用该路径，保留可执行 Bridge并返回稳定 conflict，禁止制造悬空 Hook。

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

  覆盖 prepare 阶段只产生摘要/备份/temp、未创建 Prepared Journal 时稳定 Bridge/记录绝不改变；Prepared 持久化后 apply 才执行首次同目录 temp+原子替换、写后 hash和安装记录。target_triple 安装记录只在完整 PE metadata 通过后生成、current 不重写、旧记录且副本等于旧 hash 才升级、副本 hash 与记录不符为 modified 且不自动覆盖、协议不匹配要求 Repair、资源错架构或 Console Subsystem 在创建 bin/temp 前失败、旧 target 目录 EXE 不被读取。Config/Bridge handle 的 transactionId 用 `assert_eq!` 固定相同，稳定路径只断言 paths 字段。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::install -- --nocapture
  Pop-Location
  ```

  预期：installer 尚未实现，测试失败。

- [ ] **步骤 3：先写进程自检与回滚失败测试**

  安装后用 `std::process::Command` 执行 `--codepulse-self-check`，显式 `stdin/stdout/stderr` piped，要求一秒内 stdout 精确 `{}`、stderr 空、exit 0；同时以 Hook 参数写入测试 JSON验证 GUI Subsystem 仍能读写管道。无法启动、超时或输出违约时恢复安装前二进制/记录，首次安装则删除新副本。文件占用替换重试固定 3 次、间隔 50ms，测试注入 sleeper 不真实等待。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::rollback -- --nocapture
  Pop-Location
  ```

  预期：self-check/rollback 测试失败。

- [ ] **步骤 4：实现 PE 校验和 installer**

  Rust 解析顺序与 PowerShell 完全一致：DOS Header ≥64 字节；MZ；0x3C 的 little-endian e_lfanew；边界；PE 签名；COFF Machine；COFF SizeOfOptionalHeader；PE32+ Magic=0x20B；Optional Header 足以读取偏移 68 的 Subsystem；Subsystem 必须为 `IMAGE_SUBSYSTEM_WINDOWS_GUI = 2`。installer 在准备目标材料前调用完整 metadata 验证，再校验 SHA-256 与 piped Bridge 启动契约；Prepared Journal 持久化前不得替换稳定路径。安装记录 UTF-8 without BOM 原子写并包含 target triple，但只在 metadata 全部通过后准备、在 `apply()` 内原子替换；rollback 不触碰 Hook 文件。

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
  3. 从 04A 标准 Fixture 准备 Config target，并 prepare BridgeInstallTransaction
  4. 验证 PE Machine/WindowsGui、hash 和 Bridge piped 启动契约
  5. 分配唯一 transactionId并持久化 Prepared Journal
  6. apply Bridge/安装记录，保留 rollback handle
  7. 把同一 Journal 推进 BridgeApplied
  8. Runtime 未启动时 ensure_started(InstallSelfCheck/RepairSelfCheck)
  9. 用同一 transactionId apply ConfigApplyTransaction，不创建第二个日志
  10. 把同一 Journal 推进 ConfigApplied
  11. 重新读取并完整解析 Hook 配置与 Bridge/记录
  12. 确认 CodePulse marker=Exact且 Bridge metadata/hash/启动契约正确
  13. 把同一 Journal 推进 StructureCommitted
  14. commit Config/Bridge 进程内 handle并清理
  15. 派生并发布 awaiting_trust 或 partial
  16. 运行完整 self-check
  17. 返回 inspection/listeningStatus/selfCheck
  ```

  失败矩阵必须覆盖：Prepared 前任一失败无目标替换；BridgeApplied 后失败按 Journal 恢复旧 Bridge/记录；ConfigApplied 后 post-write inspection 解析失败或 marker 非 Exact → 只有摘要均未外改才 `rollback_if_unchanged()` → 确认配置不再引用稳定路径 → Bridge rollback；配置写入后用户再次修改 → 禁止覆盖用户修改，若仍引用稳定路径则保留有效 Bridge并返回 Conflict，绝不制造悬空 Hook。首次 Install 验证失败 → 停止临时 Runtime → Store.clear/发布更高 revision 空快照 → owner-aware 删除 discovery。Repair 验证失败 → 恢复 Repair 前配置/Bridge且不停止原合法 Runtime、不清空原任务，除非 Runtime 本身已经失败。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::install_repair -- --nocapture
  Pop-Location
  ```

  预期：事务顺序/回滚测试失败。

- [ ] **步骤 3：先写结构提交、自检失败与 Uninstall 测试**

  先覆盖结构提交边界：post-write inspection 已确认 marker=Exact 且 Bridge metadata/hash/启动契约正确 → Journal 推进 StructureCommitted → Config/Bridge 进程内 commit。之后完整 self-check 超时、ServiceListening/EventQueueOpen 等失败时，Hook 保留、Bridge 保留、不恢复旧配置；result.selfCheck 带 fail/warning，listeningStatus 派生为 partial 或 service_error，绝不误报 running。StructureCommitted 后仅清理 backup/temp/Journal失败时，功能结构保留，warning 合并进对应 self-check item，后续 startup recovery只清理。

  Uninstall 也使用同一 Journal，但为避免 Hook 指向缺失 EXE，动作顺序固定为：重新静态 inspect/摘要 → 分配 transactionId并持久化 Prepared（config 目标为 marker absent，Bridge/记录目标为 absent）→ Config transaction 精确移除 marker → Journal 推进 ConfigApplied → post-write inspection 验证 marker absent并确认当前配置不再引用稳定 Bridge → stop_if_unused(Uninstalled)，内部停止接收、关闭旧 Actor/HTTP、owner-aware 删除 discovery、Store.clear并发布更高 revision 空快照、发布 listening phase=not_installed → 删除 installed_bridge/install_record → 验证两者 absent → Journal 推进 StructureCommitted → 进程内 commit/清理。Uninstall 不经过 BridgeApplied，因为删除 Bridge 必须晚于配置引用删除；恢复依据 Journal.action=Uninstall 走该固定分支：ConfigApplied 且 marker 已 absent时只在确认无引用后继续/重试 Bridge 删除，配置被用户修改或再次引用时 Conflict且保留 Bridge。存在运行中任务时必须观察到空快照先于 not_installed；Bridge 删除失败返回 warning并保留 ConfigApplied Journal供下次恢复，但不得恢复 Hook、重启 runtime 或还原整份旧备份；用户其他 Hook 深度相等。local hooks=false 的 uninstall 也走此路径，但不得先启动 Runtime或安装 Bridge。

  再覆盖安装生命周期：安装完成且 generation=1 收到真实事件 → running；确认卸载 → generation=None/authenticatedGeneration=None/更高 revision 空快照/not_installed；重新安装 → generation=2、authenticatedGeneration=None、awaiting_trust，绝不能沿用 generation=1 直接 running；generation=1 晚到 reporter 忽略；generation=2 第一条真实事件后才 running。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::uninstall -- --nocapture
  Pop-Location
  ```

  预期：卸载生命周期测试失败。

- [ ] **步骤 4：实现串行 apply 与三个 Tauri 命令**

  manager 内 integration operation mutex 保证 apply 串行；inspect/preview 可并发读。apply 在锁内重新计算 expectedDigest 和 previewDigest，任一变化停止。Install/Repair 精确按步骤 1–17 执行，以持久化 StructureCommitted 为跨进程结构提交点；self-check 位于该阶段和两个进程内 commit 之后。rollback 始终遵守当前摘要/Bridge 引用保护。Install/Repair 的目标 CodePulse 组必须由 04A 标准 Fixture loader 产生，Commands 不手写事件列表。Uninstall 支持 local disabled 安全 marker且不启动 Runtime。阻塞文件 I/O 放入 `tauri::async_runtime::spawn_blocking`；每次返回静态 inspection、单独派生的完整 listeningStatus 与 selfCheck，错误对 UI 只返回稳定码/中文短句，不含 token、配置正文或完整路径正文。

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

- `paths.integration_transaction_file` 是唯一 Journal；Writer/Installer 不拼接路径、不创建第二日志，Config/Bridge handle 共享 transactionId，Journal 不含正文、Token、Hook 输入、用户命令、项目路径正文或 Bridge bytes。
- Prepared、BridgeApplied、ConfigApplied、StructureCommitted 的 Journal/阶段推进均走 temp→write→flush→close→重读解析→MoveFileExW；九组固定崩溃恢复、阶段落盘滞后、用户并发修改与损坏 Journal 测试通过。
- writer 返回 `ConfigApplyTransaction`，通过摘要、防并发、备份、同目录 temp、重新解析、原子替换与 `rollback_if_unchanged`；两个内部 commit 只终结进程内资源，StructureCommitted 是跨进程提交点。
- Bridge 资源与稳定副本都验证 PE 签名/Machine/Optional Header/WindowsGui；x64/ARM64 反配、Console Subsystem、不支持 triple 和旧 target 误复制被拒绝；piped Bridge 契约通过。
- startup 严格构造唯一 Store并注入 Manager→恢复 Integration Transaction→静态 inspection→decision→generation runtime→独立 listening status；`Arc::ptr_eq`/单次构造通过，modified 启动但不自动覆盖，Feature alias conflict停止，旧 generation 上报不影响新 Runtime。
- local disabled 的 install/repair 不写配置/Bridge、不启动 HTTP；安全 marker uninstall 允许且不启动 Runtime；managed disabled 与 ambiguous conflict 全部只读。
- Install/Repair 按固定 17 步执行；ConfigApplied 非 Exact时按摘要/引用保护双回滚且不悬空；StructureCommitted 后 self-check 失败保留 Hook/Bridge并返回 partial/service_error；cleanup 失败只 warning。Uninstall 使用同一 Journal且先删除引用、后删除 Bridge。
- 首次 Install 失败停止临时 Runtime、发布更高 revision 空快照并 owner-aware 删除 discovery；Repair 失败保持原合法链路；Uninstall 先发布空快照再 not_installed，最后删 Bridge。
- SnapshotStore 跨 stop/start 保持 revision；每个 Runtime 使用新 generation 和完整 DiscoveryOwner；RunEvent/stop 不误删新 Runtime 文件。
- inspect/preview/apply 注册，`CodexHookChangeResult` 同时返回静态 inspection、独立 listeningStatus 与 selfCheck，错误不泄密；无 Vue 设置页。
- 全部通过后停止，未经 review 不得执行 04C。
