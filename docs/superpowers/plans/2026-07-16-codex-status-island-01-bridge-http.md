# 阶段一：Codex Bridge、最小协议与本地 HTTP 接收器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 交付可独立构建且不弹控制台的 Windows GUI Subsystem Bridge、双方共用的版本化最小协议、仅回环且带启动令牌/完整 Discovery owner 的 HTTP 接收器，以及经过 Machine+Subsystem 校验后进入 Tauri 安装包的 Bridge 资源。

**架构：** Bridge 是由每次 Codex Hook 单独启动的短进程，不保存任务状态；它读取官方 Hook JSON、完成第一层脱敏/分类、读取发现文件并进行一次 HTTP POST。主应用 HTTP 层执行认证、限流、二次校验和有界入队，阶段一不启动聚合器，也不修改真实 Codex 配置。

**技术栈：** Cargo workspace、Rust 2021、serde、serde_json、getrandom 0.4、Windows API、Axum 0.8、Tokio、PowerShell、Tauri 2 resources。

**前置条件：** 从总体路线图开始实施；工作树只包含本功能明确授权的改动；阶段零基线 `pnpm run test` 为 206 项通过、`cargo test --lib` 为 62 项通过。若基线数字因已合并的合法提交变化，先记录新数字并确认失败不是本阶段引入。

**本阶段消费：** Codex 官方八种 Hook stdin、Windows 本地数据根目录、Tauri resource 目录、Codex Home、ProgramData 根目录和 Tauri 构建目标三元组。

**本阶段产生：** `codex_protocol::CodexBridgeEvent`、`CodexDiscovery`、`DiscoveryOwner`、`remove_discovery_if_owned()`、唯一的 `CodexIntegrationPaths`、`codex_event_channel()`、`start_codex_http()`、经过 PE/COFF Machine 与 Windows GUI Subsystem 校验的 `codepulse-codex-bridge.exe` 资源；阶段二只消费这些公开接口。

**固定边界：** 不创建自建 Dispatcher；Bridge 单次进程只转换并投递当前 Hook，用户已有 Hook 的编排与完整保留由 04A planner 负责。

---

## 任务 1：建立 Cargo workspace 与共享 wire 协议

**独立交付物：** 根应用和 Bridge 使用同一个 `codex-protocol` 包完成 JSON 序列化/反序列化，字段、枚举、长度和版本约束只有一份定义。

**Files:**

- Modify: `src-tauri/Cargo.toml`（现有 `[package]` 前新增 `[workspace]`；根包 dependencies/dev-dependencies 区域）
- Create: `src-tauri/crates/codex-protocol/Cargo.toml`
- Create: `src-tauri/crates/codex-protocol/src/lib.rs`
- Create: `src-tauri/crates/codex-protocol/src/limits.rs`
- Create: `src-tauri/crates/codex-protocol/src/wire.rs`
- Create: `src-tauri/crates/codex-protocol/tests/wire_contract.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/Cargo.toml`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/lib.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/main.rs`
- Modify: `src-tauri/Cargo.lock`（仅由 Cargo 生成）

**消费接口：** 总体路线图 3.1 的 wire/发现文件定义；当前 `src-tauri/Cargo.toml` 根包和 `src-tauri/Cargo.lock`。

**产生接口：** `codex_protocol::{CODEX_PROTOCOL_VERSION, CodexSource, CodexEventType, CodexStage, OperationResult, CodexBridgeEvent, CodexDiscovery, ProtocolError, validate_event, truncate_chars}`，以及 crate root 固定声明 `#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]` 的 Bridge 二进制目标 `codepulse-codex-bridge.exe`。

**接口约束：**

- `CODEX_PROTOCOL_VERSION: u16 = 1`。
- `CodexSource`、`CodexEventType`、`CodexStage`、`OperationResult` 和 `CodexBridgeEvent` 与总体路线图 3.1 完全一致。
- `CodexDiscovery` 与总体路线图 3.1 完全一致。
- wire JSON 字段使用 camelCase，枚举值使用 snake_case；所有时间都是 Unix 毫秒 `i64`。
- `validate_event(&CodexBridgeEvent) -> Result<(), ProtocolError>` 检查版本、必填字符串、枚举组合、时间非负、NUL/非空白控制字符和长度边界；eventId 固定为 16 个随机字节的 32 位小写十六进制。
- eventType/stage 组合固定为：SessionStarted/ToolFinished/SubagentStarted/SubagentFinished/TurnStopped 的 stage=None；TurnStarted=Analyzing；PermissionRequested=WaitingApproval；ToolStarted 只允许 Reading/Editing/RunningCommand/RunningTests。TurnStarted 必须有非空 taskSummary；ToolStarted 和 PermissionRequested 必须有非空 operationSummary，清理后为空时分别使用“执行工具”和“等待 Codex 授权”。Subagent 事件必须有 agentId，ToolStarted/ToolFinished 必须有 toolUseId，非 ToolFinished 的 operationResult 必须为 Unknown。
- `truncate_chars(value, max_chars)` 按 Unicode 标量值截断，不能在 UTF-8 字节中间切断。
- 常量固定为 `MAX_HTTP_BODY_BYTES = 16 * 1024`、`MAX_STDIN_BYTES = 64 * 1024`、`MAX_ID_CHARS = 256`、`MAX_PROJECT_NAME_CHARS = 120`、`MAX_CWD_CHARS = 2048`、`MAX_TASK_SUMMARY_CHARS = 120`、`MAX_OPERATION_SUMMARY_CHARS = 160`、`MAX_OUTPUT_CHARS = 300`、`MAX_ERROR_CHARS = 300`。

- [ ] **步骤 1：确认阶段基线并创建 workspace 壳层**

  运行：

  ```powershell
  git status --short
  pnpm run test
  Push-Location src-tauri
  cargo test --lib
  Pop-Location
  ```

  预期：工作树范围可解释；前端与 Rust 基线全部通过。随后在根 Cargo manifest 同时保留 `[package]` 并新增：

  ```toml
  [workspace]
  members = [".", "crates/codex-protocol", "crates/codepulse-codex-bridge"]
  resolver = "2"
  ```

  两个新包先只放可编译的空 `lib.rs`/`main.rs`；Bridge 包名固定为 `codepulse-codex-bridge`，二进制名因此固定为 `codepulse-codex-bridge.exe`。`main.rs` 第一项 crate attribute 必须是：

  ```rust
  #![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
  ```

  Windows 构建因此使用 GUI Subsystem；这不会关闭父进程显式提供的 stdin/stdout/stderr 管道，后续进程测试仍必须捕获三条管道。

- [ ] **步骤 2：先写协议失败测试**

  在 `wire_contract.rs` 写下列测试：完整样本的 JSON key/枚举快照；未知版本拒绝；空 `sessionId` 拒绝；eventId 不是 32 位小写十六进制拒绝；ID/项目名/cwd/五类摘要分别超限拒绝；恰好达到边界接受；NUL 和非空白控制字符拒绝；中文与 emoji 按字符而非字节截断；发现文件 token 必须为 64 位小写十六进制；`cwd` 可序列化但禁止出现 `transcriptPath`。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p codex-protocol --test wire_contract
  Pop-Location
  ```

  预期：编译因 `CodexBridgeEvent`、枚举、常量和校验函数尚不存在而失败；失败只来自新测试。

- [ ] **步骤 3：实现最小共享协议**

  `wire.rs` 只定义 DTO、serde 表示和 `ProtocolError`；`limits.rs` 只定义限制、字符计数和截断；`lib.rs` 明确 re-export 公共项。不要在该包加入 Tauri、HTTP、Hook 配置或聚合状态。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p codex-protocol --test wire_contract
  cargo check --workspace
  Pop-Location
  ```

  预期：协议测试全部通过；三个 workspace 成员编译通过；`Cargo.lock` 仍只有一份且位于 `src-tauri`。

- [ ] **步骤 4：格式、审查和提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p codex-protocol --all-targets -- -D warnings
  Pop-Location
  git diff --check
  git diff -- src-tauri/Cargo.toml src-tauri/crates/codex-protocol src-tauri/crates/codepulse-codex-bridge src-tauri/Cargo.lock
  ```

  预期：格式、Clippy 和 diff 检查通过；`main.rs` 包含唯一的 `windows_subsystem = "windows"` crate attribute；未出现 Tauri 或聚合器代码。

  建议提交信息：

  ```text
  构建 Codex Bridge 共享协议工作区
  ```

---

## 任务 2：按官方 Hook 字段实现解析、分类、摘要与来源识别

**独立交付物：** 给定八种官方 Hook JSON 和可注入的父进程链，Bridge 库稳定产出最小事件；禁止字段不会进入 wire DTO。

**Files:**

- Modify: `src-tauri/crates/codepulse-codex-bridge/Cargo.toml`（serde、serde_json、getrandom、windows、codex-protocol）
- Modify: `src-tauri/crates/codepulse-codex-bridge/src/lib.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/hook.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/classifier.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/sanitizer.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/source.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/hook_conversion.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/source_detection.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/fixtures/session-start.json`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/fixtures/user-prompt-submit.json`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/fixtures/pre-tool-use.json`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/fixtures/permission-request.json`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/fixtures/post-tool-use.json`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/fixtures/subagent-start.json`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/fixtures/subagent-stop.json`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/fixtures/stop.json`
- Modify: `src-tauri/Cargo.lock`（仅由 Cargo 生成）

**消费接口：** 任务 1 的共享 DTO/限制；官方公共字段 `session_id`、`transcript_path`、`cwd`、`hook_event_name`、`model`、`permission_mode`，事件字段 `turn_id`、`prompt`、`tool_name`、`tool_use_id`、`tool_input`、可选 `tool_input.description`、`tool_response`、`agent_id`、`agent_type`、`agent_transcript_path`、`stop_hook_active`、`last_assistant_message`。

**产生接口：**

```rust
pub trait ProcessChainProvider {
    fn ancestor_image_names(&self) -> Vec<String>;
}

pub fn convert_hook(
    input: &[u8],
    occurred_at: i64,
    process_chain: &dyn ProcessChainProvider,
) -> Result<CodexBridgeEvent, BridgeError>;
```

`transcript_path` 与 `agent_transcript_path` 只为兼容输入而读取后丢弃。`tool_input` 和 `tool_response` 只能在局部解析函数中提取允许的短摘要，不能保存在任何输出结构中；PermissionRequest 优先使用清理后的 `tool_input.description`，字段缺失时才根据命令生成授权摘要。

- [ ] **步骤 1：实施当天再次核对官方文档和本机字段边界**

  运行：

  ```powershell
  Start-Process 'https://developers.openai.com/codex/hooks/'
  Get-Content -LiteralPath "$env:USERPROFILE\.codex\config.toml" -Encoding utf8
  Test-Path -LiteralPath "$env:USERPROFILE\.codex\hooks.json"
  ```

  预期：文档仍列出计划中的八个事件与字段；本机读取仅用于确认表示方式，不复制 Token、路径正文或其他用户配置到 fixture。若官方字段发生破坏性变化，停止本任务，先同步修改总体路线图和本计划，再继续。

- [ ] **步骤 2：先写八事件和禁止字段失败测试**

  fixture 只包含虚构路径、虚构 Token 和短文本。测试必须覆盖：

  - `SessionStart` 产生 `SessionStarted` 且 `stage = None`；
  - `UserPromptSubmit` 产生 `TurnStarted/analyzing`，去掉代码块、日志、绝对路径、查询参数和礼貌开头；
  - 读/搜工具映射 `reading`，`apply_patch`/Edit/Write 映射 `editing`；
  - `pnpm test`、被观察项目的 `npm test`、vitest、cargo test、pytest、mvn test、gradle test 映射 `running_tests`；构建/Lint/类型检查映射 `running_command` 并保留脱敏动作；
  - `PermissionRequest` 映射 `waiting_approval`，有 `tool_input.description` 时优先使用，无该字段时安全降级；
  - `PostToolUse` 只输出 `success/failed/unknown` 和最多 300 字符摘要；
  - 子智能体事件只携带 `agentId`；`agent_transcript_path` 与子智能体最终正文被丢弃；Stop 只把脱敏后的 `last_assistant_message` 放入 `latestOutput`，保持 `operationResult=unknown`、`errorSummary=null`，本任务不判最终失败；
  - 序列化结果不包含 `transcript_path`、`agent_transcript_path`、完整 `tool_input`/`tool_response`、Authorization、密码、环境变量值、Base64 正文、代码块或完整提示词。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p codepulse-codex-bridge --test hook_conversion
  cargo test -p codepulse-codex-bridge --test source_detection
  Pop-Location
  ```

  预期：因 `convert_hook()`、分类器和来源接口不存在而失败。

- [ ] **步骤 3：实现可测试的纯转换管线**

  `hook.rs` 先把 stdin 解析为 `serde_json::Value`，再按 `hook_event_name` 提取已确认字段；事件名未知或必填字段缺失返回错误。`sanitizer.rs` 固定执行路径/秘密/URL 查询/代码块/Base64/重定向正文清理和字符裁剪；用户提示清理后为空时 taskSummary 使用“Codex 任务”。`classifier.rs` 用表驱动识别工具名与命令首段，不执行 shell、不展开变量。项目名使用 `Path::file_name(cwd)`，无法提取时为“未知项目”。

  `source.rs` 的生产实现用 Windows ToolHelp 快照读取祖先进程名：祖先链出现 `ChatGPT.exe` 为 `app`；否则出现 `codex.exe` 为 `cli`；查询失败或都未命中为 `unknown`。所有 Win32 `unsafe` 块添加中文安全前提，句柄通过 RAII 或显式关闭。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p codepulse-codex-bridge --test hook_conversion
  cargo test -p codepulse-codex-bridge --test source_detection
  Pop-Location
  ```

  预期：八事件、分类、脱敏、字符边界和 `app/cli/unknown` 来源测试全部通过。

- [ ] **步骤 4：验证输出最小化并提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p codepulse-codex-bridge --all-targets -- -D warnings
  Pop-Location
  rg -n "transcript_path|tool_input|tool_response" src-tauri/crates/codepulse-codex-bridge/src
  git diff --check
  ```

  预期：前三个官方原始字段只出现在输入解析/局部提取区域，不出现在共享输出 DTO 或持久化代码；所有检查通过。

  建议提交信息：

  ```text
  实现 Codex Hook 最小事件转换
  ```

---

## 任务 3：实现任何失败都静默成功的单次 Bridge 进程

**独立交付物：** Windows GUI Subsystem 的 `codepulse-codex-bridge.exe` 在成功、无服务、非法输入、超限、发现文件损坏、HTTP 超时、服务拒绝和内部 panic 下都能通过重定向管道读取 stdin，并严格向 stdout 写 `{}`、stderr 为空、退出码为 0；一次调用最多发送一次请求且不创建可见控制台窗口。

**Files:**

- Modify: `src-tauri/crates/codepulse-codex-bridge/src/lib.rs`
- Modify: `src-tauri/crates/codepulse-codex-bridge/src/main.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/client.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/discovery.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/src/run_once.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/process_contract.rs`
- Create: `src-tauri/crates/codepulse-codex-bridge/tests/http_delivery.rs`

**消费接口：** `convert_hook()`、`CodexDiscovery`、固定发现文件 `%LOCALAPPDATA%\CodePulse\runtime\codex-bridge.json`。

**产生接口：**

```rust
pub trait BridgeClock {
    fn now_ms(&self) -> i64;
    fn elapsed(&self) -> Duration;
}

pub fn run_once(
    stdin: impl Read,
    discovery_path: &Path,
    process_chain: &dyn ProcessChainProvider,
    clock: &dyn BridgeClock,
) -> Result<(), BridgeError>;
```

`main()` 是失败封闭边界：安装不输出 panic 的 hook，`catch_unwind` 包围 `run_once`，最后无条件只写两个字节 `{}` 并返回 0。库函数可以返回结构化错误，但生产二进制不打印错误。

- [ ] **步骤 1：先写进程黑盒失败测试**

  使用 `CARGO_BIN_EXE_codepulse-codex-bridge` 和 `std::process::Command` 启动真实 GUI Subsystem 子进程；每例都显式设置 `stdin(Stdio::piped())`、`stdout(Stdio::piped())`、`stderr(Stdio::piped())`，向 stdin 写入 Hook JSON 后关闭写端。用 `--codepulse-hook-v1` 逐项输入：合法事件且 CodePulse 未运行、空 stdin、非法 JSON、65 KiB stdin、发现文件非法 JSON、错误版本、零端口、非十六进制 token、已退出 PID、连接拒绝、服务器挂起；每例断言 `stdout == b"{}"`、`stderr.is_empty()`、`status.code() == Some(0)`。库单元测试把会 panic 的闭包注入 `run_guarded()`，断言 panic 被转换为静默结果。另以 `--codepulse-self-check` 启动，仍使用三条 piped stream，断言不读 stdin/发现文件、1 秒内返回相同 `{}`/空 stderr/0 契约；无参数或未知参数也直接返回且不投递。

  同一测试读取构建产物 PE metadata，断言 Subsystem 为 `IMAGE_SUBSYSTEM_WINDOWS_GUI`；源码门禁读取 `src/main.rs`，断言 crate root 包含 `windows_subsystem = "windows"`。这样测试同时证明 GUI Subsystem 不破坏重定向管道协议。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p codepulse-codex-bridge --test process_contract -- --nocapture
  Pop-Location
  ```

  预期：二进制当前没有失败封闭行为，测试失败。

- [ ] **步骤 2：先写单次投递与期限失败测试**

  `http_delivery.rs` 启动一次性回环测试服务，断言请求方法、路径、Bearer token、Content-Type、Content-Length 与事件 JSON；服务器计数器必须为 1。使用可注入时钟/测试 transport 验证连接超时固定 150 毫秒、总预算固定 250 毫秒、HTTP 非 202 不重试；真实“端口无人监听”黑盒用例允许调度余量但必须在 1 秒内退出。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p codepulse-codex-bridge --test http_delivery -- --nocapture
  Pop-Location
  ```

  预期：因 discovery/client/deadline 尚未实现而失败。

- [ ] **步骤 3：实现受限 stdin、发现文件和一次 POST**

  读取 stdin 时最多取 `MAX_STDIN_BYTES + 1`；超限立即返回。发现文件最多读取 4 KiB，校验版本、非零端口、64 位 token、PID 仍存活；PID 检查失败即快速退出。HTTP 客户端使用 `TcpStream::connect_timeout(150ms)`，读写 timeout 取总预算剩余值；只连接 `127.0.0.1`，手工构造不含用户正文的最小 HTTP/1.1 请求，不处理重定向、不重试。

  `main()` 保留 crate root GUI Subsystem attribute，只识别 `--codepulse-hook-v1` 和维护参数 `--codepulse-self-check`：前者执行 `run_once`，后者只走启动契约检查，无参数或其他参数不读取 stdin/发现文件并直接结束。维护参数不读取/写入配置、发现文件或事件。GUI Subsystem 下仍直接使用父进程提供的标准流句柄；`main()` 不使用 `println!`，防止额外换行，只调用 `stdout().write_all(b"{}")`。任何测试注入的 panic 也由最外层捕获；panic hook 在进程范围内临时替换为空 hook，结束前恢复仅用于库测试，生产进程随后退出。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p codepulse-codex-bridge --test process_contract -- --nocapture
  cargo test -p codepulse-codex-bridge --test http_delivery -- --nocapture
  cargo test -p codepulse-codex-bridge
  Pop-Location
  ```

  预期：所有黑盒输出、退出码、单次发送和期限测试通过；CodePulse 未运行时快速静默退出。

- [ ] **步骤 4：验证无状态/无日志并提交**

  运行：

  ```powershell
  rg -n "retry|println!|eprintln!|transcript|history|OpenOptions" src-tauri/crates/codepulse-codex-bridge/src
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p codepulse-codex-bridge --all-targets -- -D warnings
  Pop-Location
  git diff --check
  ```

  预期：没有重试、事件历史或生产日志；crate root GUI Subsystem attribute 存在；若 `OpenOptions` 仅用于读取发现文件，应由代码差异直接证明没有写事件。

  建议提交信息：

  ```text
  构建静默失败的 Codex Bridge 进程
  ```

---

## 任务 4：实现安全的回环 HTTP 服务、动态端口与发现文件

**独立交付物：** 一个不依赖 Tauri UI 的可启动服务：固定端口优先、仅冲突时动态降级、随机令牌、发现文件原子写入、请求安全校验、有界入队、显式关闭和异常清理。

**Files:**

- Modify: `src-tauri/Cargo.toml`（新增 `axum = "0.8"`、`getrandom = "0.4"`、`codex-protocol`；dev 新增 `tempfile = "3"`）
- Modify: `src-tauri/src/lib.rs`（只声明 `mod codex;`，不在 `setup` 启动服务）
- Create: `src-tauri/src/codex/mod.rs`
- Create: `src-tauri/src/codex/paths.rs`
- Create: `src-tauri/src/codex/paths_tests.rs`
- Create: `src-tauri/src/codex/intake.rs`
- Create: `src-tauri/src/codex/runtime.rs`
- Create: `src-tauri/src/codex/sanitizer.rs`
- Create: `src-tauri/src/codex/server.rs`
- Create: `src-tauri/src/codex/runtime_tests.rs`
- Create: `src-tauri/src/codex/server_tests.rs`
- Modify: `src-tauri/Cargo.lock`（仅由 Cargo 生成）

**消费接口：** `CodexBridgeEvent`、`CodexDiscovery`、共享限制与 `validate_event()`；调用方传入的 `local_data_root`、`resource_dir`、`codex_home` 和 `program_data` 都是已经解析的绝对 `PathBuf`。

**产生接口：**

```rust
pub const CODEX_EVENT_QUEUE_CAPACITY: usize = 256;
pub type CodexEventSender = tokio::sync::mpsc::Sender<CodexBridgeEvent>;
pub type CodexEventReceiver = tokio::sync::mpsc::Receiver<CodexBridgeEvent>;
pub fn codex_event_channel() -> (CodexEventSender, CodexEventReceiver);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodexIntegrationPaths {
    pub codepulse_root: PathBuf,
    pub runtime_dir: PathBuf,
    pub discovery_file: PathBuf,
    pub integration_transaction_file: PathBuf,
    pub bin_dir: PathBuf,
    pub installed_bridge: PathBuf,
    pub install_record: PathBuf,
    pub packaged_bridge: PathBuf,
    pub codex_home: PathBuf,
    pub hooks_json: PathBuf,
    pub config_toml: PathBuf,
    pub requirements_toml: PathBuf,
}

impl CodexIntegrationPaths {
    pub fn from_local_data_root(
        local_data_root: PathBuf,
        resource_dir: PathBuf,
        codex_home: PathBuf,
        program_data: PathBuf,
    ) -> Self;
}

pub struct CodexHttpHandle {
    pub discovery: CodexDiscovery,
    pub discovery_owner: DiscoveryOwner,
    pub using_fallback_port: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscoveryOwner {
    pub version: u16,
    pub pid: u32,
    pub token: String,
    pub started_at: i64,
}

pub enum DiscoveryRemovalOutcome {
    Removed,
    AlreadyAbsent,
    ReplacedByNewRuntime,
}

pub fn remove_discovery_if_owned(
    path: &Path,
    owner: &DiscoveryOwner,
) -> Result<DiscoveryRemovalOutcome, CodexServerError>;

pub async fn start_codex_http(
    paths: &CodexIntegrationPaths,
    event_tx: CodexEventSender,
) -> Result<CodexHttpHandle, CodexServerError>;

impl CodexHttpHandle {
    pub fn stop_accepting(&self);
    pub fn invalidate_discovery(&self) -> Result<(), CodexServerError>;
    pub async fn wait(self) -> Result<(), CodexServerError>;
    pub async fn shutdown(self) -> Result<(), CodexServerError>;
}
```

实现体可在 handle 中私有保存 acceptance cancel、发现文件所有权和 join handle；公开结构不暴露 Axum/Tokio 内部类型。`shutdown()` 是阶段一测试使用的便利方法，内部依次调用 stop/invalidate/wait；阶段二退出协调器使用三个分步方法满足确定的关闭顺序。

- [ ] **步骤 1：先写路径对象与 runtime 失败测试**

  在 `paths_tests.rs` 用四个互不相关的 TempDir 根构造 `CodexIntegrationPaths`，逐项断言：`codepulse_root = local_data_root/CodePulse`；runtime、发现文件和统一 Integration Transaction 文件都在 `runtime` 下；`integration_transaction_file` 精确为 `runtime/codex-integration-transaction.json`；稳定 Bridge 和安装记录都在 `bin` 下；打包资源只从 `resource_dir/bin` 推导；用户配置只从 `codex_home` 推导；企业要求只从 `program_data/OpenAI/Codex` 推导。传入的本地数据根目录名即使不是 `AppData` 也必须原样生效，所有字段都不得包含 bundle identifier `com.ryen.nsd`。

  在 `runtime_tests.rs` 使用同一个路径对象和可注入的 `RuntimeFacts { pid, started_at }` 覆盖：令牌恰好 32 随机字节/64 hex；发现文件精确写入 `paths.discovery_file`；handle/guard 保存由该文件完整转换的 `DiscoveryOwner`；临时文件与目标同目录；写入完成后没有临时残留；覆盖旧文件；模拟替换失败保留旧文件；handle 正常 shutdown 删除自己文件；服务任务错误退出也只删除自己文件；固定端口占用时得到非 47653 的回环端口；非 `AddrInUse` 绑定错误不降级。

  增加 owner 竞态矩阵：Runtime A 写 discovery A，Runtime B 原子替换为 discovery B，随后 A 的 invalidate/serve error/drop 都返回 `ReplacedByNewRuntime` 且 B 文件仍存在；相同 PID/startedAt 但 token 不同不得删除；相同 PID/token 但 version 或 startedAt 不同不得删除；文件不存在返回 `AlreadyAbsent`；文件损坏时旧 Guard 返回稳定错误且不得无条件删除。所有删除入口都必须能从测试记录中证明调用了 `remove_discovery_if_owned()`。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::paths_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::runtime_tests -- --nocapture
  Pop-Location
  ```

  预期：`CodexIntegrationPaths`、runtime 和服务接口不存在，测试编译失败；失败只来自本任务的新测试。

- [ ] **步骤 2：先写 HTTP 集成失败测试**

  通过真实 `127.0.0.1` socket 覆盖：正确请求返回 202 且 receiver 得到相同事件；错误/缺失 token 为 401；旧启动 token 在重启后为 401；错误版本/字段为 422；JSON 语法为 400；超过 16 KiB 为 413；错误 Content-Type 为 415；错误路径为 404；错误方法为 405；填满 256 容量后为 429；接收端关闭为 503；并发不同 session 全部入队；服务端二次清理超长/敏感摘要；响应与诊断日志不回显正文。

  为“仅回环”写两层断言：实际 listener 地址必须是 `127.0.0.1`；把非回环 `SocketAddr` 注入 router service 时必须拒绝。不要尝试修改防火墙或开放真实网卡。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::server_tests -- --nocapture
  Pop-Location
  ```

  预期：路由、认证和有界入队尚未实现，测试失败。

- [ ] **步骤 3：实现唯一的路径对象**

  `paths.rs` 是整个功能唯一允许拼接 `CodePulse`、`runtime`、`bin` 目录名的模块。构造函数必须精确生成：

  ```text
  <local_data_root>\CodePulse\bin\codepulse-codex-bridge.exe
  <local_data_root>\CodePulse\bin\codepulse-codex-bridge.install.json
  <local_data_root>\CodePulse\runtime\codex-bridge.json
  <local_data_root>\CodePulse\runtime\codex-integration-transaction.json
  <resource_dir>\bin\codepulse-codex-bridge.exe
  <codex_home>\hooks.json
  <codex_home>\config.toml
  <program_data>\OpenAI\Codex\requirements.toml
  ```

  HTTP runtime、阶段二 manager、04A inspection/planner、04B writer/installer/startup/commands/self-check 与 04C E2E/范围脚本必须持有或借用该对象，不得接收裸 `runtime_dir`、`bin_dir` 后再次拼接。只有 `paths.rs` 可以拼接 `codex-integration-transaction.json`；其他模块只读取 `paths.integration_transaction_file`。本任务不调用 Tauri path API；把根目录解析留给 Tauri 组装层。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::paths_tests -- --nocapture
  Pop-Location
  ```

  预期：所有字段从四个传入根目录精确推导；不存在 bundle identifier 或工作目录依赖。

- [ ] **步骤 4：实现固定端口、原子发现文件和清理 guard**

  先绑定 `127.0.0.1:47653`；只有 `io::ErrorKind::AddrInUse` 才绑定 `127.0.0.1:0`。绑定成功后生成 token，再把发现文件写到临时文件、flush、重新读取反序列化验证，最后通过 Windows `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` 原子替换。Win32 块写中文安全注释，保证 UTF-16 缓冲区在调用期间存活。

  `DiscoveryGuard` 由实际 server task 持有，并保存 `paths.discovery_file` 与本 Runtime 完整 `DiscoveryOwner`。正常 shutdown、handle invalidate、serve 错误和 task drop 都只调用 `remove_discovery_if_owned(path, owner)`：文件不存在返回 AlreadyAbsent；完整 version/PID/token/startedAt 相等才删除；任一字段不同返回 ReplacedByNewRuntime 并保持文件；读取或解析失败由旧 Guard 返回错误且不盲删。发现文件写入失败时立即释放 listener 并返回错误，不留下一个 Bridge 无法认证的服务。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::paths_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::runtime_tests -- --nocapture
  Pop-Location
  ```

  预期：固定/动态端口、发现文件原子替换、写入失败释放 listener、A/B Runtime 替换、相同 PID 不同 token、损坏文件和全部 owner-aware 清理路径测试通过；HTTP router 测试仍保持红色，留给下一步实现。

- [ ] **步骤 5：实现认证、限制、二次脱敏和 try_send**

  Axum router 只注册 `POST /v1/codex/events`；先检查 ConnectInfo 回环、Bearer token、Content-Type 和 Content-Length，再用 `DefaultBodyLimit::max(16 * 1024)` 读取 JSON。反序列化后调用 `validate_event()` 和服务端 `sanitize_event()`；后者再次裁剪并移除秘密/路径片段，且不记录正文。

  使用 `event_tx.try_send(event)`：成功立即 202，`Full` 为 429，`Closed` 为 503 并只记录错误码。诊断日志字段限定为事件类型、接收时间、协议版本、状态码、错误码；测试 logger 捕获输出并断言不含摘要、cwd 或 token。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::runtime_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::server_tests -- --nocapture
  cargo test -p netspeed-dynamic --lib
  Pop-Location
  ```

  预期：runtime、HTTP 和现有 62 项基线测试全部通过；新增测试不使用真实睡眠等待端口或超时。

- [ ] **步骤 6：静态检查与提交**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo fmt --all --check
  cargo clippy -p netspeed-dynamic --all-targets --all-features -- -D warnings
  Pop-Location
  rg -n "0\.0\.0\.0|transcript_path|tool_input|tool_response" src-tauri/src/codex
  rg -n 'join\("CodePulse"\)|join\("runtime"\)|join\("bin"\)' src-tauri/src/codex --glob '!paths.rs' --glob '!paths_tests.rs'
  git diff --check
  ```

  预期：不存在 `0.0.0.0` 绑定；原始 Hook 字段不进入主应用模块；目录名拼接只在 `paths.rs` 和路径测试中出现；所有检查通过。

  建议提交信息：

  ```text
  添加 Codex 本地事件接收服务
  ```

---

## 任务 5：把 Bridge 作为 Windows 资源随 Tauri 构建

**独立交付物：** `pnpm run tauri build` 会先为当前 Windows MSVC target 构建 GUI Subsystem Bridge，把固定文件名暂存，并在 Machine+Subsystem 完整验证后作为 `bin/codepulse-codex-bridge.exe` 资源交给 Tauri bundler；该阶段不把资源复制到用户稳定路径。

**Files:**

- Modify: `package.json`（`scripts` 区域新增 `build:codex-bridge`；不新增 JS 包）
- Modify: `src-tauri/tauri.conf.json`（`build.beforeBuildCommand`、`bundle.resources`）
- Modify: `src-tauri/build.rs`（把 Cargo `TARGET` 固定注入 `CODEPULSE_TARGET_TRIPLE`）
- Modify: `.gitignore`（忽略 `src-tauri/binaries/codepulse-codex-bridge.exe`）
- Create: `scripts/build-codex-bridge.ps1`
- Create: `scripts/verify-codex-bridge-resource.ps1`
- Create: `scripts/test-codex-bridge-resource-validation.ps1`

**消费接口：** workspace 中 `codepulse-codex-bridge` 二进制；Tauri 的 `TAURI_ENV_TARGET_TRIPLE`。

**产生接口：** 构建期 `src-tauri/binaries/codepulse-codex-bridge.exe`；安装包资源相对路径 `bin/codepulse-codex-bridge.exe`；主应用编译期常量 `env!("CODEPULSE_TARGET_TRIPLE")`。04B 只通过 `CodexIntegrationPaths.packaged_bridge` 读取资源，不读取 Cargo target 目录。

- [ ] **步骤 1：先写资源验证失败脚本**

  `verify-codex-bridge-resource.ps1` 固定参数为 `-ResourcePath <path>`、`-TargetTriple <triple>` 和可选 `-SkipTauriConfigCheck`。脚本必须：读取至少 64 字节 DOS Header；校验 `MZ`；从偏移 `0x3C` 读取 little-endian `e_lfanew`；验证该偏移非负且 COFF/Optional Header 均在文件范围内；校验四字节 `PE\0\0`；从 `e_lfanew + 4` 读取 little-endian COFF `Machine`；读取 COFF `SizeOfOptionalHeader`；从 `e_lfanew + 24` 读取 Optional Header Magic 并只接受 Windows x64/ARM64 的 PE32+ `0x20B`；要求 Optional Header 至少覆盖偏移 68 的两字节 Subsystem；读取 Subsystem 并只接受 `IMAGE_SUBSYSTEM_WINDOWS_GUI = 2`。目标 Machine 映射固定为 `x86_64-pc-windows-msvc -> 0x8664`、`aarch64-pc-windows-msvc -> 0xAA64`；Console Subsystem=3、未知 Subsystem、非法 Magic、Optional Header 太短和其他 triple 直接失败。未跳过配置检查时，还要验证 resources 映射与 `beforeBuildCommand`。

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-bridge-resource.ps1 -ResourcePath .\src-tauri\binaries\codepulse-codex-bridge.exe -TargetTriple x86_64-pc-windows-msvc
  ```

  预期：脚本以非 0 退出，并明确报告暂存资源尚不存在、PE 签名/Machine/Optional Header/Subsystem 不合法或配置尚未接线；只看见 `MZ` 或 Machine 匹配不得判定通过。

- [ ] **步骤 2：实现目标感知构建脚本和 pnpm 接线**

  `build-codex-bridge.ps1` 使用 `$ErrorActionPreference = 'Stop'`，并用 `Split-Path $PSScriptRoot -Parent` 得到 `$repoRoot`，不依赖调用者当前目录。优先读取 `$env:TAURI_ENV_TARGET_TRIPLE`，为空时从 `rustc -vV` 的 `host:` 行取得 target；只接受 `x86_64-pc-windows-msvc` 和 `aarch64-pc-windows-msvc`。执行：

  ```powershell
  cargo build --manifest-path "$repoRoot\src-tauri\Cargo.toml" -p codepulse-codex-bridge --release --target $target
  ```

  构建前删除旧的暂存文件；构建后只能从 `$repoRoot\src-tauri\target\$target\release\codepulse-codex-bridge.exe` 复制到 `$repoRoot\src-tauri\binaries\codepulse-codex-bridge.exe`，随即调用资源验证脚本并传入同一个 `$target`。文件修改时间不再作为架构或目标正确性的证据。

  `src-tauri/build.rs` 在调用 `tauri_build::build()` 前读取 Cargo 提供的 `TARGET`，只接受上述两个 triple，并输出 `cargo:rustc-env=CODEPULSE_TARGET_TRIPLE=<target>`；04B installer 使用同一编译期字符串验证打包资源架构。

  `package.json` 新增：

  ```json
  "build:codex-bridge": "powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/build-codex-bridge.ps1"
  ```

  `tauri.conf.json` 将 `beforeBuildCommand` 固定为 `pnpm run build:codex-bridge && pnpm run build`，resources 使用对象映射。这里不使用 `externalBin`，因为 Bridge 不由 Tauri 作为 sidecar 常驻启动。

  运行：

  ```powershell
  pnpm run build:codex-bridge
  Get-Item -LiteralPath .\src-tauri\binaries\codepulse-codex-bridge.exe | Select-Object FullName,Length,LastWriteTimeUtc
  ```

  预期：命令以 0 退出；暂存文件存在、长度大于 0，且 DOS Header、PE 签名、COFF Machine 与目标 triple 一致，Optional Header Subsystem 为 WindowsGui。

- [ ] **步骤 3：运行 PE 架构失败矩阵**

  `test-codex-bridge-resource-validation.ps1` 在独立临时目录生成最小字节 fixture，并逐项启动验证脚本：只有 `MZ` 但 `e_lfanew` 越界；`MZ` 合法但没有 `PE\0\0`；x64 triple 配 ARM64 Machine；ARM64 triple 配 x64 Machine；Optional Header 太短；PE Magic 非 0x20B；x64+Console Subsystem；ARM64+Console Subsystem；未知 Subsystem；不支持的 triple；在 x64 与 ARM64 旧 target 目录同时放 EXE 后确认构建路径选择只读取本次 `$target` 目录。每个负例都必须断言子进程退出码非 0；x64+WindowsGui 和 ARM64+WindowsGui 两个正例退出码为 0。

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-codex-bridge-resource-validation.ps1
  ```

  预期：全部 Machine/Magic/长度/Subsystem 错误场景均被拒绝；x64/ARM64+WindowsGui 匹配场景通过；旧 target 目录不会被误复制。

- [ ] **步骤 4：运行构建和资源红绿验证**

  运行：

  ```powershell
  pnpm run build:codex-bridge
  $target = if ($env:TAURI_ENV_TARGET_TRIPLE) { $env:TAURI_ENV_TARGET_TRIPLE } else { ((rustc -vV | Select-String '^host:').Line -replace '^host:\s*', '') }
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-bridge-resource.ps1 -ResourcePath .\src-tauri\binaries\codepulse-codex-bridge.exe -TargetTriple $target
  pnpm run build
  Push-Location src-tauri
  cargo test --workspace
  Pop-Location
  ```

  预期：Bridge 发布 EXE 被暂存；验证脚本输出资源映射通过；前端构建和整个 Cargo workspace 测试通过。

- [ ] **步骤 5：执行 Tauri bundle 验收**

  运行：

  ```powershell
  pnpm run tauri build
  Get-ChildItem -LiteralPath .\src-tauri\target\release\bundle -Recurse -File | Select-Object FullName,Length
  git status --short
  ```

  预期：Tauri bundler 完成至少一个 Windows 安装包；解包或资源目录检查确认 EXE 的 PE Machine 与当前 `CODEPULSE_TARGET_TRIPLE` 一致且 Subsystem=WindowsGui；资源缺失、架构错误或 Console Subsystem 不会被 bundler 静默忽略；暂存 EXE 因 `.gitignore` 不出现在 `git status`。

- [ ] **步骤 6：阶段一全量验证并提交**

  运行：

  ```powershell
  pnpm run test
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-codex-bridge-resource-validation.ps1
  Push-Location src-tauri
  cargo test --workspace
  cargo fmt --all --check
  cargo clippy --workspace --all-targets --all-features -- -D warnings
  Pop-Location
  git diff --check
  git diff --name-only
  ```

  预期：前端基线、所有新 Rust 测试、格式、类型和 Clippy 全部通过；变更文件仅限本阶段清单；没有 `package-lock.json`、`yarn.lock`、真实 Codex 配置、事件日志或历史数据。

  建议提交信息：

  ```text
  将 Codex Bridge 纳入 Tauri 安装资源
  ```

## 阶段一完成门禁

- `CodexBridgeEvent` 与发现文件契约只在共享包定义一次。
- `CodexIntegrationPaths` 是唯一目录构造对象；所有路径从传入根目录推导，功能模块不再自行拼接 CodePulse/runtime/bin。
- 八种 Hook fixture 与实施日官方文档一致；未知字段安全忽略，未知事件明确拒绝。
- Bridge crate root 使用 `windows_subsystem = "windows"`；所有 GUI Subsystem piped 黑盒失败路径精确输出 `{}`、stderr 为空、退出 0，且没有重试、状态落盘或可见控制台窗口。
- HTTP 服务只绑定回环地址；固定端口仅在冲突时降级；每次启动 token 不同；所有发现文件清理比较完整 DiscoveryOwner，旧 Runtime/相同 PID 不同 token/损坏文件不会误删新文件。
- 16 KiB、认证、协议、字段、队列与日志安全测试通过。
- 构建脚本和资源验证都校验 DOS Header、PE 签名、x64/ARM64 COFF Machine、Optional Header Magic/长度和 WindowsGui Subsystem；Console/未知 Subsystem、不支持 triple 与错架构资源必定失败。
- Tauri bundle 构建已消费 Bridge resource；尚未修改用户 Hook，也尚未在 `setup` 启动服务。
- 以上全部满足后才执行阶段二；不要自动进入阶段二。
