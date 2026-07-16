# Codex 实时状态灵动岛总体实施路线图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在不控制 Codex、不保存项目内容且不破坏用户现有 Hook 的前提下，为 Windows 原生 Codex CLI 与 Codex App 提供可安装、可升级、可卸载的实时状态灵动岛。

**架构：** 单次运行的 `codepulse-codex-bridge.exe` 把官方 Hook 输入转换为最小事件并投递到仅回环监听的 Rust HTTP 服务；单线程 Actor 以可注入时钟维护全部会话；Tauri 广播权威快照；Vue 只做展示、导航和清除操作。配置修改与 Bridge 稳定路径安装放在最后一阶段，避免配置能力反向依赖尚未稳定的数据链路。

**技术栈：** Rust 2021、Tokio、Axum 0.8、serde、getrandom 0.4、Windows API、Tauri 2、Vue 3.5、TypeScript 5.6、Pinia 3、Vitest 4、`@vue/test-utils`、`toml_edit` 0.25、PowerShell、pnpm 10.33.2。

## 全局约束

- 本路线图只描述实施工作；本次不实现源码，也不自动进入阶段一。
- 所有文本文件使用 UTF-8 without BOM；代码注释、提交信息和 PR 描述使用中文。
- JavaScript 依赖和脚本只通过 `pnpm` 管理和执行。
- 第一版明确排除 WSL、打开或定位 Codex 会话、灵动岛授权操作、暂停/终止/继续 Codex、历史事件补偿、完整日志与工具审计、云端任务和编辑器扩展。
- 不在 `IslandView.vue` 中实现分类、去重、乱序过滤、平滑切换、超时、完成保留或失败判断。
- 每个阶段按测试先行执行，且必须在自己的验收命令通过后才能进入下一阶段。
- 不修改与 Codex 状态岛无关的模块；现有音乐、歌词、通知、硬件和网络行为保持不变。

---

## 1. 调研基线与当前实际架构

### 1.1 已核验仓库状态

- 当前分支为 `main`，调研前工作树无未提交改动。
- 最近六个提交为 `7f25901e docs: 重构项目文档与架构说明`、`799c182e docs(codex): 添加 Codex 实时状态灵动岛设计文档`、`fbbd16ed feat(music): 添加媒体播放进度跳转功能`、`9142cff9 docs: 完成音乐歌词重构记录`、`cd8b0297 test: 稳定歌词服务时序边界`、`55430210 refactor: 拆分应用初始化流程`；本计划以 `7f25901e` 为代码调研基线。
- 前端基线：`pnpm run test` 通过 `23` 个测试文件、`206` 项测试。
- Rust 基线：在 `src-tauri` 执行 `cargo test --lib` 通过 `62` 项测试。
- `vitest.config.ts` 当前只覆盖 `src/**/*`；Rust 测试由 Cargo 独立执行。
- `src-tauri/Cargo.toml` 当前是单一包，不是 workspace；`Cargo.lock` 位于 `src-tauri/Cargo.lock`。
- `src-tauri/tauri.conf.json` 当前只打包图标，没有 `bundle.resources`、`externalBin` 或 Bridge 资源。
- `package.json` 当前没有 Bridge 构建或暂存脚本；包管理器锁定为 `pnpm@10.33.2`。

### 1.2 多岛与窗口架构

- `/` 与 `/widget` 分别创建 Vue 应用，两个窗口不共享 Pinia 内存；跨窗口使用 Tauri 命令与事件。
- `src/modules/island/display.ts` 已声明 `agent` 类型，并在 `resolveIslandLayout()` 中参与主岛、卫星岛和展开尺寸计算；当前 Agent 数据在 `IslandView.vue` 中固定为 `active: false`。
- 主岛顺序已经实现为强打断、手动焦点、软打断、轮换、稳定主岛、优先级、网络兜底；卫星岛最多三个且排除网络和系统提示。
- `IslandView.vue` 已有卫星岛点击切换、主岛展开、鼠标离开一秒收缩、主岛变化时清理无效展开状态和窗口尺寸联动。Codex UI 必须复用这些机制。
- `IslandDisplayController.vue` 当前对 `agent` 只渲染静态文案；阶段三只替换这一分支并接入专用组件。

### 1.3 Tauri 生命周期与设置现状

- `src-tauri/src/lib.rs` 的 `setup` 通过 `initialize_app()` 创建歌词服务、监控、主窗口、托盘和关闭拦截；主窗口与 Widget 的关闭请求都被改为隐藏。
- 托盘“强制退出”当前调用 `std::process::exit(0)`，不会给异步 HTTP 服务可靠清理机会；阶段二必须改为 Tauri 的正常退出路径并添加生命周期测试。
- `src/stores/settings.ts` 以 `localStorage` 为真实设置来源；Rust `settings_commands.rs` 只是默认快照和补丁广播的过渡实现。Codex 监听安装状态不得伪装成普通前端设置。
- `src/shared/ipc/contracts.ts`、`commands.ts`、`events.ts` 是跨窗口契约集中点；新增 Codex 契约必须进入这些文件并补相邻测试。

### 1.4 官方 Hooks 与本机核验结论

- 2026-07-16 核对的官方 [Codex Hooks 文档](https://developers.openai.com/codex/hooks/) 说明：Hook 可来自同一配置层的 `hooks.json` 或 `config.toml` 内联 `[hooks]`；两者同时存在会合并并警告；非托管 Hook 需要按命令内容信任；当前可执行处理器只有 `type = "command"`。
- 官方字段以实际文档为准：公共字段使用 `session_id`、`transcript_path`、`cwd`、`hook_event_name`、`model`、`permission_mode`；轮次事件提供 `turn_id`；工具事件提供 `tool_name`、`tool_use_id`、`tool_input`，授权说明仅在部分工具的 `tool_input.description` 出现，`PostToolUse.tool_response` 是无固定子字段的 JSON 值；`SubagentStop` 另有禁止读取的 `agent_transcript_path`，SubagentStop/Stop 提供 `stop_hook_active` 与 `last_assistant_message`。
- `async` 虽可解析但命令 Hook 尚不支持，因此 CodePulse 条目不设置它；`timeout` 单位为秒，设为 `2`；不设置 `statusMessage`；Windows 命令使用 `commandWindows`，TOML 同时兼容官方允许的 `command_windows`/`commandWindows` 读取形式。
- 本机 `%USERPROFILE%\.codex\config.toml` 存在，当前没有内联 Hooks、没有禁用 Hooks；`hooks.json` 不存在。本机 Codex App 为原生 Windows 安装并共享该目录。
- 本机 `codex.exe` 来自 App 安装目录，当前不能作为独立 PowerShell CLI 直接调用。因此阶段四可完成 App 验收，但“原生 CLI 正式验收”必须在可独立调用的官方 CLI 环境补做，不能用模拟事件冒充。
- 企业托管配置可能位于 `%ProgramData%\OpenAI\Codex\requirements.toml`。CodePulse 只读检查其中的 `[features].hooks` 与 `allow_managed_hooks_only`，绝不修改该文件。

## 2. 四阶段依赖顺序

```text
阶段一：共享协议 + Bridge + HTTP 接收器 + 打包资源
    ↓ 产出 CodexBridgeEvent、发现文件与有界事件入口
阶段二：聚合器 Actor + Tauri 生命周期/命令/事件
    ↓ 产出 CodexStateSnapshot、CodexListeningStatus 与清除命令
阶段三：Vue Agent 展示 + 多岛布局接入
    ↓ 产出可交互但不管理 Hook 的状态岛
阶段四：Hook 配置 + Bridge 安装升级 + 设置页 + E2E
    ↓ 完成用户可用的安装、修复、卸载和真实端验收
```

阶段一不依赖配置写入；可用测试进程直接调用 Bridge。阶段二只消费阶段一事件；阶段三只消费阶段二公开 DTO；阶段四调用前三阶段已有的自检、状态和资源接口。依赖方向单向，不存在配置层反向定义协议或 UI 反向控制聚合器的循环。

## 3. 跨阶段准确接口

### 3.1 Bridge 到 HTTP 的协议

共享 Rust 包：`src-tauri/crates/codex-protocol`。JSON 使用 camelCase，枚举使用 snake_case。

```rust
pub const CODEX_PROTOCOL_VERSION: u16 = 1;

pub enum CodexSource { Cli, App, Unknown }
pub enum CodexEventType {
    SessionStarted,
    TurnStarted,
    ToolStarted,
    PermissionRequested,
    ToolFinished,
    SubagentStarted,
    SubagentFinished,
    TurnStopped,
}
pub enum CodexStage {
    Analyzing,
    Reading,
    Editing,
    RunningCommand,
    RunningTests,
    WaitingApproval,
}
pub enum OperationResult { Success, Failed, Unknown }

pub struct CodexBridgeEvent {
    pub version: u16,
    pub event_id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub tool_use_id: Option<String>,
    pub agent_id: Option<String>,
    pub source: CodexSource,
    pub project_name: String,
    pub cwd: String,
    pub event_type: CodexEventType,
    pub stage: Option<CodexStage>,
    pub task_summary: Option<String>,
    pub operation_summary: Option<String>,
    pub latest_output: Option<String>,
    pub error_summary: Option<String>,
    pub operation_result: OperationResult,
    pub occurred_at: i64,
}
```

约束固定为：Hook stdin 最大 `64 KiB`；HTTP 请求体最大 `16 KiB`；eventId 是 16 个随机字节的 32 位小写十六进制；sessionId/turnId/toolUseId/agentId 各最多 `256` 个 Unicode 标量值；项目名 `120`；cwd `2048`；任务摘要 `120`；操作摘要 `160`；最新输出和错误摘要各 `300`。所有标识/文本拒绝 NUL 和非空白控制字符。`transcript_path`、完整提示词、完整 `tool_input`/`tool_response`、文件正文、代码片段和完整命令输出绝不进入该 DTO。

HTTP 接口固定为 `POST /v1/codex/events`，请求头为 `Authorization: Bearer <token>` 与 `Content-Type: application/json`。响应码固定为：`202` 接收入队、`400` JSON 语法错误、`401` 认证失败、`404` 路径错误、`405` 方法错误、`413` 超限、`415` 内容类型错误、`422` 协议或字段校验失败、`429` 有界队列已满、`503` 聚合接收端已关闭。

发现文件固定为 `%LOCALAPPDATA%\CodePulse\runtime\codex-bridge.json`：

```rust
pub struct CodexDiscovery {
    pub version: u16,
    pub port: u16,
    pub pid: u32,
    pub token: String,
    pub started_at: i64,
}
```

`token` 为 `32` 个随机字节的小写十六进制字符串。固定端口 `127.0.0.1:47653` 仅在 `AddrInUse` 时降级到 `127.0.0.1:0`；其他绑定错误直接进入服务异常。

### 3.2 HTTP 到聚合器的内部入口

阶段一创建容量为 `256` 的 `tokio::sync::mpsc`：

```rust
pub type CodexEventSender = tokio::sync::mpsc::Sender<CodexBridgeEvent>;
pub type CodexEventReceiver = tokio::sync::mpsc::Receiver<CodexBridgeEvent>;

pub fn codex_event_channel() -> (CodexEventSender, CodexEventReceiver);
```

HTTP 处理器仅完成二次校验/脱敏并调用 `try_send`；阶段二 Actor 独占 Receiver。队列满时不等待、不重试，直接返回 `429`。

### 3.3 聚合器公开快照

`cwd` 只在 Rust 内存内部状态存在，不进入 Vue 契约。

```ts
export type CodexTaskStage =
  | 'analyzing'
  | 'reading'
  | 'editing'
  | 'running_command'
  | 'running_tests'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'interrupted'

export interface CodexTaskState {
  sessionId: string
  turnId?: string
  source: 'cli' | 'app' | 'unknown'
  projectName: string
  taskSummary: string
  stage: CodexTaskStage
  operationSummary?: string
  latestOutput?: string
  errorSummary?: string
  lastOperationResult: 'success' | 'failed' | 'unknown'
  hasUnresolvedIssue: boolean
  activeSubagentCount: number
  startedAt: number
  lastActivityAt: number
  completedAt?: number
  acknowledged: boolean
}

export interface CodexAttention {
  id: number
  level: 'strong' | 'soft'
  reason: 'waiting_approval' | 'failed' | 'completed' | 'interrupted'
  sessionId: string
  expiresAt?: number
}

export interface CodexStateSnapshot {
  version: 1
  revision: number
  generatedAt: number
  tasks: CodexTaskState[]
  representativeSessionId?: string
  attention?: CodexAttention
}
```

`tasks` 由 Rust 按内部服务端单调接收时间倒序输出；`lastActivityAt` 只是对应接收动作的公开 Unix 时间，Vue 不自行按它重排。代表任务按等待授权、失败、完成、中断、测试、命令、编辑、读取、分析排序，同阶段再按内部单调接收顺序选择。

### 3.4 监听状态与事件

```ts
export interface CodexListeningStatus {
  serviceState: 'stopped' | 'starting' | 'listening' | 'error'
  hookState:
    | 'unknown'
    | 'not_installed'
    | 'awaiting_trust'
    | 'active'
    | 'partial'
    | 'conflict'
    | 'disabled'
  phase:
    | 'disabled'
    | 'not_installed'
    | 'awaiting_trust'
    | 'running'
    | 'partial'
    | 'config_conflict'
    | 'service_error'
  port?: number
  usingFallbackPort: boolean
  lastEventAt?: number
  sources: Array<'cli' | 'app' | 'unknown'>
  errorCode?: string
}

export interface CodexSoftInterruptPayload {
  attentionId: number
  sessionId: string
  reason: 'completed' | 'interrupted'
  expiresAt: number
  revision: number
}
```

Rust 产生的状态事件统一为：

- `codex-state-changed`：完整权威 `CodexStateSnapshot`；
- `codex-soft-interrupt`：只作为动画边沿提示，状态仍以快照为准；
- `codex-listening-status-changed`：完整 `CodexListeningStatus`。

阶段四另用前端窗口事件 `codex-display-settings-changed` 同步两个 localStorage 显示偏好；该事件不承载 Codex 任务状态，也不由 Rust 聚合器产生。

Tauri 命令统一为：

- `get_codex_snapshot() -> CodexStateSnapshot`；
- `clear_codex_task(session_id: String) -> CodexStateSnapshot`，仅允许失败或中断；
- `clear_all_codex_failures() -> CodexStateSnapshot`；
- `get_codex_listening_status() -> CodexListeningStatus`；
- `run_codex_self_check() -> CodexSelfCheckResult`；
- 阶段四新增 `inspect_codex_integration()`、`preview_codex_hook_change(action)`、`apply_codex_hook_change(action, expected_digest, preview_digest)`。

### 3.5 Hook 配置变更接口

```ts
export type CodexHookAction = 'install' | 'repair' | 'uninstall'
export type CodexHookRepresentation = 'hooks_json' | 'config_toml' | 'none' | 'conflict'

export interface CodexIntegrationInspection {
  codexHome: string
  representation: CodexHookRepresentation
  configPath?: string
  configDigest?: string
  hooksFeature: 'enabled' | 'disabled' | 'managed_disabled'
  managedEntry: 'absent' | 'exact' | 'modified' | 'duplicate'
  bridgeState: 'missing' | 'current' | 'outdated' | 'modified'
  hookState: CodexListeningStatus['hookState']
  issues: string[]
}

export interface CodexHookChangePreview {
  action: CodexHookAction
  representation: Exclude<CodexHookRepresentation, 'none' | 'conflict'>
  configPath: string
  expectedDigest: string
  previewDigest: string
  changes: string[]
  warnings: string[]
  bridgeAction: 'install' | 'update' | 'keep' | 'remove'
}

export interface CodexHookChangeResult {
  inspection: CodexIntegrationInspection
  selfCheck: CodexSelfCheckResult
}
```

`configPath` 是 Hook 表示的主文件；当安装同时需要把 `config.toml` 的 `[features].hooks=false` 改为 true 时，内部计划包含第二个文件变更。`expectedDigest` 是所有决策输入（`hooks.json`、`config.toml`、只读 `requirements.toml`、Bridge 资源/副本/安装记录）的路径、存在性和原始 SHA-256 经排序后的组合摘要。`previewDigest` 是规范化变更计划的 SHA-256；应用时重新计算两种摘要，任何不一致都停止写入。

## 4. 各阶段独立交付与验收

| 阶段 | 计划文档 | 独立交付物 | 阶段验收 |
|---|---|---|---|
| 1 | `2026-07-16-codex-status-island-01-bridge-http.md` | workspace、共享协议、Bridge、HTTP 服务、发现文件、Bridge 打包资源 | 协议/Bridge/HTTP 测试通过；Bridge 所有失败路径严格输出 `{}` 且退出 0；打包产物中存在资源 EXE |
| 2 | `2026-07-16-codex-status-island-02-aggregator-tauri.md` | 可注入时钟聚合器、顺序 Actor、Tauri 快照/清除/状态接口、启动退出清理 | 聚合器与生命周期测试通过；5 分钟、10/30 分钟、乱序、去重、Stop 保守判定可用手动时钟瞬时验证 |
| 3 | `2026-07-16-codex-status-island-03-agent-ui.md` | TS 契约、权威快照 composable、紧凑态/列表/详情、Agent 多岛接入 | Vue 单元/组件/布局测试通过；列表详情导航、自动收缩、主/卫星切换无状态机进入 `IslandView.vue` |
| 4 | `2026-07-16-codex-status-island-04-hook-settings-e2e.md` | 配置检查/预览/原子写入/卸载、Bridge 稳定安装与升级、设置页、自检、自动与真实端验收 | 临时 Codex Home 配置矩阵通过；用户 Hook 不变；真实 App 事件通过；独立 CLI 环境可用后补齐 CLI 发布门禁 |

每阶段完成时均运行该计划列出的局部测试、全量前端测试、Rust 测试、格式和静态检查；验收失败时停留在当前阶段，不用跳到后续层规避问题。

## 5. 新增依赖与理由

| 依赖 | 范围 | 阶段 | 理由与替代方案判断 |
|---|---|---|---|
| `axum = "0.8"` | `netspeed-dynamic` 生产依赖 | 1 | 提供有请求体限制、ConnectInfo、路由和可测试 Service 的本地 HTTP 层；手写 HTTP 解析会扩大安全风险，现有 `reqwest` 是客户端，不能替代服务端 |
| `getrandom = "0.4"` | 主包与 Bridge 生产依赖 | 1 | 直接从系统 CSPRNG 生成 256 位启动令牌与随机事件 ID；不能用时间戳/PID 代替认证令牌 |
| `windows = "0.58"` 的进程枚举特性 | Bridge 生产依赖 | 1 | 项目已使用同版本 Windows crate；只新增 `ToolHelp`/进程查询 features 以尽力识别 App/CLI 来源，不引入另一套系统库 |
| `tempfile = "3"` | Rust dev-dependency | 1、4 | 在隔离目录验证发现文件、配置备份和原子替换；只用于测试 |
| `toml_edit = "0.25"` | 主包生产依赖 | 4 | 修改内联 Hooks 时保留用户 TOML 注释、顺序和无关键；普通 `toml` 重新序列化会产生过大配置差异 |

不新增前端生产依赖；不新增 Tauri shell 插件；不为 Bridge 引入 HTTP 客户端库，Bridge 使用 `std::net::TcpStream` 在严格时间预算内发出最小 POST。现有 `serde`、`serde_json`、`tokio`、`sha2`、Tauri 与 Windows API 继续复用。

## 6. `codepulse-codex-bridge.exe` 构建、打包与升级

1. 把 `src-tauri` 转换为 Cargo workspace，成员为根应用、`crates/codex-protocol` 和 `crates/codepulse-codex-bridge`，继续共用现有 `src-tauri/Cargo.lock`。
2. `scripts/build-codex-bridge.ps1` 从 `TAURI_ENV_TARGET_TRIPLE` 读取 Tauri 当前目标到 `$target`；未提供时从 `rustc -vV` 解析 host；仅接受 `*-pc-windows-msvc`。发布构建执行 `cargo build -p codepulse-codex-bridge --release --target $target`，把产物复制到 `src-tauri/binaries/codepulse-codex-bridge.exe`。
3. `package.json` 新增 `build:codex-bridge`；`tauri.conf.json.build.beforeBuildCommand` 在前端构建前运行它。`.gitignore` 忽略暂存 EXE，源码、脚本和锁文件仍入库。
4. `tauri.conf.json.bundle.resources` 使用资源映射，把暂存 EXE 放入安装包资源目录的 `bin/codepulse-codex-bridge.exe`。这里选 resources 而不是 `externalBin`：应用不把 Bridge 当常驻 sidecar 启动，Bridge 由 Codex Hook 单次启动；resources 也避免 sidecar 的 target-triple 文件名成为 Hook 路径。
5. 阶段四从 `app.path().resource_dir()/bin/codepulse-codex-bridge.exe` 读取安装包版本，校验 SHA-256 后通过临时文件与 Windows 原子替换安装到 `%LOCALAPPDATA%\CodePulse\bin\codepulse-codex-bridge.exe`。Hook 永远引用稳定路径，不引用版本化安装目录。
6. 每次 CodePulse 启动检查资源哈希、稳定副本哈希和协议版本；只有现有条目与 CodePulse 精确签名匹配时自动更新副本。条目被用户修改时进入冲突并要求预览确认。
7. 卸载先精确移除配置条目并验证配置，再删除稳定副本和安装记录。应用升级带入的新资源在下次启动修复稳定副本；旧安装包不会覆盖用户配置。

相关 Tauri 行为以官方 [Sidecar 文档](https://v2.tauri.app/develop/sidecar/)、[BundleConfig resources 参考](https://v2.tauri.app/reference/config/#bundleconfig) 和 [构建钩子环境变量](https://v2.tauri.app/reference/environment-variables/) 为实现核对依据。

## 7. 关键行为决策

### 7.1 并发、乱序与可测试时钟

- HTTP 并发只进入有界队列；一个 Actor 顺序处理 `Event`、`Tick`、`ClearTask`、`ClearFailures`、`GetSnapshot`、`Shutdown` 消息。
- `CodexAggregator<C: Clock>` 是无 Tauri、无 Tokio 定时器的纯状态对象；每次 `ingest()`/`tick()` 只读取一次同时含 Unix 墙上毫秒和进程内单调毫秒的 `ClockReading`。生产 `SystemClock` 用 `SystemTime` 生成公开展示时间、用 `Instant` 生成生命周期时间；测试 `ManualClock` 可分别推进单调时间和跳变墙上时间。
- 去重缓存最多保存 `2048` 个 `eventId`；每个 session 另保存最近 `8` 个已退休 turnId。同一轮次用 `occurredAt` 过滤旧事件；新轮次事件先于 UserPromptSubmit 到达时建立临时轮次，迟到的同 turnId UserPromptSubmit 只补任务摘要而不把阶段倒退为分析；已退休 turnId 的事件直接丢弃。`occurredAt` 和墙上时间都不参与生命周期或列表新旧排序；超时、保留、平滑和代表任务同级排序只使用服务端单调接收时间，因此客户端漂移与 Windows 校时都不能提前或延后状态转换。
- 一秒平滑通过一个待提交普通阶段实现：同一秒只保留最后一个普通阶段；等待授权、失败、完成和中断立即提交。真实定时器只每秒向 Actor 发送 `Tick`，所有判断仍在纯聚合器内。

### 7.2 生命周期与提醒

- 完成态记录 `completedAt`，在手动时钟达到 `completedAt + 5 分钟` 时删除。
- 失败不自动删除；同一会话新 `UserPromptSubmit` 清除旧失败；只有失败和中断接受手动清除。
- 分析/读取/编辑在服务端最后活动后 `10 分钟` 中断，命令/测试在 `30 分钟` 中断，等待授权永不超时。
- 中断每个周期只产生一次 5 秒软提醒；新事件恢复并清除本周期标记。失败首次强提醒 5 秒，完成软提醒 5 秒，授权强提醒持续到后续有效事件退出授权态。

### 7.3 Stop 保守判定

- `PostToolUse.tool_response` 没有官方稳定的退出码字段，解析器只识别测试样本中明确出现的 `Process exited with code N`、`Exit code: N` 或 JSON 数值 `exit_code`；其他结构一律为 `unknown`。
- Stop 的 `last_assistant_message` 先脱敏、裁剪，再仅用于保守终态分类；中间工具失败不直接变红。
- 最后操作成功或回答含明确完成语义时为完成；最后操作失败且回答含“无法完成、仍然失败、需要用户处理”等明确失败语义时才为失败；失败结果但语义不明确时为完成并设置 `hasUnresolvedIssue = true`；完全无法判断时默认完成。
- 终态词表由确定的正向和失败短语表驱动并有表格测试，不调用模型、不读取 transcript。

## 8. 主要风险与回滚策略

| 风险 | 防护 | 回滚策略 |
|---|---|---|
| Bridge 未进入安装包或目标架构错误 | 构建脚本验证 Windows MSVC triple；bundle 内容测试检查资源 EXE 与 PE 架构 | 关闭设置入口并恢复上一版资源配置；未写 Hook 时不影响 Codex |
| Tauri 隐藏窗口或托盘强退绕过清理 | 服务句柄归应用状态；ExitRequested/Exit 与托盘退出统一触发 shutdown；发现文件 guard 兜底删除 | 禁用监听并删除发现文件；Bridge 遇到残留 PID/连接失败仍静默退出 |
| 固定端口被占用或恶意本机进程伪装 | 仅 `AddrInUse` 降级动态端口；每次启动随机令牌；发现文件原子替换；Bridge 校验版本、PID 和回环端口 | 切换动态端口不算故障；发现文件无法安全写入则关闭服务，不开放未认证端口 |
| 并发/乱序/定时器产生间歇错误 | 单 Actor、有限去重、轮次与时间戳规则、可注入手动时钟 | 保留 HTTP/快照接口，回退聚合器提交；旧版本不会持久化任务状态 |
| Hook 配置格式或字段与官方版本变化 | 实施时再次查官方文档；完整解析；真实 App/CLI 门禁；记录协议版本 | 检查到未知结构只读报冲突；不写文件；卸载只删精确签名 |
| 用户已有 Hook 被覆盖 | 沿用现有表示方式；摘要预览；备份；摘要校验；语义级增删 | 原子写失败保留原文件；卸载不恢复整份旧备份；备份只供用户审计或手工恢复 |
| Hook 条目已被用户手改 | 精确命令与标记参数识别；`modified` 状态拒绝自动修复/卸载 | 展示差异并要求新预览，不强制覆盖 |
| 设置页把“已写配置”误报为运行 | `awaiting_trust` 与 `active` 分离；只有收到第一条真实事件后为 `running` | 保持未信任提示和自检，不自动重复写入 |
| 展开详情与主岛切换冲突 | 复用现有 `expandedKind` 与手动焦点；详情选择只在 Codex 内容组件内部 | 移除 Agent 模块接线即可恢复静态 Agent 分支，不改变通用调度 |
| 敏感信息进入日志或 Vue | Bridge 与服务端双重脱敏；公开 DTO 无 cwd；日志只记元数据和错误码 | 禁用监听、删除内存任务；没有历史数据或事件文件需要迁移 |
| Bridge 故障影响 Codex | panic 捕获、无重试、250ms 预算、任何失败 `{}`/0、stderr 静默 | 删除 Hook 条目或稳定 EXE；用户原 Hook 不变 |

每个任务使用独立提交。若阶段验收失败，按该阶段任务提交从新到旧逐一执行非破坏性 `git revert`，并在每次 revert 后重跑该阶段门禁；不得用 `git reset --hard`。Hook 已安装后的产品回滚必须先运行精确卸载，再回滚应用版本，避免配置指向不存在的 EXE。

## 9. 设计文档与当前代码/官方现状不一致之处

| 设计中的表述 | 核验结果 | 计划处理 |
|---|---|---|
| 用户要求读取 `docs/superpowers/specs/2026-07-16-codex-status-island-design.md` | 仓库实际文件是 `docs/2026-07-16-codex-status-island-design.md`，且状态为“已确认” | 以实际文件为需求来源，并在本路线图记录路径差异，不创建重复 spec |
| “建议新增 `src-tauri/src/codex/protocol.rs`” | Bridge 也必须使用完全相同的 wire 类型；当前 Cargo 又只有单包 | 抽出 `crates/codex-protocol`，主应用 `codex` 模块保留 server/aggregator/runtime/commands/config 等职责，消除复制协议的漂移风险 |
| 聚合结构示例包含 `cwd` | 设计同时要求原始路径不进入 Vue | Rust 内部保留 `cwd` 供项目识别，公开 `CodexTaskState` 删除 `cwd` |
| 设计建议 Agent 详情区域但未给当前尺寸 | `display.ts` 当前 Agent 展开只有 `340 × 92`，无法容纳列表和详情；音乐进度也会动态改变布局 | 阶段三以测试把 Agent 详情改为 `420 × 280`，窗口仍由 `resolveIslandLayout()` 与 `useIslandWindow()` 统一设置 |
| 设计列出事件，但没有固定官方原始字段映射 | 官方当前 `tool_response` 为任意 JSON 值，不能假设稳定 `exit_code` | 阶段一保存原始字段兼容测试；阶段二 Stop 分类将未知结果默认完成并标记未解决问题 |
| 设计写“安装或更新 Bridge”但未说明 Tauri 打包方式 | 当前 `tauri.conf.json` 没有资源/sidecar，Hook 需要跨版本稳定路径 | 使用 bundle resource + `%LOCALAPPDATA%` 原子安装副本，不使用 sidecar 启动 |
| 设计写应用退出后清空任务 | 当前托盘强退使用 `std::process::exit(0)` | 阶段二统一正常退出路径并持有 HTTP shutdown handle；硬崩溃用发现文件 PID/连接校验降级 |
| 设计用公开 `lastActivityAt` 表述同级排序和超时 | Windows 墙上时间可能因校时向前或向后跳变，直接比较会破坏 1 秒、5/10/30 分钟边界 | `lastActivityAt` 保留为公开展示时间；聚合器另存服务端单调毫秒并只用它做排序、平滑、保留、提醒和中断，阶段二增加双向校时测试 |
| 设计的设置页状态依赖 Rust | 当前设置真实来源是 `localStorage`，Rust 设置命令不持久化 | 仅“空闲常驻”和“显示脱敏摘要”放前端设置；监听/Hook/服务状态由 Rust 权威 inspection 提供 |
| 设计要求 CLI 与 App 正式验收 | 本机 App 可用，App 自带 `codex.exe` 当前无法在外部 PowerShell 独立调用 | 不降低标准；自动测试与 App 验收可完成，CLI 验收列为发布门禁并记录具体环境阻塞 |
| 设计列出 npm 测试分类示例 | 项目规范禁止用 npm 执行本项目脚本 | 分类器仍可识别被观察项目的 `npm test`，但 CodePulse 自身验证命令全部用 pnpm |

## 10. 需求覆盖矩阵

| 设计章节/要求 | 落地计划与任务 | 验证证据 |
|---|---|---|
| 1–2 背景与八项目标 | 路线图全局约束；01 全链路；02 聚合；03 UI；04 配置/E2E | 四阶段独立验收与最终矩阵 |
| 3 第一版不做 | 01 任务 2/3、03 任务 3/5、04 任务 7 | 禁止字段测试、按钮缺失测试、范围 grep 和人工检查 |
| 4.1 紧凑态 | 03 任务 3 | `CodexCompactContent.test.ts` |
| 4.2 多会话汇总列表 | 02 任务 2、03 任务 3 | 多会话聚合测试与列表组件测试 |
| 4.3 任务详情、返回、清除 | 02 任务 4、03 任务 3/5 | 详情导航、任务移除、清除命令测试 |
| 5.1 阶段模型与空闲常驻 | 01 任务 2、02 任务 1、03 任务 2、04 任务 5 | 分类表、快照和展示测试 |
| 5.2 主岛优先级 | 02 任务 2、03 任务 4 | 代表任务与 `resolveIslandLayout()` 测试 |
| 5.3 一秒平滑 | 02 任务 3 | `ManualClock` 无等待测试 |
| 5.4 五分钟完成、失败保留与手动清除 | 02 任务 3/4 | 生命周期与命令测试 |
| 5.5 10/30 分钟中断、授权不超时 | 02 任务 3 | 手动时钟边界测试 |
| 6 总体架构、6.1 不接管原 Hook | 01 任务 1–5、04 任务 1–4 | 单向接口测试和配置保留测试 |
| 7.1 半自动十步安装 | 04 任务 1–7 | inspection/preview/apply/self-check/真实事件验收 |
| 7.2 表示方式选择 | 04 任务 1–3 | `hooks.json`、TOML、双表示冲突矩阵 |
| 7.3 八种 Hook | 01 任务 2、04 任务 2/3/7 | 八事件解析和配置测试 |
| 7.4 稳定 Bridge 路径 | 01 任务 5、04 任务 4 | bundle 与稳定副本哈希测试 |
| 7.5 所有路径 `{}`/0 | 01 任务 3 | Bridge 进程契约测试 |
| 8.1 单次进程模式 | 01 任务 2/3 | 每个 Hook 启动一次、无守护状态测试 |
| 8.2 Bridge 职责 | 01 任务 2/3 | 解析、来源、摘要、投递测试 |
| 8.3 Bridge 禁止职责 | 01 任务 3、02 任务 1–3 | 无重试/无事件落盘检查；聚合职责测试 |
| 8.4 150ms/250ms/2s | 01 任务 3、04 任务 2/3 | 超时测试与配置快照 |
| 8.5 来源识别与降级 | 01 任务 2、04 任务 7 | 注入父进程链测试和真实端来源验收 |
| 9 协议和字段 | 01 任务 1 | JSON 契约快照测试 |
| 9.1 长度限制 | 01 任务 1/2/4 | Unicode 边界和 HTTP 413/422 测试 |
| 9.2 禁止传输 | 01 任务 2/4、02 任务 4 | 脱敏及公开快照无路径测试 |
| 9.3 任务摘要 | 01 任务 2 | 摘要表格测试 |
| 9.4 命令摘要 | 01 任务 2 | 命令分类与秘密清理表格测试 |
| 10.1 固定/动态端口与发现文件 | 01 任务 4、02 任务 5 | 端口占用、原子写、退出清理测试 |
| 10.2 HTTP 处理顺序与 202 | 01 任务 4 | 路由/认证/限制/过载集成测试 |
| 10.3 回环、令牌、二次脱敏和安全日志 | 01 任务 4、02 任务 5 | 网络绑定、重启令牌、日志捕获测试 |
| 11 Rust 模块边界 | 01 任务 1/4、02 任务 1–5、04 任务 1–4 | 模块 API 编译和职责审查 |
| 12 聚合数据结构 | 02 任务 1/2 | DTO 序列化快照测试 |
| 13 Hook 到状态映射 | 01 任务 2、02 任务 2 | 八事件表驱动测试 |
| 14 工具分类 | 01 任务 2 | 读取/编辑/测试/命令表驱动测试 |
| 15 中间失败与 Stop 保守判定 | 02 任务 1/2 | 明确成功/失败/未知组合测试 |
| 16 等待授权 | 02 任务 2/3、03 任务 3/4 | 强打断、不超时、无授权按钮测试 |
| 17 子智能体计数 | 01 任务 2、02 任务 2、03 任务 3 | start/stop 去重与计数展示测试 |
| 18 Rust/Vue 边界及三个事件 | 02 任务 4、03 任务 1/2 | IPC 契约、revision 防旧写和清理测试 |
| 19 Vue 组件拆分 | 03 任务 2/3 | 独立模块与组件测试；IslandView 差异审查 |
| 20 多岛集成 | 03 任务 2/4/5 | 主/卫星、手动焦点、强软打断和展开尺寸测试 |
| 21 设置分组和七种状态 | 04 任务 1/5 | inspection 派生状态与设置组件测试 |
| 22 解析、备份、原子写、精准卸载、修复 | 04 任务 1–4 | 临时 Home 配置矩阵、并发摘要冲突、故障注入测试 |
| 23 异常处理 | 01 任务 3/4、02 任务 5、04 任务 1–4 | 端口、发现文件、协议、认证、队列、来源、配置错误测试 |
| 24 Windows CLI/App 兼容与 WSL 排除 | 01 任务 2、04 任务 7 | 父进程链测试、真实端验收、WSL 范围检查 |
| 25.1 Bridge 单测 | 01 任务 2/3 | Bridge crate 测试 |
| 25.2 聚合器单测 | 02 任务 1–3 | aggregator/clock 测试 |
| 25.3 HTTP 集成 | 01 任务 4 | server/runtime 集成测试 |
| 25.4 Vue 测试 | 03 任务 1–5、04 任务 5 | composable、组件、布局和设置测试 |
| 25.5 十四项 E2E | 04 任务 6/7 | 自动矩阵与真实 App/CLI 验收记录 |
| 26 完成标准 | 01–04 各阶段验收 | 性能、隐私、稳定性、配置和真实端发布门禁 |
| 27 实施顺序 | 本路线图第 2 节与四份详细计划 | 阶段门禁保证不跳过协议/聚合器测试 |
| 28 参考资料 | 路线图 1.4、6；04 任务 1/7 | 实施日再次核对官方 Hooks 与 Windows 文档 |

## 11. 全路线验收与停止条件

- 五份计划中的接口名称、枚举值、事件名、命令名、路径和时间边界必须保持与本路线图一致；需要改变时先修改路线图及所有消费计划，再改源码。
- 阶段一至三可以在没有写入真实 Codex 配置的情况下完整自动测试；阶段四的配置测试使用临时 `CODEX_HOME`，真实 Home 只在用户确认预览后修改。
- “正常运行”只由第一条真实、通过认证的 Hook 事件触发；模拟 HTTP 自检只能证明服务可用，不能替代信任或真实端验收。
- 本机无法独立启动 CLI 时，不把 CLI 门禁标成通过；这不会阻止计划文档完成，但会阻止功能版本宣称满足全部正式兼容范围。
- 最终源码提交前必须确认 `git diff --name-only` 没有 `package-lock.json`、`yarn.lock`、事件历史、日志正文或用户配置样本。
