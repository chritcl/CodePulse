# 阶段四 B：Writer、Bridge Installer 与 Tauri Commands 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 04A 只读 inspection/planner 已审核通过后，实现并发安全的配置事务、目标架构正确的 Bridge 稳定安装、Tauri inspect/preview/apply 命令，以及由 startup inspection/install/uninstall 驱动的 HTTP/Actor 生命周期。

**架构：** writer 只应用 `PreparedCodexHookChange` 并以 `expectedDigest`/`previewDigest` 防止覆盖并发修改；installer 在任何配置引用前校验并安装 Bridge；startup orchestrator 严格执行恢复→inspection→runtime 决策→状态发布；apply command 串行组织 Bridge、配置、self-check 与回滚。Vue 设置页不在本批次实现。

**技术栈：** Rust、sha2、Windows `MoveFileExW`、Tauri 2.11.5 async runtime、Tokio、阶段一 PE/路径契约与阶段二 Runtime Manager；不新增前端依赖。

## 全局约束

- 前置门禁：04A 全部通过并已单独 review。
- writer、installer、runtime、self-check 与 commands 只消费同一个 `CodexIntegrationPaths`。
- `features.hooks=false` 与 managed disabled 在进入 installer/runtime/writer 前即返回；零文件写入、零 Bridge 写入、零 HTTP 启动。
- runtime startup 只由 04A decision 或 install/repair self-check 启动；idlePersistent 没有调用路径。
- modified 允许服务启动但禁止后台覆盖配置；只有显式 Repair preview/apply 可修改。
- 卸载先移除并验证 marker，再停服务，最后删 Bridge；删除 EXE 失败不恢复 Hook。
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
}

pub fn apply_prepared_config_change(
    paths: &CodexIntegrationPaths,
    prepared: &PreparedCodexHookChange,
    expected_digest: &str,
    preview_digest: &str,
) -> Result<AppliedConfigChange, CodexIntegrationError>;

pub fn recover_interrupted_config_transaction(
    paths: &CodexIntegrationPaths,
) -> Result<(), CodexIntegrationError>;
```

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

  通过 `AtomicConfigFs` 注入事务日志写失败、temp create/write/flush/重读 parse 失败、每一个 MoveFileEx 失败。每例断言未替换文件保持原摘要；已替换文件只在当前摘要仍等于本事务 target 时回滚；用户再次修改时不覆盖并返回 conflict；temp 清理，备份可留审计。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::atomic -- --nocapture
  Pop-Location
  ```

  预期：故障注入测试失败。

- [ ] **步骤 3：先写事务恢复失败测试**

  模拟进程在第一项替换后崩溃，事务文件固定为 `paths.transaction_file`，内容只含 path、原/目标摘要和本事务 backup path，不含配置正文。恢复覆盖 target 未变可恢复、用户已再修改则 conflict、事务文件损坏则 conflict、事务已完成则只清理日志。虽然首版 planner 只产生一个 Hook 文件，writer 测试仍保留多文件原子恢复能力，不用于开启 Hooks feature。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::recovery -- --nocapture
  Pop-Location
  ```

  预期：恢复函数不存在，测试失败。

- [ ] **步骤 4：实现 writer 与事务恢复**

  temp 名固定 `.<filename>.codepulse-<16 hex>.tmp` 且 `create_new(true)`；写入、flush、关闭后按 JSON/TOML 重新解析；事务文件自身通过同目录 temp 原子替换；目标文件通过 `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` 替换。所有 unsafe 块添加中文安全前提，保证 UTF-16 缓冲区在调用期间存活、源目标同卷。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  Pop-Location
  ```

  预期：并发、备份、故障注入、恢复和成功路径全部通过，无 BOM/temp/事务残留。

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

**独立交付物：** installer 只接受与编译 target 一致的合法 PE，支持首次安装、升级、篡改保护、自检与回滚。

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

pub fn expected_pe_machine(
    target_triple: &str,
) -> Result<WindowsPeMachine, CodexIntegrationError>;

pub fn read_pe_machine(
    path: &Path,
) -> Result<WindowsPeMachine, CodexIntegrationError>;

pub fn verify_bridge_pe_architecture(
    path: &Path,
    target_triple: &str,
) -> Result<(), CodexIntegrationError>;

pub struct BridgeInstallTransaction;

pub fn prepare_bridge_install(
    paths: &CodexIntegrationPaths,
    target_triple: &str,
    action: BridgeAction,
) -> Result<BridgeInstallTransaction, CodexIntegrationError>;
```

`BridgeInstallTransaction` 必须提供 `commit(self)` 和 `rollback(self)`；内部备份不进入永久备份目录。

- [ ] **步骤 1：先写 PE/COFF 解析失败矩阵**

  fixture 覆盖空文件、只有 MZ、e_lfanew 越界、无 `PE\0\0`、未知 Machine、x64 target+ARM64 EXE、ARM64 target+x64 EXE、不支持 triple；正例覆盖 `0x8664`/x64 与 `0xAA64`/ARM64。每例同时与 Plan 01 PowerShell 验证脚本的期望码对齐。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::pe_tests -- --nocapture
  Pop-Location
  ```

  预期：旧 MZ-only 校验不能通过新增测试。

- [ ] **步骤 2：先写 installer 安装/升级/篡改失败测试**

  覆盖首次同目录 temp+原子替换、写后 hash、target_triple 安装记录、current 不重写、旧记录且副本等于旧 hash 才升级、副本 hash 与记录不符为 modified 且不自动覆盖、协议不匹配要求 Repair、资源错架构在创建 bin/temp 前失败、旧 target 目录 EXE 不被读取。稳定路径只断言 paths 字段。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::install -- --nocapture
  Pop-Location
  ```

  预期：installer 尚未实现，测试失败。

- [ ] **步骤 3：先写进程自检与回滚失败测试**

  安装后执行 `--codepulse-self-check`，要求一秒内 stdout 精确 `{}`、stderr 空、exit 0；无法启动、超时或输出违约时恢复安装前二进制/记录，首次安装则删除新副本。文件占用替换重试固定 3 次、间隔 50ms，测试注入 sleeper 不真实等待。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests::rollback -- --nocapture
  Pop-Location
  ```

  预期：self-check/rollback 测试失败。

- [ ] **步骤 4：实现 PE 校验和 installer**

  Rust 解析顺序与 PowerShell 完全一致：DOS Header ≥64 字节；MZ；0x3C 的 little-endian e_lfanew；边界；PE 签名；COFF Machine。installer 在创建目标目录或替换前调用 PE 验证，再校验 SHA-256。安装记录 UTF-8 without BOM 原子写，包含 target triple；rollback 不触碰 Hook 文件。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::pe_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::installer_tests -- --nocapture
  Pop-Location
  ```

  预期：PE 失败矩阵、安装、升级、篡改、自检和回滚全部通过。

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

**独立交付物：** 应用启动严格遵循固定五步顺序；只有合法/可识别 Hook 才常驻，卸载/不允许状态会停止并删除发现文件。

**Files:**

- Modify: `src-tauri/src/codex/service.rs`
- Modify: `src-tauri/src/codex/service_tests.rs`
- Create: `src-tauri/src/codex/integration/startup.rs`
- Create: `src-tauri/src/codex/integration/startup_tests.rs`
- Modify: `src-tauri/src/codex/commands.rs`（扩展 self-check 三项，不复制命令）
- Modify: `src-tauri/src/lib.rs`（在 manager manage 后启动 integration startup orchestrator）

**消费接口：** 04A `derive_startup_runtime_decision()`、任务 1 recovery、任务 2 PE/installer、阶段二 manager start/stop 与 listening store。

**产生接口：**

```rust
pub async fn initialize_codex_integration(
    runtime: CodexRuntimeManager,
) -> Result<CodexIntegrationInspection, CodexIntegrationError>;
```

- [ ] **步骤 1：先写启动顺序失败测试**

  fake journal/inspection/runtime/publisher 断言精确调用顺序：构造 paths 已完成 → recover → inspect → decision → ensure_started 或 stop_if_unused → publish status。recover conflict 必须直接发布 config_conflict 且不 start；inspection 读失败发布 config_conflict/service_error 的稳定码但不阻止音乐、托盘、窗口初始化。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::startup_tests::order -- --nocapture
  Pop-Location
  ```

  预期：startup orchestrator 不存在，测试失败。

- [ ] **步骤 2：先写 runtime 条件矩阵失败测试**

  exact、modified、partial+marker present 分别调用一次 ensure_started(StartupInspection)；not_installed、disabled、managed disabled、任意 config_conflict、确认卸载调用 stop_if_unused(StartupInspectionDisallows)。modified 发布 partial 且不调用 writer。无法安全识别 marker 的 conflict 不得启动。idlePersistent true/false 不进入输入。重复 initialize 幂等，不创建第二 listener/Actor。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::startup_tests::runtime -- --nocapture
  Pop-Location
  ```

  预期：runtime 条件测试失败。

- [ ] **步骤 3：先写扩展 self-check 失败测试**

  在阶段二三项上增加 BridgeResourcePresent、BridgeInstalled、HookConfigValid；资源项验证可读、SHA-256、PE Machine；稳定副本验证 hash/target/self-check；Hook 验证完整解析/marker。模拟 self-check 不能把 awaiting_trust 改为 running；只有 Actor 的真实 authenticated event 可以。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::startup_tests::self_check -- --nocapture
  Pop-Location
  ```

  预期：扩展检查不存在，测试失败。

- [ ] **步骤 4：实现 startup orchestrator**

  `initialize_app()` 只 spawn orchestrator，不直接 start HTTP。orchestrator 从 manager 取得同一个 paths，恢复事务后 inspect，再调用 04A decision 和 manager；成功/失败均发布完整 CodexListeningStatus。modified 只启动接收链路，不自动修复。runtime 目录探针只在 paths.runtime_dir 内创建/rename/delete临时文件，不递归删除、不放宽 ACL、不跟随 reparse point。

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

- [ ] **步骤 1：先写 HooksDisabled 零副作用命令测试**

  固定序列：inspection hooksFeature=disabled → preview install 返回 HooksDisabled → prepared plan 不存在 → Bridge installer、writer、ensure_started 计数均为 0 → 路径快照不变。用户手动把 hooks 改为 true 并重新 inspect 后 preview 才成功。managed disabled 不提供任何 apply 路径。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::disabled -- --nocapture
  Pop-Location
  ```

  预期：若 command 先安装 Bridge 或启动 HTTP，测试失败。

- [ ] **步骤 2：先写 Install/Repair 顺序与失败回滚测试**

  顺序固定：重新 inspect/摘要 → prepare+verify 并事务性安装 Bridge（保留回滚句柄）→ runtime 未启动则 ensure_started(InstallSelfCheck/RepairSelfCheck) → writer → 再 inspection → self-check → commit Bridge 安装事务 → 发布 awaiting_trust。writer 失败回滚 Bridge；此前没有 exact/modified/partial marker 时 stop_if_unused(InstallFailed) 并删除发现文件；已有合法 Hook 的 Repair 失败不得停止原有接收链路。成功保持服务运行，模拟 self-check 不进入 running。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::install_repair -- --nocapture
  Pop-Location
  ```

  预期：事务顺序/回滚测试失败。

- [ ] **步骤 3：先写 Uninstall 顺序和删除警告测试**

  顺序固定：重新 inspect/摘要 → writer 精确移除 marker → inspection 验证 marker absent → stop_if_unused(Uninstalled) → Actor/HTTP 关闭并删除 discovery → 删除 installed_bridge/install_record。Bridge 删除失败返回 warning，但不得恢复 Hook、重启 runtime 或还原整份旧备份；用户其他 Hook 深度相等。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests::uninstall -- --nocapture
  Pop-Location
  ```

  预期：卸载生命周期测试失败。

- [ ] **步骤 4：实现串行 apply 与三个 Tauri 命令**

  manager 内 integration operation mutex 保证 apply 串行；inspect/preview 可并发读。apply 在锁内重新计算 expectedDigest 和 previewDigest，任一变化停止。阻塞文件 I/O 放入 `tauri::async_runtime::spawn_blocking`；错误对 UI 只返回稳定码/中文短句，不含 token、配置正文或完整路径正文。

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

- writer 通过摘要、防并发、备份、同目录 temp、重新解析、原子替换和崩溃恢复测试。
- Bridge 资源与稳定副本都验证 PE 签名/Machine；x64/ARM64 反配、不支持 triple 和旧 target 误复制被拒绝。
- startup 严格恢复→inspection→decision→runtime→status；modified 启动但不自动覆盖。
- HooksDisabled 不写配置/Bridge、不启动 HTTP；手动启用并重新 inspection 后才允许 preview/apply。
- Install/Repair 临时启动、自检、awaiting_trust 和失败回滚确定；Uninstall 停服务/删 discovery 后才删 Bridge，不恢复 Hook。
- inspect/preview/apply 注册且错误不泄密；无 Vue 设置页。
- 全部通过后停止，未经 review 不得执行 04C。
