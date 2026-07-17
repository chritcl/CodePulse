# Codex 实时状态灵动岛总体实施路线图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在不控制 Codex、不保存项目内容且不破坏用户现有 Hook 的前提下，为 Windows 原生 Codex CLI 与 Codex App 提供可安装、可升级、可卸载的实时状态灵动岛。

**架构：** Windows GUI Subsystem 的单次 `codepulse-codex-bridge.exe` 把官方 Hook 输入转换为最小事件并投递到仅回环监听的 Rust HTTP 服务；单线程 Actor 以可注入时钟维护全部会话并产生不带 revision 的 draft，显式注入 `CodexRuntimeManager` 的唯一进程级 `CodexSnapshotStore` 分配全局 revision并保存权威快照；Tauri只广播Store已提交的快照；Vue只做展示、导航和清除操作。每次HTTP/Actor Runtime使用独立generation、token与Discovery owner；配置修改与Bridge稳定路径安装由一个可跨进程恢复的Integration Transaction Journal协调。Prepared后的摘要重读统一称为optimistic precondition check，只负责提前发现变化；existing目标由`ReplaceFileW`原子替换并把实际旧内容捕获到transaction-owned replaced snapshot，absent目标用no-replace同目录原子发布，Uninstall用原子rename捕获removed tombstone。每个原子操作成功后立即以不共享写/删除的普通`StableArtifactLease`冻结实际target与捕获版本，所有关键摘要只从该Handle读取，并把进程内Lease持有到对应Journal阶段持久化；StructureCommitted落盘后释放普通事务Lease，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记。孤立Journal temp只按精确Prepared-only规则恢复，Conflict只提供同一状态机的安全重试。`ConfigApplyTransaction`与`BridgeInstallTransaction`只是该统一事务内的进程内句柄。

**技术栈：** Rust 2021、Tokio、Axum 0.8、serde、getrandom 0.4、Windows API、Tauri 2、Vue 3.5、TypeScript 5.6、Pinia 3、Vitest 4、`@vue/test-utils`、`toml_edit` 0.25、PowerShell、pnpm 10.33.2。

## 全局约束

- 本路线图只描述实施工作；本次不实现源码，也不自动进入阶段一。
- 规范层级固定为：设计文档负责产品目标、用户行为、功能范围和可见状态；本 Roadmap 负责跨阶段架构、公开接口、状态所有权和全局不变量；详细阶段计划负责执行顺序、失败处理、测试和审核门禁。详细计划不得静默违背产品设计；安全性导致顺序变化时先同步设计。公共接口或全局不变量变化时，先同步本 Roadmap 与全部消费者计划。
- 所有文本文件使用 UTF-8 without BOM；代码注释、提交信息和 PR 描述使用中文。
- JavaScript 依赖和脚本只通过 `pnpm` 管理和执行。
- 第一版明确排除 WSL、打开或定位 Codex 会话、灵动岛授权操作、暂停/终止/继续 Codex、历史事件补偿、完整日志与工具审计、云端任务和编辑器扩展。
- 不引入自建 Dispatcher。CodePulse 只安装、修复和卸载用户层 `%USERPROFILE%\.codex` 中的 CodePulse Hook；不修改仓库级 `.codex`、插件 Hook 或企业托管配置，不扫描全部仓库。Inspection 只能声明用户层管理事实，UI 不提供“全局唯一 Hook”状态。
- 多个活动配置层可能并发启动同一逻辑 Hook。随机 `eventId` 去重保留为第一层；单线程 Actor 独占维护第二层有界逻辑事件去重。Bridge 不扫描配置层、不持久化状态，Vue 不承担任何去重职责。
- 不在 `IslandView.vue` 中实现分类、去重、乱序过滤、平滑切换、超时、完成保留或失败判断。
- Vue 不重新判断超时和失败，只消费 Rust 发布的权威快照与监听状态。
- CodePulse 未运行时不补偿历史事件；重新启动只接收本次启动后通过当前 token 认证的 Hook。
- `CodexSnapshotStore` 与 `next_runtime_generation` 从 CodePulse 进程启动存活到进程退出，不随 HTTP/Actor Runtime 停止或重启而重建。
- Inspection 只描述重新读取文件才会变化的静态事实；设置页、Widget 和 Agent 投影的动态状态唯一来自 `CodexListeningStatus`。
- 设置页的“Codex状态集成”是状态分组而不是监听布尔开关；全局Hooks是Codex外部前置条件，只能由用户在Codex配置或官方UI手动修改。安装/修复与卸载各自独立preview/confirm；配置写入后先是`awaiting_trust`/`partial`，不能直接`running`。只有`idlePersistent`与`showCommandSummary`是普通显示偏好，二者都无权启停Runtime。
- Exact规范化必须显式绑定`paths.installed_bridge`并只比较CodePulse-owned projection；用户独立Hook不进入投影，wrong-path handler不能成为安全Marker或Exact。
- Transaction Conflict不提供强制覆盖、强制删除事务或忽略并继续；用户只能在手工恢复为Journal已知状态后执行安全重试。
- `StableArtifactLease`只存在于当前进程内且不可序列化，不进入Integration Journal、不成为第二套状态源；Journal仍是唯一跨进程事务事实，进程崩溃后的recovery必须重新获取Lease。
- 生产层无法从`CreateFileW`的`ERROR_SHARING_VIOLATION`可靠区分活动writer、writable mapping或delete/rename Handle；统一内部错误为`SharingViolation`，公开映射为`ActiveArtifactHandleConflict`。UI只显示“目标文件正在被其他程序占用，请关闭相关程序后重新尝试安全恢复。”，不得声称识别到具体进程或Handle类型。
- 普通事务`StableArtifactLease`固定不含`DELETE`权限并持有到对应Journal阶段或StructureCommitted落盘。StructureCommitted后先释放普通Lease，再新开`GENERIC_READ | DELETE`、仅`FILE_SHARE_READ`的cleanup Handle；使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记。禁止给原Lease加`DELETE`、释放后按路径`DeleteFileW`、先按路径读摘要再重新按路径删除，或因cleanup失败回滚已正确提交的结构。
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
- 托盘“强制退出”当前调用 `std::process::exit(0)`，不会给异步 HTTP 服务可靠清理机会；阶段二必须改为 `AppHandle::exit(0)`，并用 Tauri 2.11.5 的同步 `RunEvent::ExitRequested` 回调桥接异步两秒 shutdown。
- 当前锁定 `tauri 2.11.5`：`app.path().local_data_dir()` 返回 Windows LocalAppData 根目录；本功能禁止使用会追加 `com.ryen.nsd` 的应用专用本地数据目录 API；`RunEvent::ExitRequested { code: Option<i32>, api: ExitRequestApi }`、`api.prevent_exit()`、`AppHandle::exit(i32)` 和 `App::run(callback)` 是退出方案使用的实际 API。
- `src/stores/settings.ts` 以 `localStorage` 为真实设置来源；Rust `settings_commands.rs` 只是默认快照和补丁广播的过渡实现。Codex 监听安装状态不得伪装成普通前端设置。
- `src/shared/ipc/contracts.ts`、`commands.ts`、`events.ts` 是跨窗口契约集中点；新增 Codex 契约必须进入这些文件并补相邻测试。

### 1.4 官方 Hooks 与本机核验结论（2026-07-16）

- 2026-07-17 重新核对的官方 [Codex Hooks 文档](https://developers.openai.com/codex/hooks/) 与 [Config Reference](https://developers.openai.com/codex/config-reference/) 说明：Hook 可来自同一配置层的 `hooks.json` 或 `config.toml` 内联 `[hooks]`；两者同时存在会合并并警告；非托管 command Hook 以当前 Hook 定义哈希为信任单位，新建或修改后必须重新 review/trust；当前只有 `type = "command"` 会执行，`prompt`/`agent` 会被解析后跳过。
- 用户层、受信任仓库层、启用插件和企业托管层都可能提供 Hook；多个活动文件中的匹配 Hook 会全部执行，同一事件下多个匹配 command Hook 会并发启动。高优先级配置不会替换低优先级 Hook。因此用户层管理范围不等于全局唯一性，跨层重复必须由聚合器逻辑事件去重吸收。
- 官方字段以实际文档为准：公共字段使用 `session_id`、`transcript_path`、`cwd`、`hook_event_name`、`model`、`permission_mode`；轮次事件提供 `turn_id`；工具事件提供 `tool_name`、`tool_use_id`、`tool_input`，授权说明仅在部分工具的 `tool_input.description` 出现，`PostToolUse.tool_response` 是无固定子字段的 JSON 值；`SubagentStop` 另有禁止读取的 `agent_transcript_path`，SubagentStop/Stop 提供 `stop_hook_active` 与 `last_assistant_message`。
- 官方结构固定为“事件 → matcher 组 → 一个或多个 handler”三层。`commandWindows` 是基础 `command` 的可选 Windows override，因此 CodePulse 的标准 JSON/TOML Fixture 同时提供 `command` 与 Windows 字段；JSON 写 `commandWindows`，TOML 标准输出写 `command_windows`，Inspection 读取 TOML 时兼容 `command_windows`/`commandWindows`。`async` 虽可解析但命令 Hook 尚不支持，因此 CodePulse 条目不设置它；`timeout` 单位为秒，缺省值为 600，CodePulse 固定显式写 `2`；不设置 `statusMessage`。
- 官方 matcher 核对结果：省略 matcher、`""` 或 `"*"` 都表示匹配支持该字段的事件的全部发生；`PreToolUse`、`PermissionRequest`、`PostToolUse` 按工具名匹配，`SessionStart` 按启动来源匹配，`SubagentStart`/`SubagentStop` 按子智能体类型匹配；`UserPromptSubmit` 与 `Stop` 不支持 matcher，配置值会被忽略。CodePulse 需要接收八种事件的全部发生，因此标准 Fixture 对八种事件统一省略 matcher，不用 matcher 缩小工具范围。
- Hooks 默认 enabled；标准键为 `[features].hooks`，`[features].codex_hooks` 仍生效但已弃用。计划此前只识别标准键，现改为只读识别别名、发出稳定弃用/重复 Issue，绝不自动改写 Feature 键；两个键冲突或任一相关值非布尔时进入 `ConfigConflict`，Runtime 和 install/repair/uninstall 全停止。
- 官方企业示例只明确`requirements.toml`的`[features].hooks`与`allow_managed_hooks_only`，没有明确旧别名可用于managed requirements；因此首版不假设企业文件中的`codex_hooks`生效，也不修改企业文件。若实施日官方文本改变，先同步设计、Roadmap、04A、04B-1/2/3、04C与Fixture，再进入源码。
- 本机 `%USERPROFILE%\.codex\config.toml` 存在，当前没有内联 Hooks、没有禁用 Hooks；`hooks.json` 不存在。本机 Codex App 为原生 Windows 安装并共享该目录。
- 本机 `codex.exe` 来自 App 安装目录，当前不能作为独立 PowerShell CLI 直接调用。因此阶段四可完成 App 验收，但“原生 CLI 正式验收”必须在可独立调用的官方 CLI 环境补做，不能用模拟事件冒充。
- 企业托管配置可能位于 `%ProgramData%\OpenAI\Codex\requirements.toml`。CodePulse 只读检查其中的 `[features].hooks` 与 `allow_managed_hooks_only`，绝不修改该文件。
- 2026-07-17 重新核对 Microsoft 官方 [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)、[ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)、[MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)、[SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)、[GetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle)、[GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)、[FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)、[CreateFileMappingW](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-createfilemappingw)、[MapViewOfFile](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile)、[DeleteFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew) 与 [Closing and Deleting Files](https://learn.microsoft.com/en-us/windows/win32/fileio/closing-and-deleting-files)：`CreateFileW`的共享检查双向比较既有访问与新共享模式；省略`FILE_SHARE_WRITE`时，既有写访问或write-access file mapping会导致`ERROR_SHARING_VIOLATION`，省略`FILE_SHARE_DELETE`会排斥delete/rename访问；`FILE_ID_INFO`的volume serial与128位file ID共同标识同一文件对象；`ReplaceFileW`可在一次调用中捕获实际被替换文件且三条路径必须同卷；`MoveFileExW`只有显式`MOVEFILE_REPLACE_EXISTING`才覆盖；`SetFileInformationByHandle(FileDispositionInfo)`要求带`DELETE`访问的Handle并标记该Handle对应对象在关闭时删除。因此普通“按路径读摘要→再按路径恢复/删除”既不是原子Compare-And-Swap，也不能证明操作的仍是同一file ID。

## 2. 四阶段依赖顺序

```text
阶段一：共享协议 + 唯一路径对象 + GUI Bridge + HTTP 接收器 + 打包资源
    ↓ 产出 CodexBridgeEvent、CodexIntegrationPaths、DiscoveryOwner 与有界事件入口
阶段二：聚合器 Actor + 进程级 SnapshotStore + generation Runtime Manager + Tauri 退出/命令/事件
    ↓ 产出进程级单调 CodexStateSnapshot、CodexListeningStatus、按原因启停接口与清除命令
阶段三：Vue Agent 展示 + 多岛布局接入
    ↓ 产出同时消费 snapshot/listeningStatus 的状态岛
阶段四：Hook 安全接入
    04A 静态 Inspection + ListeningStatus 派生 + Planner（纯只读/纯计划）
      ↓ 完成后停下来 review
    04B-1 事务与原子文件基础设施
      ↓ 完成后强制停下来 review
    04B-2 Config Writer + Bridge Installer + action coordinator
      ↓ 完成后强制停下来 review
    04B-3 Tauri Commands + inspection 驱动 Runtime
      ↓ 完成后强制停下来 review
    04C Settings + A/B/C 分层验收
      ↓ 完成后停下来 review
```

阶段一不依赖配置写入；可用测试进程直接调用 Bridge。阶段二只消费阶段一事件、Owner 和路径对象，setup 只构造一次 SnapshotStore并显式注入 manager，HTTP 保持 dormant。阶段三只消费阶段二公开 DTO。04A 只消费路径/资源元数据与标准 JSON/TOML Fixture，并产出静态 inspection、纯 listening 派生和 planner；04B-1只建立唯一Journal/原子文件/Lease/recovery基础，04B-2在其审核通过后实现Config Writer、Bridge Installer与action coordinator，04B-3再接入公开命令和Runtime编排；04C 只消费已审核的04B-3命令与状态。依赖方向为 `01 → 02 → 03` 和 `01/02/03 → 04A → 04B-1 → 04B-2 → 04B-3 → 04C`。04B-1/2/3是同一文件、同一Journal、同一状态机和同一组公开接口的内部审核点，不创建第二套phase、SnapshotStore或Integration Journal。

### 2.1 新的跨阶段接口图

```text
Plan 01
CodexBridgeEvent + CodexIntegrationPaths + DiscoveryOwner + GUI PE metadata
        │
        ▼
Plan 02（进程级 managed state）
CodexAggregator ──CodexStateDraft──▶ CodexSnapshotStore ──global revision──▶ CodexStateSnapshot
        │                                  ▲
        │ authenticated activity           │ stop/uninstall/failed install: clear()
        ▼                                  │
Runtime generation + generation-aware Reporter + owner-aware HTTP/Exit cleanup
        │                                  │
        ├──────── CodexRuntimeFacts ────────┘
        ▼
04A static CodexIntegrationInspection + derive_codex_listening_status()
        │                         │
        │ Prepared Hook change    └──▶ CodexListeningStatus（唯一动态状态）
        ▼
04B CodexIntegrationTransactionJournal
        │ Prepared → BridgeApplied → ConfigApplied → StructureCommitted
        ├── ConfigApplyTransaction（同一 transactionId，进程内终结）
        └── BridgeInstallTransaction（同一 transactionId，进程内终结）
        │ Prepared后optimistic precondition check/完整staging
        │ existing ReplaceFileW snapshot / absent no-replace publish / removal tombstone
        │ StructureCommitted前按逐文件状态回滚 / Conflict安全retry / 之后只清理
        ▼
CodexHookChangeResult { inspection, listeningStatus, selfCheck }
        │
        ├──▶ Plan 03/Widget: snapshot + listeningStatus
        └──▶ 04C/Settings: static inspection + dynamic listeningStatus
```

图中只有 SnapshotStore 分配公开 revision，只有 ListeningStatus 暴露动态 phase，只有当前 Runtime generation 的真实认证事件可以令 phase=running。

## 3. 跨阶段准确接口

所有模块共享以下唯一路径对象；只有 `src-tauri/src/codex/paths.rs` 可以拼接 `CodePulse`、`runtime` 和 `bin`，HTTP、发现文件、Runtime Manager、inspection、planner、writer、Bridge installer、事务恢复、自检与 Tauri commands 都消费同一个对象：

```rust
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
```

Tauri 组装层精确使用 `let local_data_root = app.path().local_data_dir()?;` 取得 Windows 本地数据根目录，再把该根传给上述构造函数；`let codepulse_root = local_data_root.join("CodePulse");` 只出现在构造函数内部。固定结果是 `%LOCALAPPDATA%\CodePulse\bin\...`、`%LOCALAPPDATA%\CodePulse\runtime\...` 与 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json`，不得出现 bundle identifier。只有 `paths.rs` 可以拼接 `codex-integration-transaction.json`；测试必须传入虚构根目录并断言全部字段从参数推导。

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

`occurredAt` 只验证为非负整数，并只允许用于诊断或必要公开展示。它不得用于当前轮次事件排序/淘汰、任务列表/代表任务排序、一秒平滑、完成保留、10/30 分钟中断或 attention 过期。当前轮次状态按 Actor 实际接收顺序更新。随机`eventId`标识单次Bridge投递并作为第一层去重；第二层逻辑事件键只能从`sessionId`、`turnId`、`eventType`、`toolUseId`、`agentId`中按事件类型选取稳定字段。每种事件的确切字段组合必须在阶段二实施前根据最新官方Hook字段重新确认。逻辑键禁止包含prompt正文、cwd、文件路径、命令正文、tool input/output或任何用户内容摘要。

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
```

`token` 为每次 HTTP runtime 启动重新生成的 `32` 个随机字节（256 位）小写十六进制字符串。固定端口 `127.0.0.1:47653` 仅在 `AddrInUse` 时降级到 `127.0.0.1:0`；其他绑定错误直接进入服务异常。

`DiscoveryOwner` 必须由本次写入的完整 `CodexDiscovery` 转换得到，并由 HTTP handle、`DiscoveryGuard`、Runtime generation 和退出兜底共同持有。正常 shutdown、invalidate、serve 错误、task drop、Runtime stop 与 `RunEvent::Exit` 都只能调用 `remove_discovery_if_owned()`；删除前至少完整比较 version/PID/token/startedAt。文件不存在返回 `AlreadyAbsent`；owner 不同返回 `ReplacedByNewRuntime` 并保持文件；读取/解析失败不得由旧 Guard 盲删，当前明确退出流程只记录 warning。

### 3.2 HTTP 到聚合器的内部入口

阶段一创建容量为 `256` 的 `tokio::sync::mpsc`：

```rust
pub type CodexEventSender = tokio::sync::mpsc::Sender<CodexBridgeEvent>;
pub type CodexEventReceiver = tokio::sync::mpsc::Receiver<CodexBridgeEvent>;

pub fn codex_event_channel() -> (CodexEventSender, CodexEventReceiver);
```

HTTP 处理器仅完成二次校验/脱敏并调用 `try_send`；阶段二 Actor 独占 Receiver。队列满时不等待、不重试，直接返回 `429`。

### 3.3 聚合 draft、进程级 SnapshotStore 与公开快照

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

Aggregator 不拥有公开 revision，只产生内部 draft：

```rust
pub struct CodexStateDraft {
    pub generated_at: i64,
    pub tasks: Vec<CodexTaskState>,
    pub representative_session_id: Option<String>,
    pub attention: Option<CodexAttention>,
}

pub struct CodexSnapshotStore {
    current: std::sync::RwLock<CodexStateSnapshot>,
    next_revision: std::sync::atomic::AtomicU64,
}

impl CodexSnapshotStore {
    pub fn new(initial_generated_at: i64) -> Self;
    pub fn current(&self) -> CodexStateSnapshot;
    pub fn commit(&self, draft: CodexStateDraft) -> CodexStateSnapshot;
    pub fn clear(&self, generated_at: i64) -> CodexStateSnapshot;
}
```

`CodexSnapshotStore` 是由 Tauri setup 只构造一次并显式注入 `CodexRuntimeManager` 的进程级状态，从进程启动存活到退出。初始 current 是 version=1、revision=0、tasks=[]、representativeSessionId=None、attention=None 的合法空快照，`next_revision` 从 1 开始。`commit()`/`clear()` 在写锁内分配大于 current.revision 的 revision、替换 current 并返回完整快照；Actor 只能提交 draft，publisher 只能发布 Store 返回的快照。soft interrupt 先由 Aggregator 产生不带 revision 的边沿草稿，再由 Actor 绑定对应提交快照的全局 revision；不得再保留 Aggregator revision。Manager 不允许 `Default`、无参数构造或内部 `CodexSnapshotStore::new()`；Runtime start/restart 把 `runtime.snapshot_store()` 返回的同一 Arc 传给 Actor。

Runtime dormant、not_installed、disabled、managed disabled、config conflict 或 Runtime 已停止时，`get_codex_snapshot()` 都直接成功返回 `SnapshotStore.current()`。停止、卸载、generation 替换或无旧合法 Runtime 的启动失败按“停止接收事件 → owner-aware 清理并关闭旧 Actor/HTTP → `SnapshotStore.clear()` → 发布更高 revision 空快照 → 发布 listening status”执行，因此同一 Runtime 内与跨 Runtime 的 revision 都严格递增。

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

Runtime 的动态事实固定为：

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

pub trait CodexActivityReporter: Send + Sync + 'static {
    fn record_authenticated_event(
        &self,
        runtime_generation: u64,
        source: CodexSource,
        received_at: i64,
    );
}
```

`CodexRuntimeManager` 持有 `next_runtime_generation: AtomicU64`。每次真正创建 HTTP/Actor Runtime 都消耗一个不复用的非零 generation，并把 generation 绑定 HTTP listener、Actor、token、Discovery owner 与 reporter；启动失败可以消耗编号。新 Runtime 启动前清空 authenticatedGeneration/lastEventAt/sources/旧错误/旧端口，成功后才成为 current generation；停止后 current 为 None。reporter 只有在 `reported_generation == current_runtime_generation` 时才更新动态事实，旧 Runtime 晚到事件和关闭回调一律忽略。只有 current generation 非 None 且 `authenticated_generation == runtime_generation` 才能进入 running；self-check 永远不能替代真实事件认证。

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
- 阶段四新增 `inspect_codex_integration()`、`preview_codex_hook_change(action)`、`apply_codex_hook_change(action, expected_digest, preview_digest)`、`retry_codex_integration_recovery()`。

`get_codex_snapshot()` 不依赖 Actor。`clear_codex_task()` 在 Runtime 运行时交给 Actor 顺序处理；Runtime dormant 且空快照不存在该 session 时返回稳定 `UnknownSession`，不得映射成 service_error。`clear_all_codex_failures()` 在 Runtime 运行时交给 Actor，dormant 时直接返回 Store 当前空快照。Actor 不存在不是快照查询或空集合清除的服务异常。

前端唯一 Agent 投影接口固定为：

```ts
export function toAgentModuleSnapshot(
  snapshot: CodexStateSnapshot,
  listeningStatus: CodexListeningStatus,
  idlePersistent: boolean
): IslandModuleSnapshot
```

有任务时任务状态优先。无任务时：running 只在 idlePersistent=true 时显示 paused/“Codex 已就绪”；awaiting_trust 显示 warning/“等待 Codex 信任”；partial 显示 warning/“Codex 部分可用”；service_error 显示 error/“Codex 服务异常”；config_conflict 显示 warning/“Codex 配置冲突”；not_installed 与 disabled 隐藏。idlePersistent 不能启动 HTTP，也不能掩盖未安装、禁用或异常；设置页与 Widget 消费同一份 CodexListeningStatus。

Runtime Manager 的内部接口固定为：

```rust
impl CodexRuntimeManager {
    pub fn new(
        app: tauri::AppHandle,
        paths: CodexIntegrationPaths,
        snapshot_store: Arc<CodexSnapshotStore>,
    ) -> Self;

    pub async fn ensure_started(
        &self,
        reason: CodexRuntimeStartReason,
    ) -> Result<(), CodexRuntimeError>;

    pub async fn stop_if_unused(
        &self,
        reason: CodexRuntimeStopReason,
    ) -> Result<(), CodexRuntimeError>;
}
```

`CodexRuntimeStartReason` 只允许 `StartupInspection`、`InstallSelfCheck`、`RepairSelfCheck`；`CodexRuntimeStopReason` 固定为 `StartupInspectionDisallows`、`InstallFailed`、`Uninstalled`、`RuntimeGenerationReplaced`、`RuntimeErrorStateCleared`。后两项分别覆盖同进程替换旧 generation 与 Runtime 错误后明确清理当前状态；五种 stop 都执行 Store.clear/空快照发布。UI 显示偏好没有调用这些接口的路径。

manager 的 Tauri 状态装配固定使用 Tauri 2.11.5 的 `Manager::manage<T: Send + Sync + 'static>()` 只注册一个进程级 manager；不单独 `manage<CodexSnapshotStore>()`，命令统一通过 `runtime.snapshot_store()` 进入唯一 Store。setup 固定为：

```rust
let snapshot_store = Arc::new(
    CodexSnapshotStore::new(initial_generated_at)
);

let runtime = CodexRuntimeManager::new(
    app_handle.clone(),
    paths,
    Arc::clone(&snapshot_store),
);

app.manage(runtime);
```

测试用 `Arc::ptr_eq(&provided_store, &runtime.snapshot_store())`、Store 构造计数器与 start→Actor→stop→restart 序列证明所有入口使用同一实例；dormant `get_codex_snapshot()` 也只读该注入 Store。退出路径继续使用 `App::run` 的 non-exhaustive `RunEvent::ExitRequested { code, api, .. }`、同步 `api.prevent_exit()` 和异步完成后的 `AppHandle::exit(saved_code)`；`RunEvent::Exit` 仅做 owner-aware 同步兜底。

### 3.5 Hook 配置变更接口

Inspection 内部必须保留 Feature 两个键的原始事实，不能只保留最终枚举：

```rust
pub enum CodexHooksFeature {
    Enabled,
    Disabled,
    ManagedDisabled,
    ConfigConflict,
}

pub enum CodexIntegrationIssueCode {
    DeprecatedCodexHooksAlias,
    DuplicateHooksFeatureKeys,
    HooksFeatureTypeConflict,
    HooksFeatureValueConflict,
    // 其余既有稳定 Issue code 保持在同一枚举。
}

pub struct CodexHooksFeatureInspection {
    pub canonical_value: Option<bool>,
    pub deprecated_alias_value: Option<bool>,
    pub effective_state: CodexHooksFeature,
    pub issue_codes: Vec<CodexIntegrationIssueCode>,
}
```

两个键都缺失时为 Enabled；只有标准键按标准值；只有 `codex_hooks` 按别名值并增加 `DeprecatedCodexHooksAlias`；两个键同值时按该值并增加 `DeprecatedCodexHooksAlias` 与 `DuplicateHooksFeatureKeys`；两个键冲突、别名非布尔或标准键非布尔时为 ConfigConflict。CodePulse 从不删除、改名或统一这两个键。`requirements.toml` 只按官方明确的 `[features].hooks` 与 `allow_managed_hooks_only` 识别；2026-07-16 官方文档未说明 managed 配置接受旧别名，因此企业文件中的 `codex_hooks` 不作为有效策略键，只产生只读诊断且企业文件永不修改。

```ts
export type CodexHookAction = 'install' | 'repair' | 'uninstall'
export type CodexHookRepresentation = 'hooks_json' | 'config_toml' | 'none' | 'conflict'
export type CodePulseMarkerPresence = 'absent' | 'present' | 'ambiguous'

export interface CodexIntegrationInspection {
  codexHome: string
  featureConfigPath: string
  representation: CodexHookRepresentation
  configPath?: string
  configDigest?: string
  hooksFeature: 'enabled' | 'disabled' | 'managed_disabled' | 'config_conflict'
  managedEntry: 'absent' | 'exact' | 'modified' | 'duplicate'
  markerPresence: CodePulseMarkerPresence
  bridgeState: 'missing' | 'current' | 'outdated' | 'modified'
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
  listeningStatus: CodexListeningStatus
  selfCheck: CodexSelfCheckResult
}
```

`CodexIntegrationInspection` 只含静态事实，不能包含 hookState/phase；公开对象可只暴露最终 `hooksFeature` 与稳定中文 `issues`，但 04A 内部测试必须直接验证 `CodexHooksFeatureInspection` 的两个 Option 值、effectiveState 与 issueCodes。`inspect_codex_integration()` 只重新读取这些事实。唯一动态状态由 `derive_codex_listening_status(&inspection, &runtime_facts)` 返回，设置页、Widget 与 composable 都只从 `CodexListeningStatus` 读取服务/Hook/phase。apply 同时返回静态 inspection 与当时完整 listeningStatus，后续 listening event 只替换动态对象。

| Hooks 状态 | Install | Repair | Uninstall |
|---|---|---|---|
| 本地 enabled | 允许 | 允许 | 允许 |
| 本地 disabled | HooksDisabled | HooksDisabled | 有安全 marker 时允许 |
| managed disabled | ManagedDisabled | ManagedDisabled | ManagedDisabled |
| config conflict/ambiguous | ConfigConflict | ConfigConflict | ConfigConflict |

`configPath` 是 Hook 表示的主文件；`featureConfigPath` 只用于告诉用户手动启用 Hooks 的配置位置。本地 `[features].hooks=false` 或只有 `codex_hooks=false` 时 install/repair 返回稳定 `HooksDisabled`，但当 representation 可安全解析、markerPresence=present 且 managedEntry 为 exact/modified/duplicate 时，允许 preview/apply uninstall，只精确删除 CodePulse marker；不得安装 Bridge或启动 Runtime。只有旧别名时 UI 额外提示“检测到旧版 codex_hooks 配置，请在 Codex 中改用 hooks。”两个 Feature 键冲突时 install/repair/uninstall 全部返回 ConfigConflict，不产生 Prepared change，Runtime RemainStopped，UI 不显示任何变更按钮。managed disabled 对 install/repair/uninstall 全部返回 `ManagedDisabled`；config conflict/ambiguous 不自动卸载。`expectedDigest` 是所有决策输入（`hooks.json`、`config.toml`、只读 `requirements.toml`、Bridge 资源/副本/安装记录）的路径、存在性和原始 SHA-256 经排序后的组合摘要。`previewDigest` 是规范化变更计划的 SHA-256；应用时重新计算两种摘要，任何不一致都停止写入。

04A 必须创建并以 `include_str!`/统一 AST loader 消费唯一标准母版 `fixtures/codepulse-hooks-exact.json` 与 `fixtures/codepulse-hooks-exact.toml`。两者事件集合精确为 SessionStart、UserPromptSubmit、PreToolUse、PermissionRequest、PostToolUse、SubagentStart、SubagentStop、Stop；每个事件只有一个 matcher 组和一个 command handler，八个 matcher 组全部省略 matcher。每个 handler 同时包含基础 `command` 与 Windows override，命令均为带引号的稳定 Bridge 绝对路径加 `--codepulse-hook-v1`，timeout=2，且没有 statusMessage、async、prompt 或 agent handler。JSON 写 `commandWindows`，TOML 标准写 `command_windows`；`__CODEPULSE_BRIDGE_PATH__` 是唯一允许的占位符，但禁止对原始 JSON/TOML 文本做路径替换：JSON 必须先由 `serde_json` 解析成 AST、只改 CodePulse handler 的 `command`/`commandWindows` string value、再由 serializer 产生目标字节；TOML 必须先由 `toml_edit` 解析成 `DocumentMut`、只改 `command`/`command_windows` 的 `Value`、再由 `toml_edit` 输出。命令字符串统一由 `build_codepulse_hook_command(&Path)` 构造。

Exact接口固定显式接收期望稳定路径：`normalize_codepulse_hook_commands_for_exact(representation, actual, expected_bridge_path)`。只有`type=command`、基础command与Windows override都存在且逐字等于`build_codepulse_hook_command(expected_bridge_path)`、参数恰好为`--codepulse-hook-v1`无附加项、事件属于标准八种且matcher结构符合Fixture时，handler才是CodePulse-owned。其他EXE加marker、旧Bridge路径、双command任一错误/缺失或附加`--extra`都不得被规范化成Exact。

Exact比较的是CodePulse projection，不是完整用户配置：解析完整AST→提取独立且结构合法的CodePulse-owned matcher groups→保留事件/group/handler三层结构→只把两个已验证command value改回占位符语义→与标准Fixture AST比较。用户独立matcher group不进入projection且不影响Exact；若用户handler与CodePulse handler混在同一group，则为Modified，Repair保留用户handler并创建独立标准CodePulse group。Planner Install、Inspection Exact、Repair、序列化快照、Marker Duplicate/Modified与04C脱敏语义E2E必须消费同一loader并传入`paths.installed_bridge`，不得手写第二套模板、第二个投影器或`actual_text.replace(...)`。

### 3.6 统一 Integration Transaction 边界

配置与 Bridge 不再拥有彼此无关的崩溃恢复状态。唯一持久化 Journal 位于 `paths.integration_transaction_file`，固定路径为 `%LOCALAPPDATA%\CodePulse\runtime\codex-integration-transaction.json`：

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

pub enum CodexIntegrationCommitInvariant {
    InstalledOrRepaired,
    Uninstalled,
}
```

Journal只记录action、阶段、路径、存在性、摘要、事务拥有的temp/prepared backup/replaced snapshot/conflict-preserved-current/removed tombstone位置和时间；禁止包含配置正文、Token、Hook输入、用户命令、项目路径正文、Bridge二进制内容、Handle、file ID或`StableArtifactLease`。`target_bridge_exists`/`target_record_exists`是为Uninstall增加的最小存在性事实；为false时对应target digest固定为SHA-256(empty bytes)，存在性位区分“缺失目标”和“零字节文件”。Config的事务Target始终应存在且可解析，但`existed_before`允许为false，以支持新Hook文件按Absent语义首次发布。所有事务路径必须由`transactionId + target filename`确定性推导并在Prepared Journal中落盘：prepared backup在Prepared后从originalDigest对应字节创建；replaced snapshot由`ReplaceFileW`在实际替换瞬间捕获；conflict-preserved-current由第二次安全恢复`ReplaceFileW`保存当前CodePulse Target；removed tombstone由Uninstall的原子rename捕获。禁止新增第二个事务日志，`CodexIntegrationPaths`不增加事务staging字段。Journal自身的原子写temp仍由`paths.integration_transaction_file + transactionId`确定性推导为`.<journal-filename>.codepulse-<transactionId>.tmp`；其写入器属于CodePulse自有Journal元数据更新，不得被writer/installer复用为用户artifact替换接口。

`StableArtifactLease`固定用`CreateFileW(path, GENERIC_READ | FILE_READ_ATTRIBUTES, FILE_SHARE_READ, ..., OPEN_EXISTING, ...)`打开；ShareMode严禁包含`FILE_SHARE_WRITE`或`FILE_SHARE_DELETE`。成功后通过同一Handle调用`GetFileInformationByHandleEx(FileIdInfo/FileStandardInfo/FileBasicInfo)`取得volume serial、128位file ID、size与必要属性，并可用`GetFileInformationByHandle`交叉验证兼容字段；关键摘要使用`ReadFile`/句柄游标只从该Handle计算，禁止`std::fs::read(path)`或重新按路径打开。摘要前后再次读取Handle身份与size，任一变化或路径重新获取Lease后file ID不同均为`IdentityChanged`。原始`ERROR_SHARING_VIOLATION`无法可靠区分活动写句柄、writable mapping与delete/rename access，因此生产内部只返回`SharingViolation`，并无条件映射为公开稳定错误`ActiveArtifactHandleConflict`；安全决策和UI文案都不猜测冲突来源。测试可以分别制造三类占用，但统一断言`SharingViolation`/`ActiveArtifactHandleConflict`。Lease最多复用既有三次、间隔50ms的短重试，仍失败立即Conflict，绝不无限等待。

启动恢复先区分稳定Journal是否存在。稳定Journal存在时，完整解析它并以其中transactionId为唯一权威ID，只处理该ID的Journal temp及Config/Bridge/Record staging/capture artifacts；其他ID的Journal temp、目标artifacts不删除，只记录诊断。稳定Journal不存在时，只枚举精确`.<journal-filename>.codepulse-<32hex>.tmp`，禁止扫描普通`*.codepulse-*.tmp`/`*.codepulse-*.bak`。候选必须同时满足文件名ID为32hex、内容完整反序列化、内容ID等于文件名、stage=Prepared、Journal三目标仍为Original/ExpectedAbsent、同ID不存在target temp/prepared backup/replaced snapshot/conflict-preserved-current/removed tombstone；满足的一个或多个Prepared-only temp都可删除。损坏、ID不匹配、非Prepared、目标变化或同ID capture artifact存在时保留temp并返回`OrphanTransactionConflict`，不启动Runtime、不修改目标。该判断依赖单实例插件；未来移除单实例前必须先引入进程间事务锁。

阶段语义固定为：

- `Prepared`：在创建本事务任何 backup/temp、修改 Bridge/记录或配置之前持久化；Journal 已包含原配置/Bridge/记录摘要、目标摘要和全部确定性 staging 路径。
- `BridgeApplied`：Bridge 与安装记录已经替换，配置尚未修改。
- `ConfigApplied`：Hook 配置已经替换，但 post-write Inspection 尚未确认 Exact。
- `StructureCommitted`：action-specific post-write invariant 已验证；Install/Repair 要求 CodePulse marker=Exact、Bridge/记录均为 Target 且 PE/hash/piped 契约正确，Uninstall 要求 marker=Absent、配置不再引用稳定 Bridge、Bridge/记录均不存在。功能结构正式提交，只剩清理。

两个内部对象继续保留，但必须接收同一个 `transaction_id` 并由同一 Journal coordinator 驱动：

```rust
pub struct ConfigApplyTransaction;
pub struct BridgeInstallTransaction;

pub fn prepare_config_apply(
    paths: &CodexIntegrationPaths,
    prepared: &PreparedCodexHookChange,
    transaction_id: &str,
) -> Result<ConfigApplyTransaction, CodexIntegrationError>;

pub fn prepare_bridge_install(
    paths: &CodexIntegrationPaths,
    target_triple: &str,
    action: BridgeAction,
    transaction_id: &str,
) -> Result<BridgeInstallTransaction, CodexIntegrationError>;

pub fn recover_interrupted_codex_integration_transaction(
    paths: &CodexIntegrationPaths,
) -> Result<CodexIntegrationRecoveryOutcome, CodexIntegrationError>;

pub fn validate_structure_commit(
    action: CodexHookAction,
    inspection: &CodexIntegrationInspection,
    bridge: &ObservedBridgeState,
) -> Result<CodexIntegrationCommitInvariant, CodexIntegrationError>;
```

transactionId 必须在两个 transaction prepare 之前分配。`prepare_config_apply()` 与 `prepare_bridge_install()` 都只读取文件、构造目标字节、验证 PE/hash/piped 契约、计算摘要与确定性 staging/捕获路径并把目标材料保存在内存；不得创建 backup/temp/snapshot/tombstone、不得替换稳定 Bridge/记录/配置，也不得创建第二个日志。完整Prepared Journal原子持久化成功后，coordinator先重新读取Config/Bridge/Record并调用`verify_artifact_matches_expected_original()`；只有三者均Original/ExpectedAbsent才允许创建本transactionId的prepared backup/temp，Target或ExternalModification均返回`ConcurrentModification`/稳定Conflict并保留Journal，不采用新字节为Original。这个步骤统一称为 **optimistic precondition check**：重新读取目标、按originalDigest/targetDigest分类、决定是否允许尝试下一次原子文件操作；它只能提前发现修改，绝不是原子CAS，也不能证明检查后目标不会再次变化。

每个existedBefore=true的prepared backup必须从当前目标重读原字节，摘要先等于Journal.originalDigest，再用`create_new(true)`创建确定性backup，write→flush→close→重读backup后摘要仍等于originalDigest；失败时零目标替换。existedBefore=false要求prepared backup=None且目标仍缺失，否则ExternalModification。target temp也须close后重读并匹配targetDigest；targetExists=false使用已验证“无替换payload”状态且不能以零字节文件冒充缺失。替换第一个目标前，Config/Bridge/Record prepared backup/temp（或无payload状态）、全部replaced snapshot/tombstone/conflict-preserved-current确定性路径均已写入Journal，且当前Prepared Journal transactionId必须通过all-staging-ready屏障。

三种原子语义必须由统一`AtomicIntegrationFs`分别实现，writer与installer不得各自实现替换规则，也不得抽象成一个`move_with_replace(...)`：

1. **Atomic existing-file replacement**：`existed_before=true && target_exists=true`时，在optimistic precondition check、replacement temp targetDigest与当前Journal ID/阶段都通过后调用`ReplaceFileW(target, replacement_temp, transaction_owned_replaced_snapshot, ...)`。成功后的固定顺序是：获取target `StableArtifactLease`→获取replaced snapshot `StableArtifactLease`→通过target Lease计算target digest→通过snapshot Lease计算snapshot digest→验证两个volume serial/file ID组合不同。只有target=`targetDigest`、snapshot=`originalDigest`且两个Lease均成功，才返回`AppliedExpectedOriginal`。任一Lease取得失败返回`ActiveArtifactHandleConflict`，不再按路径读取、不清snapshot、不继续下一文件，保留current target、snapshot、prepared backup与Journal，停止Runtime并发布`IntegrationTransactionConflict`；snapshot摘要稳定但不等于originalDigest才进入late modification分支。
2. **Atomic absent-file publication**：`existed_before=false && target_exists=true`时，用同目录且不带`MOVEFILE_REPLACE_EXISTING`的no-replace原子move/rename发布transaction temp。若目标在最后时刻出现，原子操作必须失败并返回`DestinationAppeared`；保留外部目标与transaction temp，绝不覆盖。成功后立即获取新target Lease并只通过Handle计算摘要；Lease失败或摘要不等于`targetDigest`时不采用当前字节为事务Target、不删除目标、不继续下一文件，保留Journal并Conflict。
3. **Atomic removal capture**：Uninstall删除已有Bridge/Record时不得调用`DeleteFileW`，而是先optimistic precondition check，再把目标no-replace原子rename到本transactionId的removed tombstone。成功后固定获取tombstone Lease、通过该Handle计算摘要、在Lease仍持有时验证原目标路径absent。Lease失败时不按路径读tombstone、不永久删除、不进入`Uninstalled` invariant；摘要不符或目标路径重建同样保留全部版本并Conflict。StructureCommitted前不得永久删除tombstone。

existing replacement捕获到稳定late modification后固定重新分类当前target，但第二次恢复只能在第一次`ReplaceFileW`后的target与snapshot Lease均成功且句柄摘要稳定后决定。snapshot Lease失败时禁止自动执行第二次`ReplaceFileW`。若当前target仍为本事务Target，先显式释放这两个会阻止delete/rename的Lease，再调用`ReplaceFileW(current_target, replaced_snapshot, transaction_owned_conflict_preserved_current, ...)`：真实外部修改回到目标路径，CodePulse Target被保存到conflict-preserved-current；随后重新获取restored target与conflict-preserved-current Lease，并分别通过Handle验证restored target等于第一次稳定snapshot digest、conflict-preserved-current等于`targetDigest`。任一Lease或摘要失败时保留两个版本、Journal与诊断并Conflict；两个Lease均成功后仍记录恢复完成并返回Conflict，供用户审计和安全retry。若当前target已经不等于本事务Target，不覆盖当前target，同时保留snapshot、prepared backup和当前target。任何路径都不得用prepared backup覆盖late snapshot，也不得自动决定两个外部版本谁更正确。

成功应用一个目标后，`AppliedArtifactLeases`进入当前进程的统一事务句柄：Bridge/Record相关Lease至少保持到`BridgeApplied` Journal原子持久化，Config/Bridge/Record最终Lease保持到`StructureCommitted` Journal原子持久化；阶段推进失败时保持Lease、停止后续操作并进入Conflict，不能先drop再继续。Runtime self-check只需普通共享只读访问，与`FILE_SHARE_READ` Lease兼容。StructureCommitted成功后才释放普通事务Lease，并为每个普通artifact新取得cleanup Handle；进程崩溃自然释放Handle，startup recovery重新获取，不把Lease写入Journal。

Bridge apply 后把同一 Journal 推进到 BridgeApplied；Config apply 后推进到 ConfigApplied；action-specific invariant 成功后先推进到 StructureCommitted，再调用两个 handle 的 `commit()`。Config/Bridge 的 `commit()` 只终结进程内资源，不能定义跨进程提交；StructureCommitted 是唯一跨进程结构提交点。

每个目标文件都通过同一个纯分类器独立分类为`Original`、`Target`、`ExpectedAbsent`或`ExternalModification`。分类同时输入existedBefore、originalDigest、targetExists、targetDigest、当前存在性与当前digest：当前缺失且事务前不存在为ExpectedAbsent；事务前存在且当前等于originalDigest为Original；当前存在性/摘要等于事务目标为Target；其余为ExternalModification。Config的事务targetExists固定为true，但existedBefore可以为false；Bridge/Record使用Journal的显式target exists位。分类器只服务optimistic precondition check与恢复决策，原子性来自上述三个Windows文件操作语义，不来自分类器。

恢复矩阵固定为：

- `Prepared`：没有已确认的目标替换；恢复在分类任何实际存在的target、replaced snapshot、conflict-preserved-current、tombstone或prepared backup前都先获取Lease并通过Handle取身份/摘要。Journal明确期望absent且`CreateFileW`返回`FileMissing`的可选路径只作为`ExpectedAbsent`输入，任何预期应存在的文件缺失及其他Lease失败都立即Conflict；不得以普通路径读取降级。当配置、Bridge与记录仍为Original/ExpectedAbsent时，只清理Journal明确列出的本transactionId staging并保持目标不变。若原子操作已成功但阶段落盘滞后，则按稳定Handle观察到的target/capture artifact进入下一安全分支。
- `BridgeApplied`（Install/Repair）：恢复优先级保持1当前target；2replaced snapshot、removed tombstone、conflict-preserved-current；3prepared backup；4Journal digest，但每个实际存在文件只有在Lease成功、file ID固定、Handle摘要符合预期后才可参与自动恢复。高优先级artifact的Lease失败时禁止降级到prepared backup，保留全部证据并Conflict。需要执行`ReplaceFileW`/rename前只释放本次操作相关Lease，操作后立即重新获取结果Lease并验证；后置Lease失败按`ActiveArtifactHandleConflict`处理。一个Target、另一个Original/ExpectedAbsent仍是合法双文件中间崩溃，只回滚稳定Target；late snapshot仍高于prepared backup。
- `ConfigApplied`（Install/Repair）：沿用相同Lease门禁与优先级。配置为Target且Bridge/记录均Target、所有正常snapshot都在Lease下证明实际旧内容等于各自originalDigest时才执行`InstalledOrRepaired` invariant；失败且无外改时先回滚Config，再逐文件回滚Bridge/记录。Config snapshot为稳定late modification时先保护/恢复真实Config外改；Bridge/Record任一capture Lease失败时不继续Config。任何ExternalModification、`ActiveArtifactHandleConflict`、conflict-preserved-current或无法安全恢复的snapshot都不覆盖用户字节、不删除仍可能被引用的Bridge，并返回Conflict。
- `StructureCommitted`：保留已提交目标；正常artifact cleanup不再采用“按路径重读摘要→调用路径型`DeleteFileW`”。先确认stage已持久化并释放对应普通事务Lease，再对每个非Conflict prepared backup/正常snapshot/已提交tombstone/temp调用`delete_verified_artifact_by_handle(path, expectedDigest)`，重新以`CreateFileW(GENERIC_READ | DELETE, FILE_SHARE_READ, OPEN_EXISTING)`取得cleanup Handle。使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记，再关闭Handle并检查路径absent、delete pending或path reuse。它不是原普通`StableArtifactLease`：禁止给原Lease增加`DELETE`权限、释放后按路径调用`DeleteFileW`、先按路径读摘要再重新按路径删除。cleanup取得或执行失败只返回Warning并保留StructureCommitted Journal供下次startup recovery，不回滚Hook/Bridge；Conflict artifact永远不得进入普通cleanup。

Install与Repair的回滚规则必须区分稳定路径引用：`bridge_existed_before=false`时只有确认配置不再引用稳定路径才允许处理本事务新Bridge；`bridge_existed_before=true`时优先把`ReplaceFileW`实际捕获且摘要等于originalDigest的replaced snapshot恢复到同一路径并恢复旧记录，prepared backup只在没有late snapshot且捕获版本不可用的安全分支作后备。Hook即使一直引用该路径也不能阻止同路径旧版本恢复；路径引用检查只防止移除，不阻止恢复旧字节。

Uninstall 复用同一 Journal但不经过 Install/Repair 的 BridgeApplied 语义：Prepared → ConfigApplied(marker absent) → stop Runtime/clear Store → 原子捕获 Bridge/Record tombstone → StructureCommitted。ConfigApplied恢复先验证marker仍Absent且配置不再引用稳定Bridge；每个待删目标依次执行optimistic precondition check与no-replace原子rename到本transactionId tombstone，随后必须取得tombstone Lease、通过同一Handle验证摘要并确认目标absent。Lease失败不分类、不恢复、不永久删除并进入可重试Conflict。摘要不符时，只有Lease成功且目标路径仍absent才可释放相关Lease后no-replace恢复，操作后再获取restored target Lease验证；目标已被重新创建时保留两者。只有Marker=Absent、配置无稳定路径引用、Bridge/Record目标路径absent且对应tombstone Lease稳定并受Journal控制，才能通过`Uninstalled` invariant并推进StructureCommitted；之后才通过`delete_verified_artifact_by_handle`清理tombstone，失败只warning且不恢复Hook。

Install/Repair 固定执行顺序为：1重新静态Inspection；2重新计算expectedDigest/previewDigest；3分配唯一transactionId；4先`prepare_config_apply`、再`prepare_bridge_install`，纯计算两类目标材料与全部捕获路径；5验证Bridge PE/hash/piped契约；6构造完整Prepared Journal；7原子持久化Prepared Journal；8三目标optimistic precondition check通过后创建prepared backup/temp并完成originalDigest/targetDigest/all-staging-ready屏障；9按existing/absent调用`ReplaceFileW`或no-replace publish，随后立即取得每个结果target/capture的Lease并通过Handle验证摘要与file ID，逐个应用Bridge/记录；10保持Bridge/Record Lease并推进BridgeApplied；11必要时在共享只读兼容的Lease下启动临时Runtime；12确认Bridge/Record的Lease仍为本事务Target且无late snapshot，Config再次optimistic precondition check后按existing/absent原子语义应用并取得Config结果Lease；13保持全部最终Lease并推进ConfigApplied；14只用Lease身份/摘要执行action-specific post-write invariant；15保持Lease并推进StructureCommitted；16释放普通事务Lease，终结进程内事务句柄，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记；17发布ListeningStatus；18运行完整self-check；19返回结果。任一`CapturedLateModification`、`DestinationAppeared`、`ActiveArtifactHandleConflict`、原子操作失败或句柄摘要错误立即停止后续文件，保留Journal/current target/capture/prepared backup，停止Runtime并发布config_conflict；只允许安全retry。StructureCommitted之后self-check或cleanup失败只warning并派生partial/service_error，不回滚Hook、Bridge或旧配置。首次Install失败停止临时Runtime、清空并发布Store、owner-aware删除discovery；Repair失败恢复原结构并保持原合法链路。

Conflict恢复命令固定为：

```rust
pub struct CodexIntegrationRecoveryResult {
    pub outcome: CodexIntegrationRecoveryOutcome,
    pub inspection: CodexIntegrationInspection,
    pub listening_status: CodexListeningStatus,
}

#[tauri::command]
pub async fn retry_codex_integration_recovery(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexIntegrationRecoveryResult, String>;
```

它与apply共用integration operation mutex。没有稳定Journal且没有孤立Journal temp时返回`NoPendingTransaction`；其余情况只重跑`recover_interrupted_codex_integration_transaction()`，对target/replaced snapshot/conflict-preserved-current/tombstone/prepared backup重新获取Lease并通过Handle分类，不强制删除Journal、不忽略摘要、不把用户新字节采用为Original、不改Feature键。任一应存在文件的Lease失败继续`IntegrationTransactionConflict`且Runtime停止；外部编辑器/映射关闭后再次点击，才可能重新取得Lease并继续既有恢复矩阵。成功恢复后重新静态Inspection、按Inspection决定Runtime启停并发布最新ListeningStatus；仍有外改或活跃句柄时字节不变。用户手工把文件恢复为Journal已知Original/Target/ExpectedAbsent后可再次重试，安全完成回滚、Handle cleanup或在invariant通过时提升StructureCommitted，无需重装。

应用启动固定顺序为：构造paths与唯一进程级SnapshotStore → `recover_interrupted_codex_integration_transaction()`（含稳定Journal权威ID/无稳定Journal精确孤立temp分支）→ 静态Inspection → Runtime启停决策 → 派生并发布ListeningStatus。`IntegrationTransactionConflict`/`OrphanTransactionConflict`时Runtime保持停止并发布稳定errorCode；禁止再先调用只恢复配置的接口。

## 4. 各阶段独立交付与验收

| 阶段 | 计划文档 | 独立交付物 | 阶段验收 |
|---|---|---|---|
| 1 | `2026-07-16-codex-status-island-01-bridge-http.md` | workspace、共享协议、唯一路径对象、GUI Subsystem Bridge、HTTP 服务、Discovery owner、完整 PE metadata 与打包资源 | 协议/Bridge/HTTP/路径测试通过；Bridge piped stdin/stdout 在所有失败路径严格 `{}`/空 stderr/0；A/B owner 竞态不误删；x64/ARM64+GUI 通过且 Console 被拒绝 |
| 2 | `2026-07-16-codex-status-island-02-aggregator-tauri.md` | 可注入时钟聚合器、进程级 SnapshotStore、顺序 Actor、Tauri 快照/清除/状态接口、generation-aware dormant manager 与退出协调器 | 生命周期与跨 Runtime revision 测试通过；dormant 查询为空且不报错；旧 reporter/owner 不污染新 Runtime；退出最多两秒且只启动一次 shutdown |
| 3 | `2026-07-16-codex-status-island-03-agent-ui.md` | TS 契约、权威快照 composable、紧凑态/列表/详情、Agent 多岛接入 | Vue 单元/组件/布局测试通过；更高 revision 空快照清旧任务；跨 Runtime 不重置 revision；列表详情导航、自动收缩、主/卫星切换无状态机进入 `IslandView.vue` |
| 4 总览 | `2026-07-16-codex-status-island-04-hook-settings-e2e.md` | 三个批次的依赖、共享接口、review 停止点与总门禁 | 只作为索引，不混入实施任务 |
| 04A | `2026-07-16-codex-status-island-04a-inspection-planner.md` | 只读静态inspection、Feature标准键/弃用别名事实、绑定稳定Bridge路径的标准JSON/TOML Fixture与CodePulse-owned projection、generation runtime facts、独立listening派生、action matrix与纯计划 | inspection JSON无动态字段；wrong-path不可能Exact；用户独立Hook不进入projection、混合group Repair保留用户handler；真实用户配置零写入 |
| 04B-1 | `2026-07-16-codex-status-island-04b-writer-installer.md` | 唯一Integration Journal、transactionId/owned staging、四正式阶段、optimistic precondition check、all-staging-ready、`ReplaceFileW`/absent publish/removal tombstone、Lease/identity/Handle摘要、recovery、孤立Journal temp与fault injection | 只验收事务和原子文件基础；无Tauri commands、Runtime启停、设置页或真实Bridge安装编排；完成后强制review |
| 04B-2 | 同上 | `ConfigApplyTransaction`、`BridgeInstallTransaction`、PE Machine/WindowsGui/hash/piped契约、Install/Repair/Uninstall coordinator、action-specific invariant、rollback与StructureCommitted清理边界 | 仅在04B-1批准后执行；不接Tauri commands或Runtime；完成后强制review |
| 04B-3 | 同上 | inspect/preview/apply/retry commands、operation mutex、startup recovery、Inspection驱动Runtime、Store clear、generation/DiscoveryOwner、ListeningStatus、self-check与公开错误映射 | 仅在04B-2批准后执行；完成后强制review，之后才可进入04C |
| 04C | `2026-07-16-codex-status-island-04c-settings-e2e.md` | 静态/动态分离设置卡、弃用别名/Conflict安全重试UI、手动Hooks引导与disabled卸载、显示偏好、自动/真实E2E | 重启revision/generation、精确竞态注入、snapshot/tombstone恢复、孤立Journal、逐文件混合恢复、路径绑定CodePulse projection、Discovery竞态、GUI无闪窗、UI/真实App Hook通过；CLI阻塞如实记录 |

每阶段完成时均运行该计划列出的局部测试、全量前端测试、Rust 测试、格式和静态检查；04A、04B-1、04B-2、04B-3、04C 每个审核点完成后必须停下来 review，未经新确认不得自动进入下一个审核点；验收失败时停留在当前边界，不用跳到后续层规避问题。04B三个内部审核点继续使用同一Journal、同一四阶段状态机和同一组公开接口。

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
2. Bridge crate root `main.rs` 固定声明 `#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]`，使每个 Hook 进程使用 Windows GUI Subsystem 而不弹控制台，同时保留父进程重定向的 stdin/stdout/stderr 管道。`scripts/build-codex-bridge.ps1` 从 `TAURI_ENV_TARGET_TRIPLE` 读取 Tauri 当前目标到 `$target`；未提供时从 `rustc -vV` 解析 host；只接受 `x86_64-pc-windows-msvc` 与 `aarch64-pc-windows-msvc`。发布构建执行 `cargo build -p codepulse-codex-bridge --release --target $target`，只从该 target 目录复制产物，随后解析 DOS Header、`e_lfanew`、`PE\0\0`、COFF Machine、Optional Header Magic/长度与 Subsystem；Machine 分别要求 `0x8664` 或 `0xAA64`，Subsystem 必须为 `IMAGE_SUBSYSTEM_WINDOWS_GUI = 2`，Console=3、未知值、非法 Magic 与短 Header 全部拒绝。
3. `package.json` 新增 `build:codex-bridge`；`tauri.conf.json.build.beforeBuildCommand` 在前端构建前运行它。`.gitignore` 忽略暂存 EXE，源码、脚本和锁文件仍入库。
4. `tauri.conf.json.bundle.resources` 使用资源映射，把暂存 EXE 放入安装包资源目录的 `bin/codepulse-codex-bridge.exe`。这里选 resources 而不是 `externalBin`：应用不把 Bridge 当常驻 sidecar 启动，Bridge 由 Codex Hook 单次启动；resources 也避免 sidecar 的 target-triple 文件名成为 Hook 路径。
5. 04B-2从`CodexIntegrationPaths.packaged_bridge`读取安装包版本，先按编译期target triple复查`WindowsPeMetadata { machine, subsystem: WindowsGui }`，再校验SHA-256和piped`--codepulse-self-check`启动契约，通过同目录临时文件与Windows原子替换安装到`CodexIntegrationPaths.installed_bridge`。Hook永远引用稳定路径，不引用版本化安装目录。
6. 每次 CodePulse 启动先用唯一进程级 Store 和路径对象恢复 Integration Transaction，再只读 inspection；只有 exact、modified 或带可识别 marker 的 partial 才允许启动 runtime。资源升级只有在现有条目与 CodePulse 精确签名、安装记录有效且副本未篡改时自动进行；modified 允许服务继续接收事件但禁止后台覆盖配置。
7. 卸载先精确移除配置条目并验证配置，再把稳定副本和安装记录原子捕获为本transactionId的removed tombstone；通过Uninstalled invariant并推进StructureCommitted后才清理墓碑。应用升级带入的新资源在下次启动修复稳定副本；旧安装包不会覆盖用户配置。

相关 Tauri 行为以官方 [Sidecar 文档](https://v2.tauri.app/develop/sidecar/)、[BundleConfig resources 参考](https://v2.tauri.app/reference/config/#bundleconfig) 和 [构建钩子环境变量](https://v2.tauri.app/reference/environment-variables/) 为实现核对依据。

## 7. 关键行为决策

### 7.1 并发、乱序与可测试时钟

- HTTP 并发只进入有界队列；一个 Actor 顺序处理 `Event`、`Tick`、`ClearTask`、`ClearFailures`、`GetSnapshot`、`Shutdown` 消息。
- `CodexAggregator<C: Clock>` 是无 Tauri、无 Tokio 定时器、无公开 revision 的纯状态对象；每次 `ingest()`/`tick()` 只读取一次同时含 Unix 墙上毫秒和进程内单调毫秒的 `ClockReading`，变化后产生 `CodexStateDraft`。生产 `SystemClock` 用 `SystemTime` 生成公开展示时间、用 `Instant` 生成生命周期时间；测试 `ManualClock` 可分别推进单调时间和跳变墙上时间。
- Actor独占两层有界去重缓存：第一层最多保存`2048`个随机`eventId`，第二层最多保存`2048`个逻辑事件键，均用`VecDeque + HashSet`淘汰最旧项。相同逻辑事件即使来自用户层和仓库层、拥有不同`eventId`，也只改变一次任务、提醒和子智能体计数；不同turnId、toolUseId或agentId的合法连续事件不得误去重。重复投递仍可记为当前generation的已认证活动，但不得再次提交draft。每个session另保存最近`8`个retired turnId；toolUseId关联工具开始/完成，agentId做子智能体计数去重。
- 逻辑键构造器在阶段二实施第一步重新核对最新官方Hook字段，并按事件类型只使用`sessionId`、`turnId`、`eventType`、`toolUseId`、`agentId`中的可用稳定标识。Bridge不扫描配置层或维护缓存，Vue不重新去重；不新增无法可靠判断的`DuplicateCodePulseHookAcrossLayers`状态。
- 新轮次事件先于 UserPromptSubmit 到达时建立临时轮次，后到的同 turnId UserPromptSubmit 只补任务摘要而不把阶段倒退为分析；retired turnId 的事件直接丢弃。当前轮次无论 wire occurredAt 增大、相等或减小都按 Actor 实际接收顺序处理；墙钟回拨两小时后的 running_tests 和 PermissionRequested 必须生效。
- wire occurredAt 只校验合法并可用于诊断/必要展示；它与公开墙上时间都不参与任务排序、代表任务排序、平滑、完成保留、10/30 分钟中断或 attention 期限。所有这些规则只使用服务端单调接收时间，因此客户端漂移与 Windows 校时不能提前、延后或淘汰状态转换。
- 一秒平滑通过一个待提交普通阶段实现：同一秒只保留最后一个普通阶段；等待授权、失败、完成和中断立即提交。真实定时器只每秒向 Actor 发送 `Tick`，所有判断仍在纯聚合器内。
- Actor 是 draft 的唯一正常提交者：draft 交给进程级 `CodexSnapshotStore` 后才得到公开 revision，再先发布完整快照、后发布绑定同 revision 的 soft interrupt。Runtime stop/替换的 clear 由 manager 串行协调，不创建第二套 revision 计数器。

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

### 7.4 启动、卸载、generation 与退出生命周期

- 应用启动固定顺序为：构造CodexIntegrationPaths与唯一`Arc<CodexSnapshotStore>`并注入Manager → 恢复未完成Integration Transaction（稳定Journal权威ID或无稳定Journal精确Prepared-only孤立temp检查）→ 只读inspection → 根据inspection决定是否ensure_started/stop_if_unused → 派生并发布CodexListeningStatus。孤立/稳定事务Conflict停止Runtime且保留证据。
- startup 只在 Hook exact、Hook modified、或静态 inspection 的 marker present 且可安全解析时启动；not_installed、disabled、managed_disabled、config conflict、已确认卸载和仅 idlePersistent 均不启动。无法安全识别 CodePulse 条目的 conflict 必须由 listening 派生为 config_conflict，不能降级成 partial 绕过门禁。
- 每次真正创建 HTTP/Actor Runtime 先从进程级 AtomicU64 分配非零 generation，并为该 generation 创建 token、DiscoveryOwner、Actor/reporter。新 generation 先清空旧认证事实；只有该 generation 的第一条真实事件可令 `authenticated_generation == runtime_generation` 并进入 running。旧 Actor 晚到上报、旧 HTTP 关闭回调和旧 DiscoveryGuard 都不能改变新 Runtime。
- Install/Repair严格使用第3.6节统一Journal阶段顺序。Prepared后、staging前对三目标执行optimistic precondition check；prepared backup/temp完整性与当前Journal ID形成屏障；existing目标用`ReplaceFileW`捕获真实snapshot，absent目标用no-replace发布。任一late modification、DestinationAppeared、原子操作失败或写后摘要错误立即停止并action-aware恢复。ConfigApplied后inspection未达到exact时按snapshot优先于prepared backup的规则回滚未提交结构；首次Install失败停止临时Runtime、发布更高revision空快照并owner-aware删除discovery，Repair失败保持安装前合法链路。StructureCommitted后self-check失败保留Hook/Bridge并进入partial/service_error，不误报running。
- `IntegrationTransactionConflict`/`OrphanTransactionConflict`时只允许`retry_codex_integration_recovery()`；operation mutex防并发重入，仍冲突时字节不变，用户恢复为Original/Target/ExpectedAbsent后可安全恢复。不存在force overwrite/discard/ignore入口。
- Uninstall 精确删除 marker、验证不存在，再按“停止接收 → 关闭 Actor/HTTP → Store.clear/发布空快照 → 发布 not_installed”停止链路，owner-aware删除discovery，最后把稳定Bridge/记录原子rename到transaction-owned tombstone；StructureCommitted前不永久删除tombstone。捕获或提交后清理失败只warning/Conflict，不恢复Hook、不重启服务。本地hooks=false且有安全marker允许此路径，且不先启动Runtime；managed disabled与ambiguous conflict禁止。
- ExitRequested 第一次同步 prevent，原子保证 shutdown 只启动一次；异步关闭按“停止接受 HTTP → 使用完整 Owner 使 discovery 失效 → 关闭 sender/Actor → Store.clear 并发布空快照 → 等待两个 task”执行，整体最多两秒，随后设置 finished 并调用 AppHandle::exit(saved_code)。第二次请求在 finished 后放行；尚未 finished 时继续阻止且不重复启动。RunEvent::Exit 只做同步、无等待、调用 `remove_discovery_if_owned()` 兜底；文件损坏或已被新 Runtime 替换时不盲删。

## 8. 主要风险与回滚策略

| 风险 | 防护 | 回滚策略 |
|---|---|---|
| Bridge 未进入安装包、目标架构/Subsystem 错误或 Hook 闪控制台 | crate root 强制 windows_subsystem=windows；构建/验证/installer 三层解析 DOS Header、PE 签名、COFF Machine、Optional Header Magic/Subsystem；piped 黑盒验证 stdout/stderr | Console/未知 Subsystem 或错架构直接拒绝；未写 Hook 时不影响 Codex |
| Tauri 隐藏窗口或托盘强退绕过清理 | 窗口只 hide；托盘使用 AppHandle::exit；ExitRequested 同步 prevent 后只 spawn 一次两秒 shutdown；Exit 只做同步兜底 | 超时仍发起第二次 exit；Bridge 遇到残留 PID/连接失败仍静默退出 |
| 固定端口被占用、旧 Runtime 清理新 discovery 或本机进程伪装 | 仅 `AddrInUse` 降级动态端口；每次 generation 随机令牌；发现文件原子替换；完整 DiscoveryOwner 比较；Bridge 校验版本、PID 和回环端口 | 切换动态端口不算故障；旧 owner 返回 ReplacedByNewRuntime；发现文件无法安全写入则关闭服务 |
| 并发、跨轮次迟到或墙钟回拨产生间歇错误 | 单 Actor 实际接收顺序、eventId/retired turnId/toolUseId/agentId、可注入手动时钟；不以 occurredAt 淘汰当前轮次 | 保留 HTTP/快照接口，回退聚合器提交；旧版本不会持久化任务状态 |
| Runtime 重启后 revision 回到 1 导致 Vue 拒绝新状态 | 进程级 SnapshotStore 独占 revision；stop 先发布更高 revision 空快照；dormant 查询 Store | 清理 Runtime 不销毁 Store；卸载/失败后 Vue 必须先收到空快照 |
| 旧 Runtime 的真实事件把新 Runtime 误报 running | generation-aware reporter；authenticatedGeneration 只接受当前 generation；新启动清空来源/时间/错误 | 旧上报直接忽略，新 Runtime 维持 awaiting_trust/partial 直到真实新 Hook |
| Hook 配置格式或字段与官方版本变化 | 实施时再次查官方文档；完整解析；真实 App/CLI 门禁；记录协议版本 | 检查到未知结构只读报冲突；不写文件；卸载只删精确签名 |
| 用户已有 Hook 被覆盖 | 沿用现有表示方式；Exact只提取绑定`paths.installed_bridge`的CodePulse-owned projection；独立用户group不参与比较，混合group Repair分离且保留用户handler | 原子写失败保留原文件；卸载不恢复整份旧备份；备份只供用户审计或手工恢复 |
| 崩溃、并发外改、post-write或self-check失败留下Hook指向缺失Bridge | transactionId先于prepare；Prepared前零staging；optimistic precondition check；prepared backup/temp与all-staging-ready；existing `ReplaceFileW` snapshot、absent no-replace publish、removal tombstone；稳定/孤立Journal精确恢复；逐文件混合状态与action-specific invariant | late modification由snapshot捕获且优先于prepared backup；DestinationAppeared不覆盖；Install新Bridge只在无引用后处理；Repair恢复真实被替换版本；Uninstall先删引用后捕获tombstone；Conflict可安全retry但无force |
| `ReplaceFileW`/publish/removal后旧写句柄或writable mapping继续修改target、snapshot或tombstone | 原子操作后立即以`GENERIC_READ | FILE_READ_ATTRIBUTES`、仅`FILE_SHARE_READ`获取`StableArtifactLease`；Handle身份+摘要；阶段Journal落盘前持续持有；活跃writer/mapping/delete access统一`ActiveArtifactHandleConflict` | 不按路径降级读取、不继续下一文件、不清捕获版本；停止Runtime、保留Journal并只允许三次短重试后的安全retry |
| StructureCommitted清理在摘要检查后删除了同名新file ID | 先释放普通事务Lease；正常artifact新开`CreateFileW(GENERIC_READ | DELETE, FILE_SHARE_READ)` cleanup Handle；使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记 | cleanup失败/delete pending/路径复用只Warning并保留StructureCommitted Journal；不调用路径型`DeleteFileW`，不回滚已提交结构；Conflict artifact永不进入普通清理 |
| Hook 条目已被用户手改 | 基础/Windows command都必须精确等于稳定Bridge expected command且无额外参数；wrong-path不可能Exact；`modified`状态拒绝后台覆盖 | 展示差异并要求新预览；混合用户handler保持；不强制覆盖 |
| 稳定Journal替换前崩溃只留下temp | 无稳定Journal时仅枚举`.<journal-filename>.codepulse-<32hex>.tmp`，验证Prepared-only、目标仍原始且同ID无staging；单实例前提固定 | 合法孤立temp可清理；异常temp保留并OrphanTransactionConflict、Runtime停止；重试只重跑相同安全检查 |
| 设置页把“已写配置”误报为运行 | `awaiting_trust` 与 `active` 分离；只有收到第一条真实事件后为 `running` | 保持未信任提示和自检，不自动重复写入 |
| 空闲常驻掩盖未安装或服务错误 | Agent 投影同时消费 snapshot/listeningStatus；idlePersistent 只影响 running 且无任务；UI 没有 runtime start 权限 | 关闭显示偏好不影响服务；异常/冲突继续显示真实 warning/error |
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

## 10. 设计覆盖与验收证据分层

### 10.1 十四项设计场景证据表

证据层级固定为：A=自动行为测试，B=Codex App真实验收，C=独立CLI真实验收。A只证明内部行为与不变量；模拟`source='cli'`、mock父进程链或直接POST不能计入C。CLI不可用时C栏只能在实际验收记录中写“环境阻塞”，不影响文档/实现完成和App门禁单独通过，但阻止完整正式兼容声明。

| # | 设计场景 | A. 自动行为测试 | B. App真实验收 | C. CLI真实验收 |
|---|---|---|---|---|
| 1 | CLI普通任务 | 协议、聚合和来源DTO模拟 | 不适用 | 官方CLI版本、真实任务、真实Hook与CLI来源 |
| 2 | Codex App普通任务 | 协议、聚合和来源DTO模拟 | 官方信任、真实Hook与App来源 | 不适用 |
| 3 | App与CLI并行 | 多会话Actor与优先级 | 真实App会话作为并行一侧 | 独立CLI与App同时运行并正确区分来源 |
| 4 | 读取、修改、命令、测试阶段 | 八事件映射、聚合与UI投影 | 真实App阶段变化 | 真实CLI阶段变化 |
| 5 | 请求授权 | waiting_approval、强提醒、不超时 | App官方授权流程 | CLI官方授权流程 |
| 6 | 测试先失败后修复成功 | 中间失败不终止、Stop完成判定 | App真实任务 | CLI真实任务 |
| 7 | 最终失败 | Stop保守失败判定、失败保留 | App真实失败任务 | CLI真实失败任务 |
| 8 | 完成保留5分钟 | ManualClock边界 | App可观察留存与消失 | 不作为CLI兼容必需证据 |
| 9 | 失败手动清除 | Actor命令、Store revision、UI交互 | App任务在CodePulse UI清除 | 不作为CLI兼容必需证据 |
| 10 | CodePulse中途退出 | 无历史补偿、Owner清理、空快照 | App真实任务期间退出/重启 | CLI并行验收时确认无补偿 |
| 11 | 固定端口冲突 | loopback fallback与Discovery | 真实应用占用47653后启动 | 不作为CLI兼容必需证据 |
| 12 | 用户已有其他Hook | AST语义保留与多层逻辑去重 | 真实安装/修复/卸载后用户Hook保持 | CLI加载同一活动配置时真实Hook仍触发 |
| 13 | Hook未信任 | awaiting_trust、当前generation门禁 | App官方信任流程，首条真实事件后running | CLI官方`/hooks`信任与真实事件 |
| 14 | CodePulse更新后修复Bridge | PE/hash/piped、事务、修复/卸载 | 实际安装、修复、卸载与无控制台闪烁 | 修复后独立CLI真实Hook仍工作 |

### 10.2 需求覆盖矩阵

| 设计章节/要求 | 落地计划与任务 | 验证证据 |
|---|---|---|
| 1–2 背景与八项目标 | 路线图全局约束；01 全链路；02 聚合；03 UI；04 配置/E2E | 四阶段独立验收与最终矩阵 |
| 3 第一版不做 | 01 任务 2/3、03 任务 3/5、04C 任务 4/5 | 禁止字段测试、按钮缺失测试、范围 grep 和人工检查 |
| 4.1 紧凑态 | 03 任务 3 | `CodexCompactContent.test.ts` |
| 4.2 多会话汇总列表 | 02 任务 2、03 任务 3 | 多会话聚合测试与列表组件测试 |
| 4.3 任务详情、返回、清除 | 02 任务 4、03 任务 3/5 | 详情导航、任务移除、清除命令测试 |
| 5.1 阶段模型与空闲常驻 | 01 任务 2、02 任务 1、03 任务 2、04C 任务 3 | 分类表、快照/listeningStatus 联合投影测试 |
| 5.2 主岛优先级 | 02 任务 2、03 任务 4 | 代表任务与 `resolveIslandLayout()` 测试 |
| 5.3 一秒平滑 | 02 任务 3 | `ManualClock` 无等待测试 |
| 5.4 五分钟完成、失败保留与手动清除 | 02 任务 3/4 | 生命周期与命令测试 |
| 5.5 10/30 分钟中断、授权不超时 | 02 任务 3 | 手动时钟边界测试 |
| 6 总体架构、6.1 不接管原 Hook | 01 任务 1–5、02 任务 2、04A 任务 1–3、04B-1/2/3 | 用户层管理范围、配置保留、跨层逻辑事件去重和单向接口测试 |
| 7.1 半自动安装 | 04A 任务 1–3、04B-1/2/3、04C 任务 1/2/5 | inspection/preview/confirm/统一事务/self-check/真实事件验收 |
| 7.2 表示方式选择 | 04A 任务 1/3 | `hooks.json`、TOML、双表示冲突矩阵 |
| 7.3 八种 Hook | 01 任务 2、04A 任务 1/3、04C 任务 5 | 八事件解析和配置测试 |
| 标准 JSON/TOML Hook Fixture | 04A任务1/3、04B-2/3、04C任务4 | 两份母版完整八事件；JSON serde_json AST/TOML toml_edit AST注入；normalize接口显式接收`paths.installed_bridge`；CodePulse-owned projection排除用户独立Hook，混合group Repair保留用户handler；wrong-path/双command错误/extra参数非Exact；无原始文本replace |
| `features.codex_hooks` 弃用别名 | 04A 任务 1–3、04B-3、04C 任务 1/2/4 | 缺失/单键/同值/冲突/非布尔矩阵；弃用与重复 Issue；冲突时 Runtime 停止且三动作无 Prepared change；UI 无动作按钮 |
| 7.4 稳定 Bridge 路径 | 01 任务 4/5、04B-2 | 路径对象、bundle、PE 与稳定副本哈希测试 |
| 7.5 所有路径 `{}`/0 | 01 任务 3 | Bridge 进程契约测试 |
| Bridge Windows GUI Subsystem 与管道契约 | 01 任务 1/3/5、04B-2、04C 任务 5 | `[自动行为测试]` windows_subsystem、piped、PE；`[App真实验收]` 无控制台闪烁；`[CLI真实验收]` 独立CLI真实Hook |
| 8.1 单次进程模式 | 01 任务 2/3 | 每个 Hook 启动一次、无守护状态测试 |
| 8.2 Bridge 职责 | 01 任务 2/3 | 解析、来源、摘要、投递测试 |
| 8.3 Bridge 禁止职责 | 01 任务 3、02 任务 1–3 | 无重试/无事件落盘检查；聚合职责测试 |
| 8.4 150ms/250ms/2s | 01 任务 3、04A 任务 3 | 超时测试与配置快照 |
| 8.5 来源识别与降级 | 01 任务 2、04C 任务 5 | 注入父进程链测试和真实端来源验收 |
| 9 协议和字段 | 01 任务 1 | JSON 契约快照测试 |
| 9.1 长度限制 | 01 任务 1/2/4 | Unicode 边界和 HTTP 413/422 测试 |
| 9.2 禁止传输 | 01 任务 2/4、02 任务 4 | 脱敏及公开快照无路径测试 |
| 9.3 任务摘要 | 01 任务 2 | 摘要表格测试 |
| 9.4 命令摘要 | 01 任务 2 | 命令分类与秘密清理表格测试 |
| 10.1 固定/动态端口与发现文件 | 01 任务 4、02 任务 5 | 端口占用、原子写、退出清理测试 |
| Discovery 完整 Owner 与 A/B 清理竞态 | 01 任务 4、02 任务 5、04C 任务 4 | ReplacedByNewRuntime、相同 PID 不同 token、损坏文件和 RunEvent::Exit owner-aware 测试 |
| 10.2 HTTP 处理顺序与 202 | 01 任务 4 | 路由/认证/限制/过载集成测试 |
| 10.3 回环、令牌、二次脱敏和安全日志 | 01 任务 4、02 任务 5 | 网络绑定、重启令牌、日志捕获测试 |
| 多配置层与逻辑事件去重 | 01任务2/3、02任务2/4、04A任务1、04C任务4 | 用户层管理事实；相同逻辑事件不同eventId只处理一次；不同turn/toolUse/agent不误去重；两层缓存有界且仅Actor维护 |
| 11 Rust 模块边界 | 01 任务 1/4、02 任务 1–5、04A 任务 1–3、04B-1/2/3 | 模块 API 编译和职责审查 |
| 12 聚合数据结构 | 02 任务 1/2 | DTO 序列化快照测试 |
| 13 Hook 到状态映射 | 01 任务 2、02 任务 2 | 八事件表驱动测试 |
| 14 工具分类 | 01 任务 2 | 读取/编辑/测试/命令表驱动测试 |
| 15 中间失败与 Stop 保守判定 | 02 任务 1/2 | 明确成功/失败/未知组合测试 |
| 16 等待授权 | 02 任务 2/3、03 任务 3/4 | 强打断、不超时、无授权按钮测试 |
| 17 子智能体计数 | 01 任务 2、02 任务 2、03 任务 3 | start/stop 去重与计数展示测试 |
| 18 Rust/Vue 边界及三个事件 | 02 任务 4、03 任务 1/2 | IPC 契约、revision 防旧写和清理测试 |
| 进程级 SnapshotStore、显式 Manager 注入、dormant 查询与跨 Runtime revision | 02 任务 1/4/5、03 任务 2、04B-3、04C 任务 4 | `Arc::ptr_eq`、setup 单次构造、Actor/stop/restart 同一 Arc、revision 20→stop 21 空→新任务 >21、dormant 命令只读注入 Store |
| Runtime generation 与真实事件认证 | 02 任务 4/5、04A 任务 2、04B-3、04C 任务 4/5 | `[自动行为测试]` generation 1/2与旧上报忽略；`[App真实验收]` App第一条真实Hook；`[CLI真实验收]` CLI第一条真实Hook |
| 19 Vue 组件拆分 | 03 任务 2/3 | 独立模块与组件测试；IslandView 差异审查 |
| 20 多岛集成 | 03 任务 2/4/5 | 主/卫星、手动焦点、强软打断和展开尺寸测试 |
| 21 设置分组和七种状态 | 04A 任务 2、04C 任务 1–3 | inspection 派生状态、手动 Hooks 引导与设置组件测试 |
| Inspection 静态事实与 ListeningStatus 唯一动态状态 | 04A 任务 1/2、04B-3、04C 任务 1/2 | inspection JSON 无 hookState/phase、event 不改 inspection、无需 re-inspect 即 running |
| 本地 hooks=false 的安全卸载 | 04A 任务 3、04B-2/3、04C 任务 2/4 | install/repair=HooksDisabled，marker present 可预览/卸载且不启动 Runtime，managed disabled 全只读 |
| 22 解析、备份、原子写、精准卸载、修复 | 04A任务1/3、04B-1/2/3、04C任务4 | 临时Home配置矩阵、optimistic precondition check、ReplaceFileW snapshot、no-replace publish、removal tombstone、故障注入与安全retry测试 |
| Integration Transaction跨进程提交边界 | 04B-1/2、04C任务4 | allocate ID→prepare→persist Prepared→verified staging barrier→atomic existing/absent/removal；最后一次检查之后的外改由snapshot/tombstone捕获；稳定/孤立Journal精确恢复；Bridge/记录Target/Original混合逐文件恢复；action-specific invariant；提交后只清理正常artifacts |
| StableArtifactLease与Handle identity | 04B-1/2、04C任务4 | `CreateFileW`只共享读；FileIdInfo volume serial+128位file ID+size；关键摘要只读Handle；不同占用场景统一断言SharingViolation/ActiveArtifactHandleConflict；Lease阻止新write/rename/delete |
| StructureCommitted新cleanup Handle | 04B-1/2、04C任务4 | 释放普通Lease后新开`GENERIC_READ | DELETE`+仅`FILE_SHARE_READ`；使用新取得的同一 cleanup Handle 完成身份/摘要校验与`FileDispositionInfo`删除；失败只Warning且不回滚 |
| Transaction Conflict安全恢复入口 | 04B-3、04C任务1/2/4 | `retry_codex_integration_recovery` operation mutex、未处理仍Conflict字节不变、手工恢复Original/Target后回滚或提交、NoPendingTransaction、重新Inspection/ListeningStatus；UI仅安全重试且无force/discard/ignore |
| 23 异常处理 | 01 任务 3/4、02 任务 5、04A 任务 1–3、04B-1/2/3 | 端口、发现文件、协议、认证、队列、来源、配置错误测试 |
| 24 Windows CLI/App 兼容与 WSL 排除 | 01 任务 2、04C 任务 4/5 | 父进程链测试、真实端验收、WSL 范围检查 |
| 25.1 Bridge 单测 | 01 任务 2/3 | Bridge crate 测试 |
| 25.2 聚合器单测 | 02 任务 1–3 | aggregator/clock 测试 |
| 25.3 HTTP 集成 | 01 任务 4 | server/runtime 集成测试 |
| 25.4 Vue 测试 | 03 任务 1–5、04C 任务 1–3 | composable、组件、布局和设置测试 |
| 25.5 验收证据分层 | 04C 任务 4/5；本路线图 10.1 | A 自动行为矩阵 + B App真实验收 + C 独立CLI真实验收；三类证据不得互相替代 |
| 26 完成标准 | 01–03 与04A/04B-1/04B-2/04B-3/04C各门禁 | 性能、隐私、稳定性、配置和真实端发布门禁 |
| 27 实施顺序 | 本路线图第2节、七份详细计划与阶段四总览 | 阶段门禁保证不跳过协议/聚合器测试，每个04审核边界后review |
| 28 参考资料 | 路线图 1.4、6；04A 任务 1、04C 任务 5 | 实施日再次核对官方 Hooks、Windows 与 Tauri 2.11.5 文档 |

## 11. 全路线验收与停止条件

- 七份详细计划与阶段四总览中的接口名称、枚举值、事件名、命令名、路径和时间边界必须保持与本路线图一致；需要改变时先修改Roadmap及所有消费计划，再改源码。详细计划若因安全性改变产品可见顺序，还必须同步设计文档。
- 阶段一至三可以在没有写入真实 Codex 配置的情况下完整自动测试；阶段四的配置测试使用临时 `CODEX_HOME`，真实 Home 只在用户确认预览后修改。
- “正常运行”只由第一条真实、通过认证的 Hook 事件触发；模拟 HTTP 自检只能证明服务可用，不能替代信任或真实端验收。
- “真实、通过认证”还必须属于当前 runtimeGeneration；旧 generation 的事件、reporter 和关闭回调不能更新当前 listening status。
- 任何 Runtime stop/uninstall/无旧合法 Runtime 的启动失败都必须先发布更高 revision 空快照；`get_codex_snapshot()` 在 dormant 状态必须成功，不能把 Actor 缺失映射为 service_error。
- Install/Repair只有`InstalledOrRepaired` invariant（Marker=Exact、Bridge/Record=Target、PE/hash/piped有效且无late snapshot冲突）通过后才能持久化`StructureCommitted`；Uninstall只有`Uninstalled` invariant（Marker=Absent、无稳定路径引用、Bridge/Record目标absent且tombstone受当前Journal控制）通过后才能提交。之前失败不得留下悬空Hook，之后self-check失败不得删除正确结构，恢复只清理正常artifact。
- Prepared落盘后先执行optimistic precondition check，但它不作为完整并发证明。外部修改发生在最后一次检查之后、系统原子替换内部之前时，existing目标必须由`ReplaceFileW` snapshot捕获，absent目标必须因no-replace publish失败而保留突然出现的目标，removal必须由tombstone捕获真实被移走版本；原子操作后target/snapshot/tombstone必须取得`StableArtifactLease`并只从Handle验证。任一Lease失败或摘要不符不得继续下一文件。Transaction/Orphan/ActiveArtifactHandle Conflict必须停止Runtime且可通过同一安全恢复命令重试，但没有强制覆盖或丢弃功能。
- 原子文件系统测试抽象必须提供`BeforeAtomicReplace`、`AfterTargetOpenedOrPrepared`、`AfterAtomicReplaceBeforeVerification`、`BeforeConflictRestore`、`AfterRemovalCaptureBeforeVerification`、`BeforeStableLeaseAcquire`、`AfterStableLeaseAcquireBeforeHash`、`AfterHashBeforeStagePersist`、`BeforeVerifiedHandleDelete`精确注入点；范围门禁阻止Existing裸`MOVEFILE_REPLACE_EXISTING`、Absent覆盖发布、Uninstall直接`DeleteFileW`、缺少replaced snapshot或结果Lease、snapshot/tombstone路径型关键摘要、recovery在Lease失败后按路径降级、prepared backup覆盖late snapshot、普通cleanup删除Conflict artifact、Lease在阶段Journal落盘前释放、StructureCommitted按路径摘要后`DeleteFileW`及writer/installer原子逻辑分叉。
- A自动行为矩阵不能替代B App或C CLI真实验收。模拟`source='cli'`、mock父进程链或直接POST都不属于CLI真实证据；本机无法独立启动CLI时只记录“环境阻塞”，不阻止文档/实现完成或App门禁单独通过，但阻止宣称Windows原生CLI与App完整正式兼容。
- 最终源码提交前必须确认 `git diff --name-only` 没有 `package-lock.json`、`yarn.lock`、事件历史、日志正文或用户配置样本。

## 12. 分阶段审核清单

- [ ] **审核阶段一：协议、路径、Bridge、HTTP 与 PE 资源**

  执行 `docs/superpowers/plans/2026-07-16-codex-status-island-01-bridge-http.md`，运行该计划的阶段一全量命令。预期共享协议/路径只有一份、Bridge 为 GUI Subsystem 且 piped 严格 `{}`/空 stderr/0、回环 HTTP、完整 Discovery owner 与 PE x64/ARM64+GUI 门禁通过；完成后停止 review。

- [ ] **审核阶段二：聚合、Runtime Manager 与退出协调器**

  执行 `docs/superpowers/plans/2026-07-16-codex-status-island-02-aggregator-tauri.md`。预期当前轮次按Actor接收顺序、随机eventId与逻辑事件两层有界去重由Actor独占、相同逻辑事件不同eventId只处理一次且不同turn/toolUse/agent不误去重、SnapshotStore显式注入Manager且setup只构造一次、Actor/stop/restart/dormant命令使用同一Arc、跨Runtime保持revision、generation过滤旧reporter/Owner、两秒退出只启动一次shutdown；完成后停止review。

- [ ] **审核阶段三：Agent UI 与 listening status 联合投影**

  执行 `docs/superpowers/plans/2026-07-16-codex-status-island-03-agent-ui.md`。预期 `toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)` 是唯一投影，更高 revision 空快照清掉卸载前任务，前端不在 Runtime 重启时重置 revision，IslandView 只接线；完成后停止 review。

- [ ] **审核 04A：只读 inspection 与纯 planner**

  执行 `docs/superpowers/plans/2026-07-16-codex-status-island-04a-inspection-planner.md`。预期TempDir零写入、Inspection无动态字段且只陈述用户层管理事实、不扫描仓库/插件也不宣称全局唯一，Feature标准键/弃用别名事实与冲突矩阵通过、标准JSON/TOML Fixture通过AST注入，Exact显式接收`paths.installed_bridge`并只比较CodePulse-owned projection；wrong-path/extra参数不可能Exact，独立用户group不影响Exact、混合group Repair保留用户handler；generation listening派生通过、本地disabled只允许安全uninstall、无writer/installer/UI；完成后停止review。

- [ ] **审核 04B-1：事务与原子文件基础设施**

  仅在04A已批准后执行`docs/superpowers/plans/2026-07-16-codex-status-island-04b-writer-installer.md`的04B-1。范围只包括唯一Integration Journal、transactionId与owned staging、四正式阶段、optimistic precondition check、all-staging-ready、`ReplaceFileW`、absent no-replace publish、removal tombstone、普通`StableArtifactLease`、file identity/Handle摘要、recovery、孤立Journal temp和fault injection。不得出现Tauri commands、Runtime启停、设置页或真实Bridge安装编排；完成后强制停止review。

- [ ] **审核 04B-2：Config Writer 与 Bridge Installer**

  仅在04B-1已批准后继续同一计划的04B-2。预期`ConfigApplyTransaction`、`BridgeInstallTransaction`、PE Machine/WindowsGui/hash/piped契约、Install/Repair/Uninstall coordinator、action-specific invariant、rollback优先级和StructureCommitted前后清理边界通过。生产共享冲突只返回`SharingViolation`并映射`ActiveArtifactHandleConflict`；场景测试可分别制造writer、writable mapping、delete/rename Handle。StructureCommitted后先释放普通Lease，再使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记。不得接Tauri commands、Runtime或设置页；完成后强制停止review。

- [ ] **审核 04B-3：Tauri Commands 与 Runtime 编排**

  仅在04B-2已批准后继续同一计划的04B-3。预期inspect/preview/apply/retry commands、integration operation mutex、startup recovery、Inspection驱动Runtime start/stop、SnapshotStore clear、generation/DiscoveryOwner、ListeningStatus、self-check与稳定错误映射通过，UI占用文案不诊断具体冲突来源。04B-1/2/3不得创建第二套Journal、状态机、phase、SnapshotStore或公开接口；完成后强制停止review。

- [ ] **审核 04C：设置、显示偏好与分层验收**

  仅在04B-3已批准后执行`docs/superpowers/plans/2026-07-16-codex-status-island-04c-settings-e2e.md`。预期静态/动态UI分离、弃用别名提示、Transaction Conflict只显示“重新尝试安全恢复”、disabled marker卸载、重装revision/generation、原子filesystem九个精确注入点、不同占用场景统一sharing violation/公开冲突、Lease阻止新write/rename/delete、ReplaceFileW双Lease/no-replace target Lease/tombstone Lease/第二次恢复重新冻结、使用新取得的同一 cleanup Handle 清理且失败只Warning、精确孤立Journal、Bridge/记录混合恢复、安全retry通过。验收证据必须分为A自动行为矩阵、B App真实验收、C独立CLI真实验收；App信任与GUI无闪窗必须真实验证，CLI环境阻塞如实记录且不得冒充完整兼容；完成后停止review。

- [ ] **审核最终验收记录路径**

  只接受 `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`。预期仓库和计划中没有第二个 Codex E2E 验收路径。

- [ ] **审核完整范围**

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  git diff --check
  git diff --name-only
  ```

  预期：第一版排除WSL/控制Codex/历史补偿；用户Hook保留；范围、格式和变更文件符合七份详细计划与阶段四总览。
