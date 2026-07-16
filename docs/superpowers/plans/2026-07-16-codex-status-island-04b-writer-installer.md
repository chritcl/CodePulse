# 阶段四 B：Writer、Bridge Installer 与 Tauri Commands 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 04A 只读 inspection/planner 已审核通过后，实现并发安全的配置事务、目标架构正确的 Bridge 稳定安装、Tauri inspect/preview/apply 命令，以及由 startup inspection/install/uninstall 驱动的 HTTP/Actor 生命周期。

**架构：** writer 只应用 `PreparedCodexHookChange` 并返回可 commit/rollback 的 `ConfigApplyTransaction`，以 `expectedDigest`/`previewDigest` 和目标摘要防止覆盖并发修改；installer 在任何配置引用前验证完整 PE metadata 与 GUI Bridge 管道契约并返回 `BridgeInstallTransaction`；startup orchestrator 严格执行恢复→静态 inspection→runtime generation 决策→状态发布；apply command 串行组织两个事务，以 post-write marker exact 为结构提交点，并在 stop/uninstall 时清空进程级 `CodexSnapshotStore`。Vue 设置页不在本批次实现。

**技术栈：** Rust、sha2、Windows `MoveFileExW`、Tauri 2.11.5 async runtime、Tokio、阶段一 PE/路径契约与阶段二 Runtime Manager；不新增前端依赖。

## 全局约束

- 前置门禁：04A 全部通过并已单独 review。
- writer、installer、runtime、self-check 与 commands 只消费同一个 `CodexIntegrationPaths`。
- `features.hooks=false` 的 install/repair 在进入 installer/runtime/writer 前返回 HooksDisabled；有安全 marker 的 uninstall 允许进入 writer，但不安装 Bridge、不启动 HTTP。managed disabled 三种 action 全部零写入。
- runtime startup 只由 04A decision 或 install/repair self-check 启动；idlePersistent 没有调用路径。
- modified 允许服务启动但禁止后台覆盖配置；只有显式 Repair preview/apply 可修改。
- 卸载先移除并验证 marker，再停服务并发布更高 revision 空快照，最后删 Bridge；删除 EXE 失败不恢复 Hook。
- 每个新 Runtime generation 清空认证事实；旧 generation reporter/关闭回调不得更新新 Runtime。
- Discovery 的 stop/exit/drop 清理只使用完整 `DiscoveryOwner`；不允许只比 PID 或 startedAt。
- 本计划完成后停止等待 review，不自动进入 04C。

---

## 任务 1：实现摘要防并发、备份、原子写入与崩溃恢复

**独立交付物：** 只有 inspection 输入和 preview 均未变化时才写盘；任一故障点不会留下半文件；启动可安全恢复当前未完成事务。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/writer.rs`
- Create: `src-tauri/src/codex/integration/writer_tests.rs`

**消费接口：** 04A `PreparedCodexHookChange`、`expectedDigest`、`previewDigest`、`CodexIntegrationPaths.transaction_file`。

**产生接口：**

```rust
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
) -> Result<ConfigApplyTransaction, CodexIntegrationError>;

impl ConfigApplyTransaction {
    pub fn commit(self) -> Result<AppliedConfigChange, CodexIntegrationError>;
    pub fn rollback_if_unchanged(self) -> Result<(), CodexIntegrationError>;
}

pub fn recover_interrupted_config_transaction(
    paths: &CodexIntegrationPaths,
) -> Result<(), CodexIntegrationError>;
```

`apply_prepared_config_change()` 完成摘要复核、备份、temp 校验与目标原子替换后仍不清理回滚材料，而是返回持有“写入前摘要、事务写入摘要、备份、事务日志”的 handle。`commit()` 标记结构提交并清理临时回滚材料；只有清理失败时返回 `AppliedConfigChange.warnings`，不能把已正确写入的功能结构回滚成失败。`rollback_if_unchanged()` 只有在当前目标摘要仍等于本事务写入摘要时恢复；用户再次修改时返回稳定 conflict、保留用户字节、备份和诊断事务，不恢复整份旧文件。

- [ ] **步骤 1：先写摘要竞争与备份失败测试**

  覆盖 expectedDigest 不符、previewDigest 不符、preview 后用户增加 handler、修改 feature、改变企业约束、替换 Bridge 资源/副本/记录；每例断言不创建 temp/backup/transaction。修改已有文件前创建同目录时间戳备份，新建 Hook 文件 backup=None；备份字节必须等于写前原始字节。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::concurrency -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::writer_tests::backup -- --nocapture
  Pop-Location
  ```

  预期：writer 不存在，测试失败。

- [ ] **步骤 2：先写同目录原子替换故障矩阵**

  通过 `AtomicConfigFs` 注入事务日志写失败、temp create/write/flush/重读 parse 失败、每一个 MoveFileEx 失败。每例断言未替换文件保持原摘要；成功替换后函数返回未提交 `ConfigApplyTransaction`。`rollback_if_unchanged()` 在摘要仍等于事务 target 时恢复；配置写入后用户再次修改时禁止覆盖用户新修改、返回稳定 conflict，并保留备份/事务诊断。`commit()` 后不得再 rollback；commit 的 backup/temp/事务日志清理失败返回 warning，当前正确配置保持不变。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::atomic -- --nocapture
  Pop-Location
  ```

  预期：故障注入测试失败。

- [ ] **步骤 3：先写事务恢复失败测试**

  模拟进程在第一项替换后、Config commit 前、Config commit 后清理未完成三处崩溃。事务文件固定为 `paths.transaction_file`，内容只含 path、原/目标摘要、本事务 backup path 与 committed 标志，不含配置正文。恢复覆盖未提交且 target 未变可恢复、用户已再修改则 conflict且不覆盖、事务文件损坏则 conflict、已 committed 则只清理日志并返回 warning。虽然首版 planner 只产生一个 Hook 文件，writer 测试仍保留多文件原子恢复能力，不用于开启 Hooks feature。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::recovery -- --nocapture
  Pop-Location
  ```

  预期：恢复函数不存在，测试失败。

- [ ] **步骤 4：实现 writer 与事务恢复**

  temp 名固定 `.<filename>.codepulse-<16 hex>.tmp` 且 `create_new(true)`；写入、flush、关闭后按 JSON/TOML 重新解析；事务文件自身通过同目录 temp 原子替换；目标文件通过 `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` 替换。handle 的 commit/rollback 消费 self，禁止二次终结。所有 unsafe 块添加中文安全前提，保证 UTF-16 缓冲区在调用期间存活、源目标同卷。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  Pop-Location
  ```

  预期：并发、备份、`rollback_if_unchanged`、commit warning、故障注入、恢复和成功路径全部通过；成功 cleanup 无 BOM/temp/事务残留，warning 路径保留可恢复诊断。

- [ ] **步骤 5：提交 writer**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n 'join\("CodePulse"\)|join\("runtime"\)|join\("bin"\)' src-tauri/src/codex/integration/writer.rs
  git diff --check
  ```

  预期：路径拼接无命中；所有检查通过。

  建议提交信息：

  ```text
  安全写入并恢复 Codex Hook 配置事务
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
) -> Result<BridgeInstallTransaction, CodexIntegrationError>;

impl BridgeInstallTransaction {
    pub fn commit(self) -> Result<BridgeInstallOutcome, CodexIntegrationError>;
    pub fn rollback(self) -> Result<(), CodexIntegrationError>;
}
```

内部备份不进入永久备份目录。`commit()` 的备份/temp 清理失败返回 outcome warning，不回滚正确 Bridge。`rollback()` 在恢复/删除 Bridge 前检查当前 Hook 配置是否仍引用稳定路径；若 Config rollback 因用户并发修改而 conflict 且当前 marker 仍引用该路径，保留可执行 Bridge并返回稳定 conflict，禁止制造悬空 Hook。

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

  覆盖首次同目录 temp+原子替换、写后 hash、target_triple 安装记录只在完整 PE metadata 通过后生成、current 不重写、旧记录且副本等于旧 hash 才升级、副本 hash 与记录不符为 modified 且不自动覆盖、协议不匹配要求 Repair、资源错架构或 Console Subsystem 在创建 bin/temp 前失败、旧 target 目录 EXE 不被读取。稳定路径只断言 paths 字段。

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

  Rust 解析顺序与 PowerShell 完全一致：DOS Header ≥64 字节；MZ；0x3C 的 little-endian e_lfanew；边界；PE 签名；COFF Machine；COFF SizeOfOptionalHeader；PE32+ Magic=0x20B；Optional Header 足以读取偏移 68 的 Subsystem；Subsystem 必须为 `IMAGE_SUBSYSTEM_WINDOWS_GUI = 2`。installer 在创建目标目录或替换前调用完整 metadata 验证，再校验 SHA-256 与 piped Bridge 启动契约。安装记录 UTF-8 without BOM 原子写并包含 target triple，但只在 metadata 全部通过后生成；rollback 不触碰 Hook 文件。

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

  fake journal/inspection/runtime/store/publisher 断言精确调用顺序：构造 paths 与进程级 Store 已完成 → recover → 静态 inspect → decision → ensure_started 或 stop_if_unused → 若 disallow 则 Store.clear/发布空快照 → 由 inspection+runtime facts 派生并发布 listening status。recover conflict 必须 stop_if_unused(StartupInspectionDisallows)，按停止顺序清空旧任务并发布 config_conflict 且不 start；inspection 读失败发布 config_conflict/service_error 的稳定码但不阻止音乐、托盘、窗口初始化。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::startup_tests::order -- --nocapture
  Pop-Location
  ```

  预期：startup orchestrator 不存在，测试失败。

- [ ] **步骤 2：先写 runtime 条件矩阵失败测试**

  exact、modified、可安全 marker present 分别调用一次 ensure_started(StartupInspection)；not_installed、disabled、managed disabled、任意 config_conflict/ambiguous、确认卸载调用 stop_if_unused(StartupInspectionDisallows)。modified 发布 partial 且不调用 writer。无法安全识别 marker 的 conflict 不得启动。idlePersistent true/false 不进入输入。重复 initialize 在 Runtime 已运行时幂等，不创建第二 listener/Actor/generation。

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

  `initialize_app()` 只 spawn orchestrator，不直接 start HTTP。orchestrator 从 manager 取得同一个 paths 与 SnapshotStore，恢复事务后取得静态 inspection，再调用 04A decision 和 manager；成功/失败均使用 `derive_codex_listening_status()` 发布完整 CodexListeningStatus，绝不把动态 phase 写回 inspection。modified 只启动接收链路，不自动修复。stop 使用 handle 的完整 Owner；runtime 目录探针只在 paths.runtime_dir 内创建/rename/delete临时文件，不递归删除、不放宽 ACL、不跟随 reparse point。

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

  固定序列：inspection hooksFeature=disabled + marker absent → preview install 返回 HooksDisabled → prepared plan 不存在 → Bridge installer、writer、ensure_started 计数均为 0 → 路径快照不变；disabled + marker present + repair 同样 HooksDisabled。disabled + 安全 marker exact/modified/duplicate + uninstall → preview/apply 成功，Bridge installer 与 ensure_started 计数为 0，writer 只删除 CodePulse marker，其他 Hook 深度相等，再清理稳定 Bridge/记录。用户手动把 hooks 改为 true 并重新 inspect 后 install/repair preview 才成功。managed disabled 与 config conflict/ambiguous 不提供任何 apply 路径。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::disabled -- --nocapture
  Pop-Location
  ```

  预期：若 command 先安装 Bridge 或启动 HTTP，测试失败。

- [ ] **步骤 2：先写 Install/Repair 双事务顺序与 post-write 失败测试**

  顺序必须逐项记录并断言：

  ```text
  1. 重新静态 inspection
  2. 重新计算 expectedDigest/previewDigest
  3. prepare BridgeInstallTransaction
  4. 验证 PE Machine/WindowsGui、hash 和 Bridge piped 启动契约
  5. 暂时安装 Bridge，保留 rollback handle
  6. Runtime 未启动时 ensure_started(InstallSelfCheck/RepairSelfCheck)
  7. apply ConfigApplyTransaction
  8. 重新读取并完整解析 Hook 配置
  9. 确认 CodePulse marker=exact
  10. commit ConfigApplyTransaction
  11. commit BridgeInstallTransaction
  12. 派生并发布 awaiting_trust 或 partial
  13. 运行完整 self-check
  14. 返回 inspection/listeningStatus/selfCheck
  ```

  失败矩阵必须覆盖：Bridge 安装成功、writer 成功但 post-write inspection 解析失败或 marker 非 exact → `rollback_if_unchanged()` → Bridge rollback → 不留下 Hook 指向不存在 Bridge；配置写入后用户再次修改 → rollback 禁止覆盖用户修改，Bridge rollback 必须检查当前配置引用，若仍引用稳定路径则保留有效 Bridge并返回 conflict，绝不制造悬空 Hook。首次 Install 验证失败 → 停止临时 Runtime → Store.clear/发布更高 revision 空快照 → owner-aware 删除 discovery。Repair 验证失败 → 恢复 Repair 前配置/Bridge且不停止原合法 Runtime、不清空原任务，除非 Runtime 本身已经失败。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::install_repair -- --nocapture
  Pop-Location
  ```

  预期：事务顺序/回滚测试失败。

- [ ] **步骤 3：先写结构提交、自检失败与 Uninstall 测试**

  先覆盖结构提交边界：post-write inspection 已确认 marker=exact 且 Bridge metadata/hash/启动契约正确 → Config commit → Bridge commit。之后完整 self-check 超时、ServiceListening/EventQueueOpen 等失败时，Hook 保留、Bridge 保留、不恢复旧配置；result.selfCheck 带 fail/warning，listeningStatus 派生为 partial 或 service_error，绝不误报 running。Config/Bridge commit 后仅清理 backup/temp/事务日志失败时，功能结构保留，warning 合并进对应 self-check item，后续 startup recovery 清理。

  Uninstall 顺序固定：重新静态 inspect/摘要 → Config transaction 精确移除 marker → post-write inspection 验证 marker absent → commit Config → stop_if_unused(Uninstalled)，内部停止接收、关闭旧 Actor/HTTP、owner-aware 删除 discovery、Store.clear并发布更高 revision 空快照、发布 listening phase=not_installed → 删除 installed_bridge/install_record。存在运行中任务时必须观察到空快照先于 not_installed；Bridge 删除失败返回 warning，但不得恢复 Hook、重启 runtime 或还原整份旧备份；用户其他 Hook 深度相等。local hooks=false 的 uninstall 也走此路径，但不得先启动 Runtime或安装 Bridge。

  再覆盖安装生命周期：安装完成且 generation=1 收到真实事件 → running；确认卸载 → generation=None/authenticatedGeneration=None/更高 revision 空快照/not_installed；重新安装 → generation=2、authenticatedGeneration=None、awaiting_trust，绝不能沿用 generation=1 直接 running；generation=1 晚到 reporter 忽略；generation=2 第一条真实事件后才 running。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::uninstall -- --nocapture
  Pop-Location
  ```

  预期：卸载生命周期测试失败。

- [ ] **步骤 4：实现串行 apply 与三个 Tauri 命令**

  manager 内 integration operation mutex 保证 apply 串行；inspect/preview 可并发读。apply 在锁内重新计算 expectedDigest 和 previewDigest，任一变化停止。Install/Repair 精确按步骤 1–14 执行，以 marker exact 为结构提交点；self-check 位于两个 commit 之后。rollback 始终遵守当前摘要/Bridge 引用保护。Uninstall 支持 local disabled 安全 marker且不启动 Runtime。阻塞文件 I/O 放入 `tauri::async_runtime::spawn_blocking`；每次返回静态 inspection、单独派生的完整 listeningStatus 与 selfCheck，错误对 UI 只返回稳定码/中文短句，不含 token、配置正文或完整路径正文。

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

- writer 返回 `ConfigApplyTransaction`，通过摘要、防并发、备份、同目录 temp、重新解析、原子替换、`rollback_if_unchanged`、commit cleanup warning 和崩溃恢复测试。
- Bridge 资源与稳定副本都验证 PE 签名/Machine/Optional Header/WindowsGui；x64/ARM64 反配、Console Subsystem、不支持 triple 和旧 target 误复制被拒绝；piped Bridge 契约通过。
- startup 严格恢复→静态 inspection→decision→generation runtime→独立 listening status；modified 启动但不自动覆盖；旧 generation 上报不影响新 Runtime。
- local disabled 的 install/repair 不写配置/Bridge、不启动 HTTP；安全 marker uninstall 允许且不启动 Runtime；managed disabled 与 ambiguous conflict 全部只读。
- Install/Repair 按固定 14 步执行；post-write 非 exact 双事务回滚且不悬空；exact 后 self-check 失败保留 Hook/Bridge并返回 partial/service_error；commit cleanup 失败只 warning。
- 首次 Install 失败停止临时 Runtime、发布更高 revision 空快照并 owner-aware 删除 discovery；Repair 失败保持原合法链路；Uninstall 先发布空快照再 not_installed，最后删 Bridge。
- SnapshotStore 跨 stop/start 保持 revision；每个 Runtime 使用新 generation 和完整 DiscoveryOwner；RunEvent/stop 不误删新 Runtime 文件。
- inspect/preview/apply 注册，`CodexHookChangeResult` 同时返回静态 inspection、独立 listeningStatus 与 selfCheck，错误不泄密；无 Vue 设置页。
- 全部通过后停止，未经 review 不得执行 04C。
