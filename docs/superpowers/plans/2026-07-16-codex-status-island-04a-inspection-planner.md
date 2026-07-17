# 阶段四 A：Codex Integration Inspection 与 Planner 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 只读检查 Codex Home、`features.hooks`/弃用 `features.codex_hooks`、企业策略、Hook 表示、CodePulse marker 与 Bridge 状态，以标准 JSON/TOML Fixture 为唯一 Exact 母版，输出不含动态 phase 的静态 Inspection；再结合 generation-aware Runtime facts 单独派生唯一 ListeningStatus/runtime 启动决策，并生成不写盘的 install/repair/uninstall 计划和安全预览。

**架构：** `inspection.rs` 只读取 `CodexIntegrationPaths` 指向的文件并产生结构化事实；唯一 Fixture loader 先把 JSON/TOML 母版解析为 `serde_json::Value`/`toml_edit::DocumentMut`，再只修改 CodePulse command AST 节点。Exact 显式绑定 `paths.installed_bridge`，从完整用户配置中只提取经稳定路径、双 command 字段和 matcher 结构共同验证的 CodePulse-owned 投影，再在 AST 中反向规范化；`status.rs` 用 inspection 与 runtime facts 纯派生 `CodexListeningStatus`；`plan.rs` 对完整解析树做语义增删并产生 `PreparedCodexHookChange`。本批次不引入 writer、installer、Tauri apply 或 Vue UI。

**技术栈：** Rust 2021、serde_json、toml_edit 0.25、sha2、tempfile；不新增前端依赖。

## 全局约束

- 前置门禁：阶段一至三全部通过；阶段四总览已 review。
- 本计划服从规范层级：设计文档定义产品可见行为，Roadmap定义公共接口与全局不变量，本计划只细化04A执行顺序、失败处理、测试和审核；不得静默改变产品流程，公共接口或全局不变量变化必须同步Roadmap及所有消费者计划。
- 只消费阶段一 `CodexIntegrationPaths`，禁止重新拼接 CodePulse/runtime/bin。
- 路径对象字段固定包含 `integration_transaction_file`，04A 只把它纳入 expectedDigest 的路径/存在性输入，不读取、创建或恢复 Journal；只有 `paths.rs` 可以拼接 `codex-integration-transaction.json`。
- 真实 `%USERPROFILE%\.codex` 与 `%ProgramData%` 只能读；全部自动测试使用 TempDir。
- CodePulse的配置管理范围只限用户层`%USERPROFILE%\.codex`中的CodePulse Hook。04A不得修改仓库层`.codex`、插件Hook或企业托管配置，不得扫描用户电脑上的全部仓库，也不得根据未扫描层推断“全局不存在其他CodePulse Hook”。Inspection/UI只能陈述用户层事实，不提供“全局唯一Hook”或`DuplicateCodePulseHookAcrossLayers`状态。
- `features.hooks=false` 时 install/repair planner 返回 HooksDisabled；marker absent 不产生计划；marker present 且 representation/marker 可安全解析时允许生成只删除 CodePulse marker 的 uninstall 计划。
- 企业托管禁用时返回 ManagedDisabled；不引导修改企业文件。
- `features.codex_hooks` 只读兼容且永不改写；两个 Feature 键冲突或非布尔时 install/repair/uninstall 全部 ConfigConflict且 Runtime RemainStopped。
- 2026-07-17 官方 Hooks/Config 文档确认事件→matcher组→handler三层、基础`command`必需且`commandWindows`为Windows override、TOML标准字段`command_windows`、timeout单位秒/缺省600、非托管command Hook按定义哈希信任；用户层、仓库层、插件等活动配置源会共同加载，多个文件中所有匹配Hook都会执行，同一事件的多个command Hook并发启动。Matcher仅部分事件生效，省略可匹配全部，UserPromptSubmit/Stop不支持。官方未明确managed requirements接受弃用别名，因此企业文件只识别标准`[features].hooks`与`allow_managed_hooks_only`。04A实施第一步必须重新核对同一官方Hooks/Config Reference；任一层级、合并执行、并发、字段、Matcher、Feature alias、timeout、信任或managed规则发生变化时，先停止并同步设计、Roadmap、04A/04B/04C与两份标准Fixture，不能直接按旧计划写源码。
- 不创建自建 Dispatcher；planner 在 Codex 原生多 Hook 表示上逐项保留用户原 Hook，只增删带 CodePulse marker 的条目。
- Fixture 路径替换禁止作用于原始 JSON/TOML 文本；JSON 反斜杠只交给 `serde_json` serializer，TOML 引号/反斜杠只交给 `toml_edit`。Inspection Exact、Planner Install/Repair、序列化快照和 04C E2E 必须调用同一个 loader/AST 反向规范化函数，并显式传入 `paths.installed_bridge`；任何其他 EXE 即使携带相同 marker 参数也不能成为 CodePulse-owned handler。
- `modified` 允许后续 runtime 启动但 ListeningStatus phase 必须 partial，planner 只能通过显式 Repair 处理；Inspection 本身不保存 phase。
- 每个任务完成后可单独review；本计划门禁完成后停止，不自动进入04B-1。

---

## 任务 1：实现只读表示方式、Hooks feature 与 marker inspection

**独立交付物：** 任意合法/损坏的临时用户层 Codex Home 都能在零写入前提下得到确定的表示方式、feature、CodePulse marker 与 Bridge 状态；结果明确标记为用户层管理事实，不推断其他活动配置层。

**Files:**

- Modify: `src-tauri/Cargo.toml`（新增 `toml_edit = "0.25"`；测试继续使用 tempfile）
- Modify: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/types.rs`
- Create: `src-tauri/src/codex/integration/inspection.rs`
- Create: `src-tauri/src/codex/integration/inspection_tests.rs`
- Create: `src-tauri/src/codex/integration/fixtures/codepulse-hooks-exact.json`
- Create: `src-tauri/src/codex/integration/fixtures/codepulse-hooks-exact.toml`
- Create: `src-tauri/src/codex/integration/fixtures/hooks-existing.json`
- Create: `src-tauri/src/codex/integration/fixtures/config-inline-hooks.toml`
- Create: `src-tauri/src/codex/integration/fixtures/requirements-hooks-disabled.toml`
- Modify: `src-tauri/Cargo.lock`（只由 Cargo 生成）

**消费接口：** `CodexIntegrationPaths` 的 12 个字段（统一事务字段名为 `integration_transaction_file`）、`CODEX_PROTOCOL_VERSION`、编译期 `CODEPULSE_TARGET_TRIPLE`、安装包/稳定 EXE SHA-256。

**产生接口：**

```rust
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

pub struct BridgeInstallRecord {
    pub version: u16,
    pub protocol_version: u16,
    pub target_triple: String,
    pub resource_sha256: String,
    pub installed_sha256: String,
    pub installed_at: i64,
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

pub fn inspect_codex_environment(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationInspection, CodexIntegrationError>;

pub(crate) fn inspect_codex_hooks_feature(
    config: &toml_edit::DocumentMut,
) -> CodexHooksFeatureInspection;

pub fn build_codepulse_hook_command(
    bridge_path: &Path,
) -> Result<String, CodexIntegrationError>;

pub enum CodePulseHookFixtureRepresentation { HooksJson, ConfigToml }

pub enum CodePulseHookFixtureAst {
    Json(serde_json::Value),
    Toml(toml_edit::DocumentMut),
}

pub fn load_codepulse_hook_fixture(
    representation: CodePulseHookFixtureRepresentation,
    bridge_path: &Path,
) -> Result<CodePulseHookFixtureAst, CodexIntegrationError>;

pub fn normalize_codepulse_hook_commands_for_exact(
    representation: CodePulseHookFixtureRepresentation,
    actual: CodePulseHookFixtureAst,
    expected_bridge_path: &Path,
) -> Result<CodePulseHookFixtureAst, CodexIntegrationError>;
```

公开结构必须精确保持上述静态字段，不得加入 `hook_state`、`phase`、service state、port、lastEventAt、sources、runtime generation 或 authenticated generation。公开 `issues` 映射为稳定中文短句；内部测试必须直接断言 `CodexHooksFeatureInspection` 的两个原始 Option、effectiveState 与 issueCodes。Rust serde/04C TypeScript fixture 都要断言 JSON 中不存在动态字段。

### 标准 Hook Fixture（唯一 Exact 母版）

`codepulse-hooks-exact.json` 的完整内容固定为：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "commandWindows": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "timeout": 2
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "commandWindows": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "timeout": 2
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "commandWindows": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "timeout": 2
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "commandWindows": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "timeout": 2
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "commandWindows": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "timeout": 2
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "commandWindows": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "timeout": 2
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "commandWindows": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "timeout": 2
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "commandWindows": "\"__CODEPULSE_BRIDGE_PATH__\" --codepulse-hook-v1",
            "timeout": 2
          }
        ]
      }
    ]
  }
}
```

`codepulse-hooks-exact.toml` 的完整内容固定为：

```toml
[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
command_windows = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
timeout = 2

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
command_windows = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
timeout = 2

[[hooks.PreToolUse]]
[[hooks.PreToolUse.hooks]]
type = "command"
command = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
command_windows = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
timeout = 2

[[hooks.PermissionRequest]]
[[hooks.PermissionRequest.hooks]]
type = "command"
command = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
command_windows = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
timeout = 2

[[hooks.PostToolUse]]
[[hooks.PostToolUse.hooks]]
type = "command"
command = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
command_windows = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
timeout = 2

[[hooks.SubagentStart]]
[[hooks.SubagentStart.hooks]]
type = "command"
command = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
command_windows = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
timeout = 2

[[hooks.SubagentStop]]
[[hooks.SubagentStop.hooks]]
type = "command"
command = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
command_windows = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
timeout = 2

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
command_windows = '"__CODEPULSE_BRIDGE_PATH__" --codepulse-hook-v1'
timeout = 2
```

`__CODEPULSE_BRIDGE_PATH__` 是这两份文件唯一允许的占位符，但 loader 禁止在 `include_str!` 返回的原始文本上调用 `replace`。完整步骤固定为：

```text
JSON: include_str! → serde_json parse（from_str）为 Value → 只定位八个 CodePulse handler 的 command/commandWindows → 写入 AST string value → serde_json 序列化目标字节
TOML: include_str! → toml_edit 解析 DocumentMut → 只定位八个 CodePulse handler 的 command/command_windows → 写入 Value → toml_edit 输出目标字节
```

`build_codepulse_hook_command(bridge_path)` 先要求绝对路径且拒绝 NUL/换行，再返回精确语义 `"<absolute bridge path>" --codepulse-hook-v1`；JSON 反斜杠由 `serde_json` serializer 转义，禁止手工拼 JSON escape；TOML 的反斜杠、双引号和合法目录单引号由 `toml_edit` value serializer 处理，禁止把路径插入单引号原始文本。loader 写值后重新遍历 AST，断言所有 CodePulse command 字段语义等于构造函数结果且不再含 placeholder。

Exact 反向规范化固定为：先把真实配置解析为对应 AST，再以 `build_codepulse_hook_command(expected_bridge_path)` 产生唯一 expected command。只有同时满足以下条件的 handler 才是 CodePulse-owned：`type="command"`；基础 `command` 与 Windows override 都存在；两者 AST string 都逐字等于 expected command；参数恰好只有 `--codepulse-hook-v1`，没有 `--extra` 或任何附加参数；事件属于八种标准事件；matcher group 符合对应 Fixture 规则。只存在 Windows override、两个 command 指向不同程序、旧 Bridge 路径、其他 EXE 加 marker 或额外参数，都不得被规范化成 Exact。

规范化函数返回的是仅含 CodePulse-owned matcher groups 的规范投影，不是完整用户配置：解析完整 AST → 提取独占且结构合法的 CodePulse matcher group → 保留事件、matcher group 与 handler 的完整 CodePulse 三层结构 → 只把已验证的两个 command AST value 改为母版占位符语义 → 与 `include_str!` 解析出的标准 Fixture AST 比较。用户独立 matcher group 完全不进入该投影，因此同一事件存在用户自己的 Hook 不影响 Exact。若一个 matcher group 同时包含 CodePulse handler 与用户 handler，该 group 不得作为 CodePulse-owned group，也不得把用户 handler 吸收到投影；Inspection 固定为 Modified，Repair 保留用户 handler 并另建独立标准 CodePulse matcher group。禁止 `actual_text.replace(actual_path, "__CODEPULSE_BRIDGE_PATH__")` 或任何原始文本路径替换。八个标准 matcher group 都省略 matcher；尤其 UserPromptSubmit/Stop 不得写会被忽略的无意义 matcher。Fixture 禁止 statusMessage、async、prompt/agent handler，也不得包含用户其他 Hook；它只定义 CodePulse 要插入/比较的 matcher 组。

- [ ] **步骤 1：先写 inspection 零副作用失败测试**

  每例使用四个 TempDir 根构造 `CodexIntegrationPaths`。调用前后递归记录路径、长度、mtime 和 SHA-256，覆盖两文件都不存在、普通 config 无 hooks、仅 JSON Hooks、仅 TOML Hooks、两边都有、JSON/TOML 损坏、UTF-8 BOM、非 UTF-8。每例断言目录与字节完全不变；inspection 不创建 codepulse_root/runtime/bin。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests::read_only -- --nocapture
  Pop-Location
  ```

  预期：integration 类型和 inspection 不存在，测试编译失败。

- [ ] **步骤 2：先写 feature、marker 和 Bridge 状态失败测试**

  Feature 内部事实使用表格测试固定：

  - `hooks` 与 `codex_hooks` 都缺失 → Enabled、两个 Option=None、无 alias Issue；
  - `hooks=false` → Disabled；
  - 只有 `codex_hooks=false` → Disabled + `DeprecatedCodexHooksAlias`；
  - `hooks=true + codex_hooks=true` → Enabled + `DeprecatedCodexHooksAlias` + `DuplicateHooksFeatureKeys`；
  - `hooks=false + codex_hooks=false` → Disabled + 同两项 Issue；
  - `hooks=true + codex_hooks=false` 与反向组合 → ConfigConflict + `HooksFeatureValueConflict`；
  - 标准键或别名为非布尔值 → ConfigConflict + `HooksFeatureTypeConflict`；
  - 企业 requirements 的 `[features].hooks=false` 或 `allow_managed_hooks_only=true` → ManagedDisabled；企业 `codex_hooks` 不当作有效 managed 键，只产生只读诊断，文件字节不变。

  标准 JSON Fixture 和替换稳定路径后的标准 TOML Fixture都得到 managedEntry=Exact；八事件任一缺失、timeout!=2、出现 statusMessage、出现 async=true、UserPromptSubmit/Stop 带 matcher、路径或命令层级不同都为 Modified。安全 Marker/Exact 路径绑定矩阵固定覆盖：稳定 Bridge 的基础 command 与 Windows override 都精确匹配 → Exact；`C:\Other\bridge.exe --codepulse-hook-v1` → 不识别为安全 Marker；旧 Bridge 路径 → Modified；基础 command 正确但 Windows override 指向其他程序 → Modified；Windows override 正确但基础 command 错误 → Modified；附加 `--extra` → Modified；只存在 Windows override → Modified。Bridge 参数缺少 `--codepulse-hook-v1` 时同样不得识别为安全 CodePulse marker；重复母版为 Duplicate；无法完整解析时 markerPresence=Ambiguous。Bridge 覆盖 missing/current/outdated/modified，并断言所有期望路径都来自同一个 paths 对象。序列化完整 inspection 后断言没有 hookState/phase/serviceState/runtimeGeneration/authenticatedGeneration。

  CodePulse-owned projection 另覆盖两类用户 Hook：同一事件存在独立用户 matcher group 时，CodePulse 仍为 Exact且用户 group 不进入投影；用户 handler 与 CodePulse handler 被人工合并进同一个 matcher group 时为 Modified，投影不吸收用户 handler，Repair 后用户 handler AST 深度相等且标准 CodePulse group 独立存在。

  Fixture loader 路径矩阵必须分别使用：

  ```text
  C:\Users\Test User\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe
  C:\Users\测试用户\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe
  C:\Users\O'Connor\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe
  ```

  对每条路径和 JSON/TOML 两种表示分别断言：loader 输出仍可解析；`command` 与 Windows override 的 AST string 语义精确等于 `build_codepulse_hook_command()`；JSON 原始输出中的反斜杠由 serializer 正确转义且重新解析后还原；TOML 单引号目录不破坏文档；输出 AST 不残留 `__CODEPULSE_BRIDGE_PATH__`；把该路径作为 `expected_bridge_path` 后，Exact 反向规范化产生的 CodePulse-only projection 等于母版 AST。加入源码门禁，原始 Fixture loader/Exact 代码不得出现 `raw.replace`、`actual_text.replace` 或等价文本路径替换。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests::states -- --nocapture
  Pop-Location
  ```

  预期：状态识别尚未实现，测试失败。

- [ ] **步骤 3：实现完整解析和只读事实提取**

  JSON 用 `serde_json::Value` 完整解析并保留未知字段；TOML 用 `toml_edit::DocumentMut` 只读遍历，同时接受 `command_windows`/`commandWindows`，但 Planner 标准输出只写 `command_windows`。`build_codepulse_hook_command()` 集中构造完整命令。JSON Fixture loader 先解析母版 Value，再只设置 CodePulse handler 的 `command`/`commandWindows` AST string；TOML loader 先解析 `DocumentMut`，再只设置 `command`/`command_windows` Value；需要目标字节时分别由 `serde_json`/`toml_edit` 序列化，禁止原始文本 replace或手工 escape。

  Feature parser 同时读取 `hooks`/`codex_hooks` 原始值并按固定矩阵生成内部事实，任何写路径都不得触碰两键。安全 handler 识别显式接收 `paths.installed_bridge`：先要求 command 类型、标准事件与 matcher 结构，再要求基础 command/Windows override 都逐字等于 `build_codepulse_hook_command(paths.installed_bridge)`；marker 参数缺失、额外参数、双 command 不一致、旧路径或其他 EXE 都不能进入 CodePulse-owned projection。Exact 把真实配置解析为 AST，只提取独立的安全 CodePulse groups 并反向规范化两个 command value，再把 CodePulse-only projection 与母版比较完整三层结构、事件集合、matcher 缺失规则、timeout 与禁止字段；不得比较完整用户配置，也不得只比较 Bridge 参数。混合用户 handler 的 group 标为 Modified，Repair 分离标准 CodePulse group 并保留用户 handler。`issues` 只包含稳定代码与中文短句，不含配置正文、token、完整命令或用户路径正文。只有旧别名的公开提示固定为“检测到旧版 codex_hooks 配置，请在 Codex 中改用 hooks。”

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests -- --nocapture
  Pop-Location
  ```

  预期：表示、feature、marker、Bridge、静态 JSON 边界与零副作用测试全部通过。

- [ ] **步骤 4：验证唯一路径消费并提交**

  运行：

  ```powershell
  rg -n 'join\("CodePulse"\)|join\("runtime"\)|join\("bin"\)' src-tauri/src/codex/integration
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  git diff --check
  ```

  预期：路径拼接搜索无命中；inspection 只消费 paths 字段；格式与 Clippy 通过。

  建议提交信息：

  ```text
  检测 Codex Hook 与 Bridge 集成事实
  ```

---

## 任务 2：纯派生 Listening Status 与 Runtime 启动决策

**独立交付物：** 相同 inspection/runtime facts 必然产生相同用户状态和 startup decision；显示偏好不参与决策。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/status.rs`
- Create: `src-tauri/src/codex/integration/status_tests.rs`

**消费接口：** 任务 1 静态 `CodexIntegrationInspection`、阶段二 `CodexListeningStatus`、`CodexRuntimeStartReason`、`CodexRuntimeStopReason` 与 manager 暴露的 generation facts。

**产生接口：**

```rust
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

pub enum CodexRuntimeStartupDecision {
    Start(CodexRuntimeStartReason),
    RemainStopped(CodexRuntimeStopReason),
}

pub fn inspect_codex_integration_state(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationInspection, CodexIntegrationError>;

pub fn derive_codex_listening_status(
    inspection: &CodexIntegrationInspection,
    runtime_facts: &CodexRuntimeFacts,
) -> CodexListeningStatus;

pub fn derive_startup_runtime_decision(
    inspection: &CodexIntegrationInspection,
) -> CodexRuntimeStartupDecision;
```

删除任何把动态 phase/hook state 合并回 Inspection 的 combine 接口。`inspect_codex_integration_state()` 只返回任务 1 的静态结构；`derive_codex_listening_status()` 是唯一动态派生函数。

- [ ] **步骤 1：先写七 phase 派生失败测试**

  表格覆盖：exact + runtimeGeneration=1 + authenticatedGeneration=1 + listening => running；exact + generation=1 + authenticatedGeneration=None => awaiting_trust；generation=1 已认证后 stop、generation=2 启动但 authenticatedGeneration=None => awaiting_trust；旧 generation=1 的认证事实与当前 generation=2 不相等时不得 running；modified、duplicate、Bridge missing/outdated 且 marker present => partial；Feature alias conflict、Feature 非布尔、解析/双表示冲突 => config_conflict；服务启动失败 => service_error；absent => not_installed；本地 disabled 与 managed disabled => disabled。managed disabled 仍由 inspection.hooksFeature 区分，设置页据此显示组织策略；只有旧别名但无冲突时按 effectiveState 进入 enabled/disabled 对应行为，同时保留弃用 Issue。

  再断言同一个 inspection 对象在 runtime facts 从 awaiting_trust 变 running 时保持值/序列化字节不变；只有 `CodexListeningStatus` 改变，证明 UI 不需要重新 inspect。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::status_tests::phase -- --nocapture
  Pop-Location
  ```

  预期：派生函数不存在，测试失败。

- [ ] **步骤 2：先写 startup decision 失败测试**

  覆盖 exact => Start(StartupInspection)；modified/duplicate/Bridge 非 Current 且 marker present => Start(StartupInspection)，对应 phase 由独立 listening 派生为 partial；not_installed、disabled、managed disabled、Feature alias conflict/非布尔、任意 representation conflict/ambiguous、已卸载 => RemainStopped(StartupInspectionDisallows)。无法安全识别 marker 或 Feature 冲突不得被派生为 partial。额外传入 idlePersistent=true/false 的 UI fixture，断言函数签名没有该参数且结果不变。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::status_tests::runtime -- --nocapture
  Pop-Location
  ```

  预期：startup decision 测试失败。

- [ ] **步骤 3：实现确定的优先级表**

  派生顺序固定为：服务 Error → service_error；feature ConfigConflict → config_conflict；feature Disabled/ManagedDisabled → disabled；representation Conflict/marker Ambiguous → config_conflict；entry Absent → not_installed；entry Modified/Duplicate 或 Bridge 非 Current → partial；entry Exact 且 runtimeGeneration 非 None、authenticatedGeneration 精确等于 runtimeGeneration、service listening → running；其余 Exact → awaiting_trust。self-check 成功不改变 generation 字段，因此不能 running。startup decision 只读 inspection 的 marker/entry/feature/representation/bridge 静态事实，不读取 phase、localStorage，不写文件，不调用 manager。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::status_tests -- --nocapture
  Pop-Location
  ```

  预期：七 phase 与所有 runtime start/stop 决策测试通过。

- [ ] **步骤 4：提交纯状态派生**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets -- -D warnings
  Pop-Location
  rg -n "localStorage|idlePersistent|ensure_started|stop_if_unused" src-tauri/src/codex/integration/status.rs
  git diff --check
  ```

  预期：纯状态模块没有 UI 偏好、I/O 或 manager 调用。

  建议提交信息：

  ```text
  派生 Codex 监听状态与启动决策
  ```

---

## 任务 3：生成不写盘的 Hook 变更计划与预览

**独立交付物：** install/repair/uninstall 对 JSON/TOML 产生确定的目标字节、摘要和警告；用户其他 Hook 语义完整保留；本地 disabled 禁止 install/repair，但有安全 marker 时仍可产生仅删除 CodePulse 条目的 uninstall plan。

**Files:**

- Modify: `src-tauri/src/codex/integration/mod.rs`
- Create: `src-tauri/src/codex/integration/hooks_json.rs`
- Create: `src-tauri/src/codex/integration/hooks_toml.rs`
- Create: `src-tauri/src/codex/integration/plan.rs`
- Create: `src-tauri/src/codex/integration/plan_tests.rs`

**消费接口：** 任务 1 inspection、`build_codepulse_hook_command()`、`load_codepulse_hook_fixture()`、`normalize_codepulse_hook_commands_for_exact(..., paths.installed_bridge.as_path())`、`codepulse-hooks-exact.json`/`.toml` 唯一母版、`paths.installed_bridge`、任务 2 runtime decision；不消费 writer/installer/runtime manager。Planner 和 Inspection 必须调用同一个 Fixture AST loader/反向规范化函数，禁止各自手写八事件模板或原始文本替换器。

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

pub struct PreparedConfigFileChange {
    pub path: PathBuf,
    pub expected_raw_digest: String,
    pub target_bytes: Vec<u8>,
    pub existed: bool,
}

pub struct PreparedCodexHookChange {
    pub preview: CodexHookChangePreview,
    pub files: Vec<PreparedConfigFileChange>,
}

pub fn prepare_codex_hook_change(
    action: CodexHookAction,
    paths: &CodexIntegrationPaths,
    inspection: &CodexIntegrationInspection,
) -> Result<PreparedCodexHookChange, CodexIntegrationError>;
```

稳定错误码至少包含 `HooksDisabled`、`ManagedDisabled`、`ConfigConflict`、`UseRepair`、`NoManagedEntry`。动作矩阵固定为：

| Hooks 状态 | Install | Repair | Uninstall |
|---|---|---|---|
| 本地 enabled | 允许 | 允许 | 允许 |
| 本地 disabled | `HooksDisabled` | `HooksDisabled` | representation 可安全解析、markerPresence=Present、managedEntry=Exact/Modified/Duplicate 时允许 |
| managed disabled | `ManagedDisabled` | `ManagedDisabled` | `ManagedDisabled` |
| conflict/ambiguous | `ConfigConflict` | `ConfigConflict` | `ConfigConflict` |

- [ ] **步骤 1：先写 JSON/TOML 语义保留失败测试**

  标准 JSON Fixture → Inspection=Exact；标准 TOML Fixture → Inspection=Exact。Planner 从空配置 Install 后，提取 CodePulse matcher 组并通过任务 1 的 AST 反向规范化函数传入 `paths.installed_bridge`，把两个已验证的 command value 改回占位符语义，CodePulse-only projection 必须等于对应标准 Fixture AST；Repair modified 配置后同样等于母版。JSON/TOML 都覆盖重复 install no-op、repair 缺项/旧路径/重复 marker、uninstall 精确删除安全 marker handler；TOML 另断言非 hooks 注释、键顺序、字符串和数组文本保持。两种表示都用预先保存的用户 handler AST 深度相等断言 Install/Repair 后用户节点不变，卸载不恢复备份。独立用户 matcher group 不进入 projection 且不影响 Exact；混合 matcher group 必须 Modified，Repair 保留其中用户 handler 并创建独立标准 CodePulse group。空格、中文和单引号路径必须重复跑 Install/Repair/Exact，证明三条路径使用同一 loader且目标字节可重新解析。

  负例逐项覆盖：八事件任一缺失 → Modified；timeout!=2 → Modified；其他 EXE+marker → 不识别为安全 Marker；旧 Bridge 路径 → Modified；基础 command/Windows override 任一个错误或缺失 → Modified；附加 `--extra` → Modified；参数缺少 `--codepulse-hook-v1` → 不识别为安全 Marker；出现 statusMessage → Modified；出现 async=true → Modified；UserPromptSubmit/Stop 写 matcher → 不等于母版；JSON/TOML 事件集合不同 → 测试失败。序列化快照直接来自两份母版的规范化 AST，不允许测试内再造第二套期望结构。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::representations -- --nocapture
  Pop-Location
  ```

  预期：planner 和文档变换器不存在，测试失败。

- [ ] **步骤 2：先写 local disabled action matrix 与企业禁用失败测试**

  固定覆盖：hooks=false + marker absent + install → HooksDisabled；hooks=false + marker present + repair → HooksDisabled；两者都不创建 PreparedCodexHookChange且文件系统不变。hooks=false + representation 可安全解析 + marker present + managedEntry exact → uninstall 成功产生只删除 CodePulse marker 的计划；modified/duplicate 也必须按 marker 精确删除并保留用户其他 handler；该计划 bridgeAction=Remove，不包含安装/更新 Bridge。hooks=false + marker absent/ambiguous 或 representation conflict → uninstall 分别返回 NoManagedEntry/ConfigConflict。用户手动把 config.toml 改为 hooks=true 后重新 inspect，才允许 install/repair preview。

  ManagedDisabled对install/repair/uninstall都返回ManagedDisabled，不产生修改计划，不引导写enterprise文件。增加Feature alias conflict（两个键相反、任一键非布尔）矩阵：install/repair/uninstall全部返回ConfigConflict，不产生`PreparedCodexHookChange`，target bytes/preview均不存在；CodePulse不猜测键优先级、不改写任何Feature键。只有旧别名或双键同值时，按effectiveState使用上述enabled/disabled矩阵并保留弃用/重复warning。本批次不引用installer/runtime；uninstall不启动HTTP、不安装Bridge的边界由04B-2 coordinator与04B-3命令测试覆盖。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::disabled -- --nocapture
  Pop-Location
  ```

  预期：旧行为若会计划修改 feature flag、全面禁止 local disabled uninstall，或允许 managed disabled 写入，该测试必须失败。

- [ ] **步骤 3：先写摘要、选择和 modified 失败测试**

  覆盖 none+install 选择 hooks.json；单一现有表示沿用；双表示/解析冲突拒绝；modified install 返回 UseRepair，显式 repair 才产生警告和计划；uninstall absent 返回 NoManagedEntry。相同输入 previewDigest 稳定，action、任一决策输入或 target hash 变化都会改变摘要；preview 不含用户 command、token、配置正文或 target bytes。`files` 在首版最多包含一个 Hook 主文件，不得为了开启全局 Hooks 加入 config.toml；writer 的多文件能力留给未来合法场景。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests::preview -- --nocapture
  Pop-Location
  ```

  预期：选择、modified 和摘要测试失败。

- [ ] **步骤 4：实现纯文档变换与确定摘要**

  JSON 规范化为 2 空格 UTF-8 without BOM 并在 warnings 说明空白变化；TOML 只用 toml_edit 节点增删。Install/Repair 只能从任务 1 唯一 Fixture loader 取得已经在 AST 中注入命令的 CodePulse matcher 组：JSON 使用 Value clone/merge后由 `serde_json` 序列化，TOML 使用 `toml_edit` Item/Value clone/merge后输出；不得对 `include_str!` 原始文本做 placeholder/path replace，不得复制事件常量数组或 handler builder。Exact/Repair/E2E 调用同一个反向规范化函数并显式传入 `paths.installed_bridge`。Repair 对混合 matcher group 只移出经期望路径验证的 CodePulse handler，原 group 的用户 handler 保持深度相等，再插入独立标准 group；不能把用户 handler 复制到 CodePulse projection。`expectedDigest` 覆盖 hooks.json、config.toml、requirements、`paths.integration_transaction_file` 的路径/存在性、打包/稳定 Bridge 与安装记录的路径、存在性和原始 SHA-256；`previewDigest` 覆盖 action、representation、expectedDigest、目标 path/hash、bridgeAction、changes/warnings 的规范 JSON。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::plan_tests -- --nocapture
  Pop-Location
  ```

  预期：配置保留、local disabled action matrix、managed disabled 拒绝、选择和摘要测试全部通过，测试前后无新增文件。

- [ ] **步骤 5：完成 04A 门禁并停止**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::status_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::plan_tests -- --nocapture
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets --all-features -- -D warnings
  Pop-Location
  rg -n "MoveFileExW|apply_codex_hook_change|CodexStatusSettingsCard|ensure_started\(" src-tauri/src/codex/integration src
  rg -n "build_codepulse_hook_command|serde_json.*Value|toml_edit::DocumentMut|normalize_codepulse_hook_commands_for_exact|expected_bridge_path" src-tauri/src/codex/integration
  rg -n "raw.*replace|actual_text.*replace|include_str!.*replace" src-tauri/src/codex/integration
  git diff --check
  git diff --name-only
  ```

  预期：TempDir inspection/planner 全部通过；AST 构造/规范化函数有命中，原始文本 replace 搜索无命中；范围搜索无 writer/installer/Tauri apply/Vue/runtime 调用；真实用户配置无写入。随后停止等待 04A review。

  建议提交信息：

  ```text
  生成 Codex Hook 安装修复纯计划
  ```

## 04A 完成门禁

- inspection 对用户与企业配置只读，路径全部来自 CodexIntegrationPaths；JSON 不含动态 hookState/phase。
- Inspection只声明用户层CodePulse Hook管理事实；不扫描仓库层/插件层，不修改企业托管配置，不输出无法可靠判断的全局唯一状态。跨层重复执行由阶段二Actor按事件级策略处理：稳定Tool/Subagent/Turn使用逻辑键，Session/Permission使用幂等状态规则；04A不承担运行时去重或提醒抑制。
- `features.hooks`/`features.codex_hooks` 原始事实、弃用/重复 Issue、同值/冲突/非布尔、representation、marker、Bridge、generation-aware ListeningStatus 和 runtime startup decision 有完整 TempDir 表格测试；冲突三动作无 Prepared change。
- `codepulse-hooks-exact.json` 与 `.toml` 完整定义相同八事件、command+Windows override、timeout=2、无 matcher/statusMessage/async；JSON 用 `serde_json` AST、TOML 用 `toml_edit` AST 注入 command。Exact 显式接收 `expected_bridge_path=paths.installed_bridge`，只有两个 command 都精确等于 expected command、参数无附加项且 matcher 结构标准时才进入 CodePulse-owned projection；wrong-path/old-path/单边 command/额外参数均非 Exact。空格、中文、单引号路径均可解析且语义正确；独立用户 group 不影响 Exact，混合 group 为 Modified且 Repair 后用户 handler 保留、CodePulse group 独立；Inspection、Planner Install、Repair、序列化快照、Duplicate/Modified 与 04C E2E 共用同一 loader，没有原始文本 replace或第二套模板。
- exact/modified/partial+marker 与停止条件精确；idlePersistent 不参与。
- 本地 disabled 的 install/repair 返回 HooksDisabled；安全 marker 的 uninstall 可生成精确删除计划；managed disabled 和 ambiguous conflict 全部只读。
- 用户其他 Hook 语义保留；modified 只能显式 Repair；无 writer、installer、Tauri apply 或 Vue UI。
- 全部通过后停止，未经review不得执行04B-1。
