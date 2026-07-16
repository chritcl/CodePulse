# 阶段四：Hook 配置、Bridge 安装升级、设置页与端到端验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在用户确认预览后安全安装、修复或卸载 CodePulse Hook 与 Bridge 稳定副本，展示真实监听状态和显示偏好，并完成自动化与 Windows 原生 App/CLI 端到端门禁。

**架构：** Rust integration 层先只读检查 Codex Home、用户配置、企业约束和 Bridge 哈希；纯 plan 层生成确定性变更及摘要；writer 用输入组合摘要、预览摘要、逐文件备份、事务日志、重新解析和同目录原子替换防止覆盖并发修改；installer 管理安装包资源与 `%LOCALAPPDATA%\CodePulse\bin` 稳定副本。Vue 设置卡只调用 inspect/preview/apply，不直接读写文件。

**技术栈：** Rust、serde_json、toml_edit 0.25、sha2、Windows `MoveFileExW`、Tauri commands/events、Vue 3、Pinia/localStorage、Vitest、PowerShell；不新增前端依赖。

**前置条件：** 阶段一至三门禁全部通过。实施当天必须重新查看官方 [Codex Hooks](https://developers.openai.com/codex/hooks/) 与 [Windows App](https://developers.openai.com/codex/windows/windows-app/) 文档；若配置结构、事件字段或信任行为改变，先同步修改总体路线图和本计划。

**本阶段消费：** 安装包资源 `bin/codepulse-codex-bridge.exe`、阶段二 runtime/self-check/listening status、阶段三 Agent UI 与设置 store。

**本阶段产生：** inspect/preview/apply 三个命令、安全配置事务、稳定 Bridge 安装记录、Codex 设置卡、显示偏好跨窗口同步、自动化 E2E 和真实端验收记录。

---

## 固定配置约定

### Codex Home 与托管配置

- 测试和显式环境优先使用 `CODEX_HOME`；未设置时使用 `%USERPROFILE%\.codex`，不使用 `$HOME` 推断。
- 用户层只允许读取/修改 `<codexHome>\hooks.json` 或 `<codexHome>\config.toml`。
- `%ProgramData%\OpenAI\Codex\requirements.toml` 只读；若 `[features].hooks = false` 或 `allow_managed_hooks_only = true` 阻止用户 Hook，状态为 `managed_disabled`，CodePulse 不尝试修改企业配置。

### CodePulse Hook 身份

- 八个事件精确为 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`SubagentStart`、`SubagentStop`、`Stop`。
- 每个事件新增一个无 matcher 的 matcher group，内部只有一个 command handler；无 matcher 表示监听该事件所有官方变体。
- 文档中的稳定命令记作 `"%LOCALAPPDATA%\CodePulse\bin\codepulse-codex-bridge.exe" --codepulse-hook-v1`；写配置前必须把 `%LOCALAPPDATA%` 解析为当前用户的绝对路径，配置中不保留环境变量占位。`--codepulse-hook-v1` 是归属标记；没有该参数的相同 EXE 路径也不视为 CodePulse 所有。
- JSON handler 固定包含 `type`、`command`、`commandWindows`、`timeout: 2`；TOML handler 固定包含 `type`、`command`、`command_windows`、`timeout = 2`。
- `command` 与 Windows override 都使用相同绝对命令；不设置 `matcher`、`statusMessage`、`async`、授权输出或环境变量。
- 检查 TOML 时同时接受官方允许的 `command_windows` 与 `commandWindows`，规范写入统一使用 `command_windows`。

### 表示方式选择

1. 只有 `hooks.json` 含 Hook => 沿用 JSON；
2. 只有 `config.toml` 含内联 `[hooks]` => 沿用 TOML；
3. 两者都没有 Hook => 创建 `hooks.json`；
4. 同一用户层两者都含 Hook => `conflict`，禁止自动写入；
5. 任一现有文件无法完整解析 => `conflict`，原文件不变。

---

## 任务 1：实现只读环境、配置和安装状态检查

**独立交付物：** 对真实或临时 Codex Home 运行 inspection 不产生任何写入，并能精确区分表示方式、Hook 开关、CodePulse 条目、Bridge 状态和七种用户可见阶段。

**Files:**

- Modify: `src-tauri/Cargo.toml`（新增生产依赖 `toml_edit = "0.25"`；继续使用现有 sha2/serde_json）
- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/types.rs`
- Create: `src-tauri/src/codex/integration/inspection.rs`
- Create: `src-tauri/src/codex/integration/inspection_tests.rs`
- Create: `src-tauri/src/codex/integration/fixtures/hooks-existing.json`
- Create: `src-tauri/src/codex/integration/fixtures/config-inline-hooks.toml`
- Create: `src-tauri/src/codex/integration/fixtures/requirements-hooks-disabled.toml`
- Modify: `src-tauri/Cargo.lock`（只由 Cargo 生成）

**消费接口：** `CodexListeningStatus`、安装包/稳定 EXE SHA-256、当前协议版本。

**产生接口：** 与总体路线图 3.5 一致的：

```rust
pub enum CodexHookRepresentation { HooksJson, ConfigToml, None, Conflict }
pub enum CodexHooksFeature { Enabled, Disabled, ManagedDisabled }
pub enum ManagedEntryState { Absent, Exact, Modified, Duplicate }
pub enum BridgeState { Missing, Current, Outdated, Modified }
pub struct BridgeInstallRecord {
    pub version: u16,
    pub protocol_version: u16,
    pub resource_sha256: String,
    pub installed_sha256: String,
    pub installed_at: i64,
}
pub struct CodexIntegrationInspection {
    pub codex_home: String,
    pub representation: CodexHookRepresentation,
    pub config_path: Option<String>,
    pub config_digest: Option<String>,
    pub hooks_feature: CodexHooksFeature,
    pub managed_entry: ManagedEntryState,
    pub bridge_state: BridgeState,
    pub hook_state: CodexHookState,
    pub issues: Vec<String>,
}

pub struct CodexIntegrationPaths {
    pub codex_home: PathBuf,
    pub hooks_json: PathBuf,
    pub config_toml: PathBuf,
    pub requirements_toml: PathBuf,
    pub packaged_bridge: PathBuf,
    pub installed_bridge: PathBuf,
    pub install_record: PathBuf,
}

pub fn inspect_codex_environment(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationInspection, CodexIntegrationError>;
```

- [ ] **步骤 1：先写无副作用与表示方式失败测试**

  每例使用 `TempDir`，调用前后递归记录路径、长度、mtime 和 SHA-256；inspection 后必须完全相同。覆盖：两文件都不存在 => none；仅普通 config.toml 无 hooks => none；hooks.json 有任意 Hook => hooks_json；TOML 有内联 hooks => config_toml；两边都有 => conflict；JSON/TOML 任一语法损坏 => conflict；UTF-8 BOM 可解析但写入计划会规范为无 BOM；非 UTF-8 => conflict。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests::representation -- --nocapture
  Pop-Location
  ```

  预期：integration 模块不存在，测试失败。

- [ ] **步骤 2：先写 feature、条目和 Bridge 失败测试**

  覆盖：本地 hooks 默认 enabled；`[features].hooks=false` 为 disabled；deprecated `codex_hooks=false` 只作为兼容读入并产生 warning；requirements 强制 false 或 managed-only 为 managed_disabled；企业文件绝不进入可写路径。

  条目覆盖 absent、八项 exact、缺事件/超时不同/路径不同/有 statusMessage 为 modified、同一或跨 group 多个 marker 为 duplicate；无 marker 的用户 handler 不计入。Bridge 覆盖 missing、资源/副本同 hash 为 current、安装记录是旧资源 hash 为 outdated、副本 hash 与安装记录不符为 modified。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests::states -- --nocapture
  Pop-Location
  ```

  预期：状态检查测试失败。

- [ ] **步骤 3：实现完整解析和派生状态**

  JSON 使用 `serde_json::Value` 完整解析并逐层验证 `hooks -> event[] -> group.hooks[]`；未知用户字段保留为 Value，不因 CodePulse 不认识而判损坏。TOML 使用 `toml_edit::DocumentMut`，只读 traversal 接受两种 Windows key。所有 CodePulse handler 按 marker 识别，再比较规范字段。

  `configDigest` 是主 Hook 配置原始字节 SHA-256；文件不存在时是空字节 SHA-256。planner 另计算覆盖两个用户配置、只读企业配置和 Bridge 状态的组合 `expectedDigest`。`issues` 只放稳定错误码/中文短句，不包含配置正文、token 或完整命令。七种用户可见 `phase` 的派生固定为：本地 features.hooks=false 或监听尚未启用 => disabled；managed disabled/conflict => config_conflict；服务 error => service_error；absent => not_installed；exact 但无当前进程真实事件 => awaiting_trust；部分/modified/duplicate/outdated => partial；服务 listening 且已收到当前进程真实事件 => running。`serviceState=starting` 只表示服务瞬态，不新增第八种用户可见 phase。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests -- --nocapture
  Pop-Location
  ```

  预期：表示、权限、条目、Bridge 与无副作用测试全部通过。

- [ ] **步骤 4：检查依赖和提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo tree -p netspeed-dynamic -i toml_edit
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  git diff --check
  ```

  预期：`toml_edit` 只有配置保真用途；无第二个 TOML 写入库；检查通过。

  建议提交信息：

  ```text
  检测 Codex Hook 与 Bridge 集成状态

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 2：生成可复核但不写盘的安装、修复和卸载计划

**独立交付物：** 对每种合法表示方式生成确定性语义变更，保留所有非 CodePulse handler；预览包含目标摘要和警告，不包含用户配置正文。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/hooks_json.rs`
- Create: `src-tauri/src/codex/integration/hooks_toml.rs`
- Create: `src-tauri/src/codex/integration/plan.rs`
- Create: `src-tauri/src/codex/integration/plan_tests.rs`

**消费接口：** 任务 1 inspection、固定八事件和稳定 Bridge 命令。

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

pub struct PreparedCodexHookChange {
    pub preview: CodexHookChangePreview,
    pub files: Vec<PreparedConfigFileChange>,
}

pub struct PreparedConfigFileChange {
    pub path: PathBuf,
    pub expected_raw_digest: String,
    pub target_bytes: Vec<u8>,
    pub existed: bool,
}

pub fn prepare_codex_hook_change(
    action: CodexHookAction,
    paths: &CodexIntegrationPaths,
    inspection: &CodexIntegrationInspection,
) -> Result<PreparedCodexHookChange, CodexIntegrationError>;
```

`target_bytes` 只留在 Rust，不进入 Tauri payload。通常 `files` 只有主 Hook 文件；当现有 `config.toml` 明确禁用 Hooks 且表示方式仍按规则选择 `hooks.json` 时，计划同时包含 hooks.json 与 config.toml 两项。`expectedDigest` 对所有决策输入的路径、存在性和原始 SHA-256 排序后计算；`previewDigest` 对 action、representation、expectedDigest、每个目标 path/target SHA-256、bridgeAction、changes/warnings 的规范 JSON 计算 SHA-256。

- [ ] **步骤 1：先写 hooks.json 语义保留失败测试**

  从 `hooks-existing.json` 开始，安装后逐项断言八个 CodePulse group、字段和 timeout；原 `PreToolUse`/Stop/未知事件 handler 的 Value 深度相等。重复 install 产生 no-op；repair 缺项、旧路径、重复 marker 后只保留八个 exact；uninstall 只移除带 marker handler，混合 group 中其他 handler 保留，空 CodePulse group 才删除；hooks 对象之外所有根字段深度相等。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::json -- --nocapture
  Pop-Location
  ```

  预期：JSON planner 不存在，测试失败。

- [ ] **步骤 2：先写 TOML 保真和选择规则失败测试**

  TOML 安装/修复/卸载后断言非 hooks 的注释、键顺序、字符串和数组文本保持；用户 hook 表保持；仅 CodePulse array-of-tables 变化。两种表示冲突、解析错误、managed disabled 都拒绝 plan；none 时 install 选择 hooks.json；disabled 本地 flag 的 install/repair 预览明确包含“启用 [features].hooks”以及“这会启用该配置层的全部现有 Hook”警告，必须由用户确认；uninstall 不改用户 flag，避免在用户后来增加其他 Hook 后擅自禁用它们。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::toml -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::plan_tests::selection -- --nocapture
  Pop-Location
  ```

  预期：测试失败。

- [ ] **步骤 3：先写预览摘要与并发摘要失败测试**

  断言相同输入 previewDigest 稳定；action、任一目标字节、任一输入文件摘要或 expectedDigest 变化都改变摘要；changes 精确列出新增/更新/删除事件数、配置开关和 Bridge 行为；本地 hooks=false 且新建 hooks.json 时产生两个文件变更；modified/duplicate 项有警告；preview 不含用户其他 command、token、完整配置或 target bytes。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::preview -- --nocapture
  Pop-Location
  ```

  预期：测试失败。

- [ ] **步骤 4：实现两个文档变换器和纯 planner**

  JSON 允许规范化为 2 空格 UTF-8 without BOM，预览必须提示 JSON 会重排空白；语义测试保证 Value 不丢。TOML 只用 `toml_edit` 节点增删。所有命令路径使用 Windows 绝对路径并正确引用；不进行字符串查找替换。

  modified/duplicate 只允许在显式 Repair/Uninstall 预览中变更，并加入“CodePulse 条目已被修改，将按标记精确处理”的警告；后台自动更新不得调用这两种计划。Install 遇到已有 marker 转为提示使用 Repair，不隐式覆盖。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests -- --nocapture
  Pop-Location
  ```

  预期：JSON/TOML/选择/摘要测试全部通过，尚无文件写入。

- [ ] **步骤 5：提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n "replace\(|replacen\(" src-tauri/src/codex/integration
  git diff --check
  ```

  预期：没有脆弱字符串替换配置；所有检查通过。

  建议提交信息：

  ```text
  生成 Codex Hook 安装修复预览

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 3：实现摘要防并发、备份、验证和原子配置写入

**独立交付物：** 只有原文件和预览都未变化时才写盘；每次修改现有文件先备份；故障不会留下半文件；卸载不以旧备份覆盖当前配置。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/writer.rs`
- Create: `src-tauri/src/codex/integration/writer_tests.rs`

**消费接口：** `PreparedCodexHookChange`、`expectedDigest`、`previewDigest`。

**产生接口：**

```rust
pub struct AppliedConfigChange {
    pub files: Vec<AppliedConfigFileChange>,
}

pub struct AppliedConfigFileChange {
    pub config_path: PathBuf,
    pub backup_path: Option<PathBuf>,
    pub new_digest: String,
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

- [ ] **步骤 1：先写竞争修改和备份失败测试**

  覆盖：expectedDigest 不符不创建 temp/backup；previewDigest 不符不写；preview 后用户增加 handler、修改 feature flag、改变企业约束或替换 Bridge 任一项都失败且用户字节原样保留；修改每个已有文件前创建 sibling `hooks.json.codepulse-backup-<UTC yyyyMMddTHHmmssfffZ>` 或 `config.toml.codepulse-backup-<UTC yyyyMMddTHHmmssfffZ>`；新建 hooks.json 时 backup=None；连续同毫秒用随机后缀防碰撞；备份内容字节等于写前文件。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::concurrency -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::writer_tests::backup -- --nocapture
  Pop-Location
  ```

  预期：writer 不存在，测试失败。

- [ ] **步骤 2：先写原子写故障注入失败测试**

  通过 `AtomicConfigFs` 测试实现逐点注入：事务日志写入失败、创建 temp 失败、write 失败、flush 失败、重读解析失败、第一/第二次 MoveFileEx 失败。每例断言尚未替换或已替换文件恢复到原摘要、临时文件清理；备份允许保留供审计。模拟进程在第一个替换后崩溃，再运行恢复函数：只有当前摘要仍等于事务 target 时才从备份恢复；文件已被用户再次修改时停止并报 conflict。成功后所有目标可重新完整解析、无 BOM、无 temp/事务日志残留。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests::atomic -- --nocapture
  Pop-Location
  ```

  预期：故障测试失败。

- [ ] **步骤 3：实现同目录临时文件、重新解析和 Windows 原子替换**

  每项 temp 名固定形态 `.<filename>.codepulse-<16 hex>.tmp`，`create_new(true)`；写入 `target_bytes`、flush、关闭、按目标格式重新 parse。把只含 path、原/目标摘要和 backup path 的事务日志原子写入 `%LOCALAPPDATA%\CodePulse\runtime\codex-config-transaction.json`，不得写配置正文；然后逐项调用 `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`。全部成功并重新检查后删除事务日志。Win32 unsafe 块用中文说明 UTF-16 指针有效期和同卷原子前提。

  应用前重新读取所有决策输入计算组合 expectedDigest，再用当前 inspection 重新 `prepare_codex_hook_change` 并比较 previewDigest，避免 UI 确认后环境变化。第二项替换失败时，仅在第一项当前摘要仍等于本事务 target 时回滚：原先存在的文件用本事务写前备份原子恢复，原先不存在的文件精确删除；用户已再次修改则不覆盖并报 conflict。启动恢复遵循同一规则。成功后再次 inspection，要求目标条目状态符合 action；正常卸载和后续修复绝不使用旧备份覆盖当前配置。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  Pop-Location
  ```

  预期：并发、备份、所有故障点和成功写入测试通过。

- [ ] **步骤 4：提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n "copy.*backup|MoveFileExW|unsafe" src-tauri/src/codex/integration/writer.rs
  git diff --check
  ```

  预期：每个 unsafe 有中文安全说明；卸载路径没有“恢复整份备份”操作。

  建议提交信息：

  ```text
  安全写入并精准卸载 Codex Hook

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 4：安装升级 Bridge 并公开 inspect/preview/apply 命令

**独立交付物：** 安装/修复事务在配置生效前保证稳定 Bridge 可执行；升级只自动更新 CodePulse 明确拥有且未被篡改的副本；卸载先移除 Hook 再删 EXE。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/installer.rs`
- Create: `src-tauri/src/codex/integration/installer_tests.rs`
- Create: `src-tauri/src/codex/integration/commands.rs`
- Create: `src-tauri/src/codex/integration/commands_tests.rs`
- Modify: `src-tauri/src/codex/service.rs`（启动后只在 exact+未篡改时检查资源升级；扩展 self-check 后三项）
- Modify: `src-tauri/src/codex/commands.rs`（re-export/状态合并，不复制 command）
- Modify: `src-tauri/src/lib.rs`（注册三个 integration commands）

**消费接口：** Tauri `resource_dir()/bin/codepulse-codex-bridge.exe`、任务 1–3 inspection/plan/writer、阶段二 self-check/status。

**产生接口：** 任务 1 的 `BridgeInstallRecord` 由 installer 原子写入；并新增：

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

返回类型与总体路线图 3.5 完全一致。

- [ ] **步骤 1：先写 Bridge 安装、升级和篡改失败测试**

  使用虚构 `MZ` 资源和 injected process runner 覆盖：资源缺失/非 PE/空文件拒绝；首次安装同目录 temp + 原子替换；写后 hash 等于资源；安装记录 UTF-8 without BOM 原子写；current 不重写；旧记录且副本等于旧记录 hash => 升级；副本与记录 hash 不符 => modified，后台不覆盖；协议版本不匹配 => repair；稳定路径固定 `%LOCALAPPDATA%\CodePulse\bin\codepulse-codex-bridge.exe`。

  process runner 对安装后 EXE 执行 `--codepulse-self-check` 启动契约检查，要求 1 秒内 stdout 精确 `{}`、stderr 空、exit 0；该检查不声称诊断内部投递错误，资源/安装 hash 才是版本完整性依据。无法启动、超时或违反输出契约时回滚到安装前二进制或删除首次新副本。文件占用替换固定尝试 3 次、间隔 50ms；测试用 injected sleeper，不真实等待。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests -- --nocapture
  Pop-Location
  ```

  预期：installer 不存在，测试失败。

- [ ] **步骤 2：先写事务顺序和命令失败测试**

  断言 Install/Repair 顺序为：重查摘要 → 暂存/验证 Bridge → 写配置 → inspection → self-check；配置写失败时恢复安装前 Bridge。若 runtime 目录探针失败，Repair 先停止未成功的服务，只在解析后的绝对路径严格位于 `%LOCALAPPDATA%\CodePulse\runtime`、不是 reparse point 且目录为空/只含 CodePulse 发现文件时创建或重建，然后重启服务；ACL 拒绝或 reparse point 返回稳定错误码，绝不递归删除或放宽系统 ACL。Uninstall 顺序为：重查摘要 → 写配置删除 handler → 验证 handler absent → 删除稳定 EXE/记录；删除 EXE 失败只返回 warning，绝不能恢复 Hook 指向缺失/待删 EXE。

  断言命令错误不含路径正文/token；并发两次 apply 只有第一份摘要成功；managed disabled/conflict 拒绝；preview 不写文件；apply 返回新 inspection 和 self-check。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::commands_tests -- --nocapture
  Pop-Location
  ```

  预期：命令/事务测试失败。

- [ ] **步骤 3：实现 installer 和应用启动升级检查**

  安装记录位于 `%LOCALAPPDATA%\CodePulse\bin\codepulse-codex-bridge.install.json`，不含用户配置。二进制备份只存在于事务 temp，结束即删。应用启动时先调用 `recover_interrupted_config_transaction()`；无法安全恢复时进入 config_conflict 且停止一切自动写入。随后自动检查仅在八项条目 exact、安装记录有效、副本 hash 等于记录 hash 时升级到新资源；modified/duplicate/用户改过命令只发布 partial，不写任何文件。

  self-check 前三项沿用阶段二，并在 DiscoveryMatchesRuntime 项内执行 runtime 目录 create/write/flush/rename/delete 探针；新增：packaged resource 可读/PE/hash、stable bridge hash/自检、Hook 配置可完整解析且条目状态。每次 inspection/apply 把 hookState 与非 running phase 合并进阶段二 `CodexListeningStatusStore`；其中 exact 但还没有当前进程真实事件为 awaiting_trust。模拟自检不能把 phase 改为 running；只有 Actor 的 `record_authenticated_event` 可以。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::installer_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  Pop-Location
  ```

  预期：Bridge 安装/升级/篡改保护、启动恢复、资源自检和 listening status 合并测试通过；三个新 Tauri 命令尚未注册，命令集成测试仍留给下一步。

- [ ] **步骤 4：实现并注册三个 Tauri 命令**

  manager 内增加一个 integration operation mutex，保证 preview 可并发读但 apply 串行；apply 锁内重新检查摘要。`inspect` 和 `preview` 不要求用户写权限；`apply` 的所有文件 I/O 放入 `spawn_blocking`，不阻塞 Tauri UI 线程。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration -- --nocapture
  cargo test -p netspeed-dynamic --lib
  Pop-Location
  ```

  预期：安装、升级、篡改、事务顺序、三个命令和现有 Rust 测试通过。

- [ ] **步骤 5：提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets --all-features -- -D warnings
  Pop-Location
  rg -n "inspect_codex_integration|preview_codex_hook_change|apply_codex_hook_change" src-tauri/src
  git diff --check
  ```

  预期：每个命令只定义/注册一次；质量检查通过。

  建议提交信息：

  ```text
  管理 Codex Bridge 安装升级事务

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 5：实现设置卡、预览确认和跨窗口显示偏好

**独立交付物：** 主窗口可检测、预览、安装、修复、卸载和自检；Widget 即时接收空闲常驻/命令摘要显示偏好；配置写入后先显示等待信任，真实事件后才显示正常运行。

**Files:**

- Modify: `src/shared/ipc/contracts.ts`（integration types、`CodexDisplayPreferences`）
- Modify: `src/shared/ipc/commands.ts`（三个 integration wrapper）
- Modify: `src/shared/ipc/commands.test.ts`
- Modify: `src/shared/ipc/events.ts`（前端事件 `codex-display-settings-changed`）
- Modify: `src/stores/settings.ts`（`codexIdlePersistent`、`codexShowCommandSummary` 与 setters/watch）
- Create: `src/stores/settings.test.ts`
- Create: `src/composables/useCodexIntegration.ts`
- Create: `src/composables/useCodexIntegration.test.ts`
- Create: `src/components/dashboard/CodexStatusSettingsCard.vue`
- Create: `src/components/dashboard/CodexStatusSettingsCard.test.ts`
- Modify: `src/components/dashboard/IslandSettingsPanel.vue`（grid 末尾插入设置卡）
- Modify: `src/components/dashboard/IslandSettingsPanel.test.ts`
- Modify: `src/modules/codex/types.ts`（UI state 增加 `showCommandSummary`）
- Modify: `src/components/island/codex/CodexCompactContent.vue`
- Modify: `src/components/island/codex/CodexTaskDetail.vue`
- Modify: `src/components/island/codex/CodexCompactContent.test.ts`
- Modify: `src/components/island/codex/CodexTaskDetail.test.ts`
- Modify: `src/components/island/IslandView.vue`（从 settings store 传偏好，监听前端同步事件）
- Modify: `src/components/island/IslandView.codex.test.ts`

**消费接口：** 任务 4 三个命令、阶段二状态事件、阶段三 `useCodexAgent`。

**产生接口：**

```ts
export interface CodexDisplayPreferences {
  idlePersistent: boolean
  showCommandSummary: boolean
}

export function useCodexIntegration(): {
  inspection: Readonly<Ref<CodexIntegrationInspection | null>>
  listeningStatus: Readonly<Ref<CodexListeningStatus | null>>
  preview: Readonly<Ref<CodexHookChangePreview | null>>
  busy: Readonly<Ref<boolean>>
  error: Readonly<Ref<string>>
  inspect: () => Promise<void>
  requestChange: (action: CodexHookAction) => Promise<void>
  confirmChange: () => Promise<void>
  cancelPreview: () => void
  runSelfCheck: () => Promise<CodexSelfCheckResult>
}
```

- [ ] **步骤 1：先写 IPC、store 默认值和跨窗口失败测试**

  wrapper 参数/返回值与 Rust 一致。store 断言 `nsd_codex_idle_persistent` 默认 false、`nsd_codex_show_command_summary` 默认 true、写入为 UTF-8 localStorage 字符串。Widget 接收 `codex-display-settings-changed` 后同时更新两个 ref；卸载清 listener；旧值不需要 Rust settings 命令持久化。

  运行：

  ```powershell
  pnpm run test -- src/shared/ipc/commands.test.ts src/stores/settings.test.ts src/components/island/IslandView.codex.test.ts
  ```

  预期：integration wrapper、偏好和事件不存在，测试失败。

- [ ] **步骤 2：先写 composable 预览竞态失败测试**

  覆盖：inspect 旧请求不覆盖新请求；requestChange 只设置 preview 不 apply；confirm 使用 preview 中 expectedDigest/previewDigest；confirm 期间禁重复点击；摘要冲突显示错误并自动重新 inspect；cancel 不写；dispose 后迟到结果不回写；监听状态事件更新最近事件和来源。

  运行：

  ```powershell
  pnpm run test -- src/composables/useCodexIntegration.test.ts
  ```

  预期：composable 不存在，测试失败。

- [ ] **步骤 3：先写设置卡七状态和操作失败测试**

  卡片固定展示：Codex 状态监听开关、监听状态、最近事件、接入来源、空闲常驻、显示脱敏命令摘要、检测环境、修复配置、卸载 Hook。状态文本覆盖未启用、未安装、等待信任、正常运行、部分可用、配置冲突、服务异常。

  开关从未安装切开只展示 install 预览；从已安装切关展示 uninstall 预览。预览区逐项显示 changes/warnings/bridgeAction，并有确认/取消。managed disabled/conflict 禁止直接开关并显示原因；repair 只走预览；正常运行只在 status.phase=running。按钮具备 disabled/aria-live 状态。

  运行：

  ```powershell
  pnpm run test -- src/components/dashboard/CodexStatusSettingsCard.test.ts src/components/dashboard/IslandSettingsPanel.test.ts
  ```

  预期：设置卡不存在，测试失败。

- [ ] **步骤 4：实现设置与显示偏好**

  在 `IslandSettingsPanel` grid 末尾插入全宽设置卡，样式留在组件 scoped CSS，不改整个控制台布局。偏好 toggle 先更新 store，再 `emit(CODEX_DISPLAY_SETTINGS_CHANGED, payload)`；Widget 启动仍从共享 localStorage 读取，运行时由事件同步。

  `IslandView` 把 `codexIdlePersistent` ref 传给 `useCodexAgent`，把 `codexShowCommandSummary` 放入 `CodexAgentDisplayState`。false 时 compact/detail 隐藏 `operationSummary`，但仍显示阶段和通用“正在执行命令”；不修改 Rust 事件或聚合状态。

  运行：

  ```powershell
  pnpm run test -- src/composables/useCodexIntegration.test.ts src/components/dashboard/CodexStatusSettingsCard.test.ts src/components/dashboard/IslandSettingsPanel.test.ts src/components/island/codex src/components/island/IslandView.codex.test.ts
  pnpm run typecheck
  ```

  预期：设置、预览、显示偏好和 Widget 同步测试全部通过。

- [ ] **步骤 5：提交**

  运行：

  ```powershell
  pnpm run lint
  pnpm run format:check
  rg -n "正常运行" src/components/dashboard src/composables
  git diff --check
  ```

  预期：“正常运行”只由 phase 映射产生，不由 apply 成功回调直接赋值。

  建议提交信息：

  ```text
  添加 Codex 状态监听设置与配置预览

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 6：建立不触碰真实用户配置的自动化端到端矩阵

**独立交付物：** 临时 Codex Home 中从配置计划、Bridge 转换、HTTP 认证、Actor 聚合到状态快照的全链路可重复运行，覆盖设计的十四项 E2E 场景。

**Files:**

- Modify: `src-tauri/Cargo.toml`（仅 dev-dependency 引用 workspace `codepulse-codex-bridge`）
- Create: `src-tauri/src/codex/e2e_tests.rs`
- Modify: `src-tauri/src/codex/mod.rs`（`#[cfg(test)] mod e2e_tests;`）
- Create: `scripts/verify-codex-status-scope.ps1`

**消费接口：** 四阶段所有 Rust 公开/测试接口、ManualClock、fake publisher/process runner、TempDir；不使用真实 `%USERPROFILE%\.codex`。

**产生接口：** 无生产接口；`verify-codex-status-scope.ps1` 是发布前静态范围门禁。

- [ ] **步骤 1：先写十四项 E2E 失败测试**

  用明确测试名覆盖：

  1. CLI 父进程链普通任务；
  2. App 父进程链普通任务；
  3. 两端多 session 并行；
  4. 读取/修改/命令/测试阶段；
  5. PermissionRequest 强提醒；
  6. 测试先失败后工具成功再 Stop 完成；
  7. Stop 明确最终失败；
  8. 完成在 ManualClock 5 分钟删除；
  9. 失败只由 clear 删除；
  10. server 已退出时 Bridge 静默成功且没有历史补偿；
  11. 47653 冲突后动态端口仍投递；
  12. 用户已有其他 Hook 安装/卸载前后深度相等；
  13. exact 配置无真实事件保持 awaiting_trust；
  14. 新资源修复旧 Bridge 后配置命令稳定不变。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests -- --nocapture
  Pop-Location
  ```

  预期：全链路 test harness 尚未接线，新增测试失败。

- [ ] **步骤 2：实现内存/临时目录 harness 并通过矩阵**

  Bridge 转换调用库 `run_once` 或 conversion/client 测试接口；HTTP 使用真实 loopback socket；聚合用 Actor+ManualClock；配置用 TempDir；publisher 记录事件。除了连接测试不使用真实进程、真实用户 Home、真实 Codex App 或网络。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests -- --nocapture
  Pop-Location
  ```

  预期：十四项全部通过；测试结束后 TempDir 删除，仓库无发现文件/事件文件。

- [ ] **步骤 3：编写并运行范围门禁脚本**

  `verify-codex-status-scope.ps1` 必须在以下条件失败：出现 `package-lock.json`/`yarn.lock`；生产代码出现 WSL 路径或 `wsl.exe`；Codex 组件出现 allow/deny/open-session/pause/terminate API；Bridge 出现事件历史写入、重试循环、stdout 非 `{}`；`IslandView.vue` 出现 5/10/30 分钟常量或 Stop classifier。

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  ```

  预期：脚本输出所有范围检查通过。

- [ ] **步骤 4：全量自动验收并提交**

  运行：

  ```powershell
  pnpm run test
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  pnpm run build
  pnpm run build:codex-bridge
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-bridge-resource.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  Push-Location src-tauri
  cargo test --workspace
  cargo fmt --all --check
  cargo clippy --workspace --all-targets --all-features -- -D warnings
  Pop-Location
  git diff --check
  git diff --name-only
  ```

  预期：所有自动测试/构建/质量/范围门禁通过；无真实配置、日志正文、事件历史、锁文件污染。

  建议提交信息：

  ```text
  覆盖 Codex 状态岛端到端回归矩阵

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

---

## 任务 7：完成 Windows 原生 App 与独立 CLI 真实验收

**独立交付物：** 有日期、版本、来源和每项结果的人工验收记录；自动测试不能替代真实 Hook 信任、App 来源和独立 CLI 门禁。

**Files:**

- Create: `docs/plans/2026-07-16-codex-status-island-e2e-verification.md`

**消费接口：** 发布候选 CodePulse 安装包、设置页、真实 Codex App、预先存在且可在 PowerShell 独立运行的官方 Codex CLI 环境。

**产生接口：** 验收记录表，每项状态只能是“通过”“失败”“环境阻塞”，环境阻塞必须写具体命令输出摘要和发布影响。

- [ ] **步骤 1：记录环境而不修改配置**

  运行：

  ```powershell
  Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'Codex|ChatGPT' } |
    Select-Object DisplayName,DisplayVersion,InstallLocation
  Get-Command codex -All -ErrorAction SilentlyContinue | Select-Object Source,Version
  codex --version
  Get-FileHash -Algorithm SHA256 -LiteralPath "$env:USERPROFILE\.codex\config.toml" -ErrorAction SilentlyContinue
  Get-FileHash -Algorithm SHA256 -LiteralPath "$env:USERPROFILE\.codex\hooks.json" -ErrorAction SilentlyContinue
  ```

  预期：记录 App/CLI/配置表示的客观状态。本次调研环境中 App 存在，但 App 安装目录的 `codex.exe` 不能作为外部 PowerShell CLI 正常调用；若实施时仍如此，将 CLI 标为环境阻塞，不安装替代 CLI、不冒充通过。

- [ ] **步骤 2：用设置页安装并验证信任边界**

  启动发布候选 CodePulse，依次点击“检测环境”→打开监听开关→检查八事件/Bridge 预览→确认。确认后检查状态先为“等待信任”，不是“正常运行”；启动一个新的 Codex App 任务，按官方 UI 审核并信任 CodePulse command Hook，再提交普通只读请求。第一条真实事件后状态必须变为“正常运行”，来源包含 App。

  运行：

  ```powershell
  Get-FileHash -Algorithm SHA256 -LiteralPath "$env:LOCALAPPDATA\CodePulse\bin\codepulse-codex-bridge.exe"
  Get-Content -LiteralPath "$env:LOCALAPPDATA\CodePulse\runtime\codex-bridge.json" -Encoding utf8
  ```

  预期：稳定 EXE 存在；运行时发现文件版本/端口/PID存在。不得把 token 复制进验收文档。

- [ ] **步骤 3：在 Codex App 验证状态、并行与生命周期**

  在两个 App 任务中分别执行只读、编辑临时测试文件、普通命令、测试、一次需要授权的安全命令、一次先失败后修复、一次明确无法完成的受控任务。观察并记录：列表每 session 一项；阶段映射；授权强打断但无允许按钮；子任务只计数；中间失败不变最终红色；完成保留 5 分钟；失败手动清除；详情期间新事件不重置导航；主/卫星切换与鼠标离开一秒收缩。

  测试文件必须位于专用临时仓库，不在 CodePulse 工作树制造无关改动。等待 5 分钟是唯一真实生命周期观察；10/30 分钟边界以 ManualClock 自动测试为发布证据，人工验收只验证中断视觉的调试时钟构建或受控测试接口，发布构建不暴露调试接口。

  运行：

  ```powershell
  pnpm run test -- src/components/island/codex src/components/island/IslandView.codex.test.ts src/modules/island/display.test.ts
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::aggregator_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::lifecycle_tests -- --nocapture
  Pop-Location
  ```

  预期：组件、导航、多岛、聚合和 ManualClock 生命周期测试全部通过；人工 App 场景逐项符合本步骤清单，完成卡在实际观察满 5 分钟后消失，失败卡只在手动清除后消失。

- [ ] **步骤 4：验证退出、端口冲突、修复与精确卸载**

  在测试账户中先用 PowerShell listener 占用 47653，再启动 CodePulse，确认设置页显示服务正常且 `usingFallbackPort=true`；停止 listener 不要求运行中的服务迁回固定端口。通过托盘退出 CodePulse 后再触发 Codex 事件，测量 Bridge 快速 `{}`/0 且无卡片补偿；重启 CodePulse 后只接收新事件。

  在设置页执行“修复配置”预览，确认缺失/旧 Bridge 可恢复；然后“卸载 Hook”预览并确认。卸载后语义比较所有非 CodePulse handler 与安装前相同，稳定 EXE/记录删除，时间戳备份保留，不用备份覆盖当前配置。

  运行：

  ```powershell
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 47653)
  $listener.Start()
  try {
    Write-Host '固定端口已占用；现在启动发布候选 CodePulse，完成动态端口、托盘退出、修复和卸载检查。'
    $null = Read-Host '全部人工检查完成后按 Enter 释放测试端口'
  }
  finally {
    $listener.Stop()
  }
  Test-Path -LiteralPath "$env:LOCALAPPDATA\CodePulse\bin\codepulse-codex-bridge.exe"
  Test-Path -LiteralPath "$env:LOCALAPPDATA\CodePulse\bin\codepulse-codex-bridge.install.json"
  ```

  预期：CodePulse 在端口占用期间使用非 47653 的回环端口且不报服务故障；托盘退出后发现文件被清理或因已退出 PID 被 Bridge 拒绝；卸载确认后两次 `Test-Path` 都返回 `False`，非 CodePulse Hook 语义比较不变。

- [ ] **步骤 5：在独立 CLI 环境重复真实来源与并行门禁**

  运行：

  ```powershell
  $codex = Get-Command codex -ErrorAction Stop
  & $codex.Source --version
  ```

  预期：`Get-Command` 返回普通 PowerShell 可调用的独立 Codex CLI，`codex --version` 以 0 退出。只有此前置判定通过才继续安装/信任同一用户层 Hook，执行普通任务、授权任务，并与 App 同时运行两个 session；状态来源分别显示 Codex CLI/Codex App，统一占一个 Agent 模块。失败或不可用时在验收记录写“环境阻塞”，该版本不得宣称完成设计文档的全部正式兼容范围。

- [ ] **步骤 6：写验收结论、最终构建并提交**

  验收记录不得包含 token、完整路径正文、命令输出、提示词或用户配置，只写版本、场景、通过/失败/阻塞、短错误码和复现步骤。

  运行：

  ```powershell
  pnpm run tauri build
  pnpm run test
  Push-Location src-tauri
  cargo test --workspace
  Pop-Location
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  git diff --check
  git status --short
  ```

  预期：最终安装包和全量测试通过；记录如实区分 App 通过与 CLI 通过/阻塞；真实 Hook 已按验收决定保留或通过设置页精确卸载。

  建议提交信息：

  ```text
  记录 Codex 状态岛 Windows 端到端验收

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

## 阶段四与全功能完成门禁

- inspection 全程只读；现有 JSON/TOML 都完整解析；冲突或损坏时不写。
- 用户确认前只有 preview；apply 同时校验原文件摘要和预览摘要；配置修改有时间戳备份、重新解析和原子替换。
- 安装/修复不删除其他 Hook；卸载只删 marker handler，不用旧备份覆盖用户当前文件；企业配置只读。
- Bridge 稳定路径、资源 hash、安装记录、自检、自动升级和篡改保护全部通过；卸载顺序不会留下指向缺失 EXE 的 Hook。
- 设置页七种状态准确；写配置后仍为等待信任，只有第一条真实事件变正常运行。
- 第一版没有 WSL、打开会话、灵动岛授权控制、暂停/终止/继续或历史补偿。
- 十四项自动 E2E、全量前后端测试、bundle 与范围门禁通过。
- Codex App 真实验收通过；独立 CLI 真实验收通过后才能宣称满足完整正式范围。若 CLI 环境阻塞，功能实现可合并但发布说明必须明确缺少该门禁。
- 全部完成后停止，不自动开展下一版功能。
