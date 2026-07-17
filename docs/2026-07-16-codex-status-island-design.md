# Codex 实时状态灵动岛设计

日期：2026-07-16
状态：已确认
适用项目：CodePulse
目标平台：Windows
首版兼容：Windows 原生 Codex CLI、Codex App 原生 PowerShell 模式

## 0. 规范层级

本设计与实施计划按以下层级共同构成规范：

1. 本设计文档负责产品目标、用户行为、功能范围和用户可见状态；
2. `docs/superpowers/plans/2026-07-16-codex-status-island-roadmap.md` 负责跨阶段架构、公开接口、状态所有权和全局不变量；
3. 各详细阶段计划负责具体执行顺序、失败处理、测试矩阵和审核门禁；
4. 详细计划不得静默违背产品设计；若实现安全性要求导致内部顺序变化，必须先同步修订本设计文档；
5. 任何公共接口或全局不变量变化，都必须同步更新 Roadmap 和全部消费者计划后才能实施。

第 7 节的安装顺序已经按安全事务要求与 04B 统一：先验证并安装 Bridge 与安装记录，再应用 Hook 配置，避免留下指向不存在 EXE 的 Hook。

## 1. 背景

CodePulse 已具备多模块灵动岛、主岛与卫星岛切换、软/强打断、详情展开、系统通知、硬件监控和音乐控制等基础能力，现有多岛模型也已经预留 `agent` 类型。本设计将该占位能力实现为 Codex 实时工作状态模块。

该功能定位为“状态观察器”，不是 Codex 控制器。用户无需切回终端或 Codex App，即可了解 Codex 当前正在分析、读取项目、修改代码、执行命令、运行测试、等待授权、完成或失败。

## 2. 设计目标

1. 同时兼容 Windows 原生 Codex CLI 与 Codex App 原生 PowerShell 模式。
2. 多个 Codex 会话并行时，只占用一个统一的 Codex/Agent 模块。
3. 主岛始终突出当前最需要用户关注的状态。
4. 展开后可查看项目名、任务摘要、阶段、来源和最后活动时间。
5. 关键状态可靠提醒，普通状态稳定展示且不频繁闪烁。
6. 不破坏用户已有 Codex Hook。
7. 不明显拖慢 Codex，不因 CodePulse 故障阻塞 Codex。
8. 不持久化项目内容、完整命令、日志或 Codex 对话。

## 3. 第一版不做

- 灵动岛内允许或拒绝授权；
- 打开或定位到具体 Codex 会话；
- 暂停、终止或继续 Codex；
- 保存任务历史；
- CodePulse 未启动时补偿历史事件；
- 展示完整终端日志或完整 Codex 输出；
- 每个子智能体独立卡片；
- 每个工具调用的完整审计；
- WSL 模式正式支持；
- Codex 云端任务监听；
- VS Code、Cursor 等编辑器扩展接入。

## 4. 产品形态

Codex 模块采用汇总模式，不让每个会话单独占据卫星岛。

### 4.1 紧凑态

主岛显示最高优先级任务：

```text
等待授权    CodePulse
执行失败    cargo test
已完成      修复状态监听
运行测试    3 个任务执行中
```

同一优先级下，最近活动的任务优先。

### 4.2 汇总列表

```text
CodePulse
修复 Codex 实时状态监听
运行测试 · Codex CLI · 刚刚

DevForge
重构规则管理模块
等待授权 · Codex App · 1 分钟前
```

每个 `sessionId` 对应一张卡片。同一会话的新一轮指令更新原卡片，不创建历史卡片。

### 4.3 任务详情

点击任务卡片只显示详情，首版不打开 Codex：

```text
项目          CodePulse
任务          修复 Codex 实时状态监听
状态          运行测试
当前操作      运行 pnpm test
最新输出      正在验证状态聚合逻辑……
来源          Codex CLI
最后活动      刚刚
```

失败和中断任务提供“清除记录”。清除仅影响 CodePulse 展示，不改变 Codex 会话。

## 5. 状态模型

### 5.1 用户可见阶段

- 分析中
- 读取项目
- 修改代码
- 执行命令
- 运行测试
- 等待授权
- 已完成
- 执行失败
- 状态中断（异常状态）

“空闲”只用于常驻模式显示“Codex 已就绪”。

### 5.2 主岛优先级

从高到低：

1. 等待授权
2. 执行失败
3. 已完成
4. 状态中断
5. 运行测试
6. 执行命令
7. 修改代码
8. 读取项目
9. 分析中
10. 空闲

同状态按 `lastActivityAt` 倒序选择主岛代表任务。

### 5.3 平滑更新

- 普通状态至少展示 1 秒；
- 1 秒内连续收到多个普通事件时，只保留最新阶段，不排队；
- 等待授权、执行失败、已完成和状态中断立即生效；
- 同一任务重复触发同状态只刷新活动时间，不重复播放动画；
- 多任务时，主岛只根据最高优先级任务更新，其余任务在详情列表实时变化。

### 5.4 生命周期

- 完成任务保留 5 分钟后自动移除；
- 失败任务不自动消失；
- 同一会话重新开始任务时自动清除旧失败状态；
- 用户可手动清除失败和中断记录；
- CodePulse 退出后所有任务内存状态清空；
- CodePulse 未运行时不缓存、不补偿事件。

### 5.5 状态中断

- 分析中、读取项目、修改代码：10 分钟无事件；
- 执行命令、运行测试：30 分钟无事件；
- 等待授权：不自动超时。

中断行为：

- 黄色警告；
- 首次中断软提醒 5 秒；
- 随后退回卫星岛；
- 同一中断周期不重复提醒；
- 收到同会话新事件后自动恢复；
- 支持手动清除。

## 6. 总体架构

```text
Codex CLI / Codex App
        │
        ├─ 用户已有 Hook
        │
        └─ CodePulse Hook
                 ↓
      codepulse-codex-bridge.exe
                 ↓ HTTP POST
       CodePulse Rust 接收器
                 ↓
         Codex 状态聚合器
                 ↓
          Tauri 状态事件
                 ↓
          Vue Agent 灵动岛
```

### 6.1 不使用自建 Dispatcher

Codex 原生支持多个 Hook 来源，并可并行启动同一事件下匹配的命令。CodePulse 不接管用户已有 Hook，也不保存或转发原 Hook 配置。

首版配置管理范围严格限定为用户层 `%USERPROFILE%\.codex` 中的 CodePulse Hook：CodePulse 不修改仓库级 `.codex`、插件 Hook 或企业托管配置，也不扫描用户电脑上的全部仓库。静态检查只能报告“用户层 CodePulse Hook”的安装事实，不能宣称全局不存在其他 CodePulse Hook；UI 不提供无法可靠判断的“全局唯一 Hook”状态。

多个活动配置层可能同时启动语义相同的 CodePulse Hook。Bridge 仍为每次投递生成随机 `eventId`，不扫描配置层、不维护持久状态；Rust 单线程聚合器在 `eventId` 去重之后再按允许进入协议的稳定标识字段执行第二层逻辑事件去重。这样即使用户层和仓库层分别启动 Bridge 并产生不同 `eventId`，同一逻辑事件也只改变一次任务状态、提醒和子智能体计数。

卸载时仅移除 CodePulse 在用户层管理的 Hook 条目；仓库层、插件和企业托管 Hook 保持不变。

## 7. Hook 安装与配置

### 7.1 半自动安装流程

产品流程是“检测环境 → 展示预览 → 用户确认 → 执行安全事务 → 等待 Codex 信任与真实事件”。详细内部顺序固定为：

```text
静态检查
→ 展示预览
→ 用户确认
→ 分配 transactionId
→ 持久化 Prepared Journal
→ 完成 staging 和预检
→ 安装并验证 Bridge 与安装记录
→ 必要时启动临时 Runtime
→ 应用 Hook 配置
→ 验证 action-specific invariant
→ StructureCommitted
→ 清理普通事务产物
→ 发布等待信任/部分可用状态
→ 执行本地自检
→ 等待第一条真实 Hook 事件
```

`Prepared → BridgeApplied → ConfigApplied → StructureCommitted` 是唯一正式事务阶段。配置写入成功只表示进入 `awaiting_trust` 或因结构不完整进入 `partial`，不能直接显示 `running`；只有当前 Runtime generation 的第一条真实、已认证 Hook 事件才能进入 `running`。

安装、修复和卸载都必须先展示各自动作的预览并由用户单独确认。卸载仍先验证用户层 CodePulse marker，再按同一事务安全移除配置引用与稳定 Bridge；不得用旧备份覆盖用户完整当前配置。

### 7.2 配置形式

- 已使用 `hooks.json` 时继续使用该文件；
- 已使用 `config.toml` 内联 Hooks 时继续使用该形式；
- 两者都没有时创建 `hooks.json`；
- 不额外创建第二种表示方式；
- 必须完整解析后修改，禁止脆弱的字符串替换。
- 上述选择只针对用户层 `%USERPROFILE%\.codex`；不修改仓库层、插件或企业托管来源。

### 7.3 监听事件

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PermissionRequest`
- `PostToolUse`
- `SubagentStart`
- `SubagentStop`
- `Stop`

### 7.4 Bridge 稳定路径

```text
%LOCALAPPDATA%\CodePulse\bin\codepulse-codex-bridge.exe
```

Hook 显式设置 2 秒超时，不设置 `statusMessage`，避免 Codex 自身界面频繁出现同步提示。

### 7.5 Bridge 输出约束

无论发送成功、失败或 CodePulse 未运行，Bridge 都必须：

```text
stdout: {}
exit code: 0
```

Bridge 不通过 stdout 输出日志、授权决策或额外上下文。

## 8. Bridge 设计

### 8.1 单次进程模式

```text
启动
→ 从 stdin 读取 Hook JSON
→ 校验基本结构
→ 尽力识别 CLI / App 来源
→ 脱敏、裁剪和分类
→ 读取发现文件
→ POST 到 CodePulse
→ stdout 输出 {}
→ 退出 0
```

### 8.2 Bridge 负责

- 基础 JSON 校验；
- 事件格式转换；
- 来源尽力识别；
- 项目名提取；
- 用户指令摘要；
- 工具/命令摘要；
- 脱敏与长度裁剪；
- 读取运行时发现文件；
- 发送 HTTP 请求。

### 8.3 Bridge 不负责

- 保存任务状态；
- 任务超时；
- 完成或失败保留；
- 平滑切换；
- HTTP 重试；
- 落盘事件；
- 调用用户原 Hook。

### 8.4 性能要求

- HTTP 连接超时：150 毫秒；
- Bridge 总处理目标：250 毫秒以内；
- Hook 安全超时：2 秒；
- 发送失败不重试；
- CodePulse 未运行时快速退出。

### 8.5 来源识别

根据父进程链尽力识别：

- Codex CLI
- Codex App
- Codex（无法判断时）

来源只用于展示，不参与状态聚合和优先级。

## 9. 最小传输协议

```json
{
  "version": 1,
  "eventId": "随机事件ID",
  "sessionId": "Codex会话ID",
  "turnId": "当前轮次ID",
  "source": "cli",
  "projectName": "CodePulse",
  "cwd": "C:\\Users\\...\\CodePulse",
  "eventType": "tool_started",
  "stage": "running_tests",
  "taskSummary": "修复 Codex 实时状态监听",
  "operationSummary": "运行 pnpm test",
  "latestOutput": null,
  "errorSummary": null,
  "occurredAt": 1784160000000
}
```

### 9.1 长度限制

- `taskSummary`：120 字符；
- `operationSummary`：160 字符；
- `latestOutput`：300 字符；
- `errorSummary`：300 字符；
- 请求体：最大 16 KB。

### 9.2 禁止传输

- `transcript_path`；
- 完整 `tool_input` / `tool_response`；
- 文件内容、代码片段；
- 完整终端输出；
- Base64 大段内容；
- 完整提示词。

`cwd` 仅在本机内存中使用，不写日志、不持久化。

### 9.3 任务摘要生成

1. 去除代码块、日志和命令输出；
2. 隐藏绝对路径、Token、URL 查询参数；
3. 删除“帮我、请、看一下、能不能”等无意义开头；
4. 合并空白和换行；
5. 截取 120 字符；
6. 无法可靠清理时使用裁剪后的原始指令。

第一版不调用模型生成摘要。

### 9.4 脱敏命令摘要

```text
pnpm test              → 运行测试：pnpm test
cargo test --workspace → 运行测试：cargo test
pnpm run build         → 构建项目：pnpm build
git status             → 检查 Git 状态
git diff -- src/...    → 查看代码变更
apply_patch            → 修改代码：IslandView.vue
未知命令               → 执行命令
```

移除环境变量值、Token、密码、Authorization 参数、URL 查询参数、超长绝对路径、长文本、提示词、代码块、Base64 和重定向写入正文。

## 10. 本地 HTTP 接收器

### 10.1 地址与端口

优先监听：

```text
127.0.0.1:47653
```

端口冲突时使用系统随机端口。

无论固定端口还是动态端口，都写发现文件：

```text
%LOCALAPPDATA%\CodePulse\runtime\codex-bridge.json
```

```json
{
  "version": 1,
  "port": 47653,
  "pid": 18320,
  "token": "随机启动令牌",
  "startedAt": 1784160000000
}
```

发现文件采用临时文件加原子替换。正常退出时删除，异常遗留由 PID 与连接失败识别。

### 10.2 接口

```http
POST /v1/codex/events
Authorization: Bearer <runtime-token>
Content-Type: application/json
```

处理顺序：

1. 仅接受回环地址；
2. 校验 Bearer Token；
3. 校验协议版本；
4. 限制请求体；
5. 校验字段与长度；
6. 写入有界内存队列；
7. 立即返回 `202 Accepted`；
8. 后台聚合器顺序处理。

### 10.3 安全要求

- 只绑定 `127.0.0.1`；
- 不绑定 `0.0.0.0`；
- 每次 CodePulse 启动生成新的 256 位随机令牌；
- Token 仅存在于发现文件和内存；
- Token 不写入 Hook 配置；
- Rust 端二次脱敏和裁剪；
- 原始 Hook JSON 不进入 Vue；
- 不记录任务指令、命令、路径或输出正文。

诊断日志只记录事件类型、接收时间、协议版本、成功/失败和错误代码。

## 11. Rust 模块边界

建议新增：

```text
src-tauri/src/codex/
├─ server.rs
├─ protocol.rs
├─ aggregator.rs
├─ classifier.rs
├─ sanitizer.rs
├─ runtime.rs
└─ commands.rs
```

### 11.1 `server.rs`

负责 HTTP 生命周期、回环限制、认证、请求限制、队列和响应码。

### 11.2 `protocol.rs`

负责 DTO、协议版本、字段约束和序列化。

### 11.3 `classifier.rs`

负责 Hook、工具、命令分类和 Stop 终态判断。

### 11.4 `sanitizer.rs`

负责服务端二次脱敏、裁剪和路径清理。

### 11.5 `aggregator.rs`

维护：

```text
Map<sessionId, CodexTaskState>
```

负责会话合并、新轮次覆盖、两层事件去重、乱序过滤、平滑更新、完成删除、失败保留、超时中断、优先级和快照生成。

第一层继续按随机 `eventId` 去重；第二层使用 `sessionId`、`turnId`、`eventType`、`toolUseId`、`agentId` 中按事件类型可用的稳定标识构造有界逻辑事件键。每种事件具体采用哪些字段，实施前必须按最新官方 Hook 字段重新确认。逻辑键不得包含 prompt 正文、cwd、文件路径、命令正文、tool input/output 或任何用户内容摘要；不同 turn、toolUseId、agentId 的合法连续事件不得被误删。两层缓存都由单线程 Actor 独占维护，Vue 与 Bridge 不承担逻辑去重。

### 11.6 `runtime.rs`

负责固定端口优先、动态端口降级、Token、发现文件和退出清理。

### 11.7 `commands.rs`

提供：

- 获取当前快照；
- 清除单个失败记录；
- 清除单个中断记录；
- 清除全部失败记录；
- 获取监听状态；
- 触发本地自检。

## 12. 聚合数据结构

```ts
interface CodexTaskState {
  sessionId: string;
  turnId?: string;
  source: 'cli' | 'app' | 'unknown';
  projectName: string;
  cwd: string;
  taskSummary: string;
  stage:
    | 'analyzing'
    | 'reading'
    | 'editing'
    | 'running_command'
    | 'running_tests'
    | 'waiting_approval'
    | 'completed'
    | 'failed'
    | 'interrupted';
  operationSummary?: string;
  latestOutput?: string;
  errorSummary?: string;
  lastOperationResult: 'success' | 'failed' | 'unknown';
  hasUnresolvedIssue: boolean;
  activeSubagentCount: number;
  startedAt: number;
  lastActivityAt: number;
  completedAt?: number;
  acknowledged: boolean;
}
```

## 13. Hook 到状态映射

| Hook | 状态 | 说明 |
|---|---|---|
| SessionStart | 不激活 | 仅记录会话、目录和来源 |
| UserPromptSubmit | 分析中 | 创建或更新卡片 |
| PreToolUse：读取/搜索 | 读取项目 | 显示读取或搜索摘要 |
| PreToolUse：apply_patch/编辑 | 修改代码 | 尽力提取文件名 |
| PreToolUse：测试命令 | 运行测试 | 识别常见测试工具 |
| PreToolUse：其他 Bash | 执行命令 | 显示脱敏命令摘要 |
| PermissionRequest | 等待授权 | 立即强打断 |
| PostToolUse | 更新操作结果 | 不一定切换阶段 |
| SubagentStart/Stop | 保持阶段 | 更新子任务数量 |
| Stop | 完成或失败 | 保守判断终态 |

## 14. 工具分类

### 14.1 读取项目

MCP 文件读取/搜索、`git status`、`git diff`、`git log`、`rg`、`grep`、`find`、`Get-Content`、`type`、`cat` 和目录遍历。

### 14.2 修改代码

`apply_patch`、可识别的文件编辑 MCP 和明确的文件写入命令。

### 14.3 运行测试

`pnpm test`、`npm test`、`vitest`、`cargo test`、`pytest`、`mvn test`、`gradle test`。

构建、Lint 和类型检查仍归入“执行命令”，但摘要显示具体动作。

## 15. 最终失败判定

单次命令退出码非 0 不等于整个任务失败。

### 15.1 中间工具失败

- 保持当前阶段；
- `lastOperationResult = failed`；
- 当前操作显示测试未通过或错误摘要；
- 可短暂显示黄色警示；
- 不进入红色最终失败。

### 15.2 Stop 保守判断

1. 最后操作成功，或最终回答明确完成：已完成；
2. 最后操作失败，且最终回答明确无法完成、仍有错误或需要用户处理：执行失败；
3. 最后操作失败，但回答只是在说明现状、等待下一步或信息不足：已完成，同时标记存在未解决问题；
4. 无法判断：默认已完成。

## 16. 等待授权

- `PermissionRequest` 到达立即进入等待授权；
- 强打断主岛；
- 不受 1 秒平滑限制；
- 不自动超时；
- 不提供允许/拒绝按钮；
- 优先显示授权说明；
- 无说明时根据脱敏命令生成摘要；
- 后续工具、停止或新轮次事件退出等待状态。

## 17. 子智能体

子智能体不创建独立任务卡片，只维护 `activeSubagentCount`。

紧凑态可显示：

```text
分析中    3 个任务 · 2 个子任务
```

## 18. Rust 与 Vue 边界

Rust 只发送整理后的状态：

```text
codex-state-changed
codex-soft-interrupt
codex-listening-status-changed
```

Vue 负责渲染、列表/详情导航和清除命令，不负责分类、超时、完成计时、失败判断、去重或乱序处理。

## 19. Vue 组件建议

```text
src/modules/codex/
├─ types.ts
├─ status.ts
├─ presentation.ts
└─ useCodexAgent.ts

src/components/island/codex/
├─ CodexCompactContent.vue
├─ CodexTaskList.vue
├─ CodexTaskItem.vue
├─ CodexTaskDetail.vue
└─ CodexStatusIcon.vue
```

`IslandView.vue` 只初始化 `useCodexAgent`、加入 `agentSnapshot` 并传递展示数据，不承载 Codex 状态机。

`IslandDisplayController.vue` 增加统一 Agent 输入并替换现有占位内容。

## 20. 与现有多岛调度集成

Codex 只输出一个 `IslandModuleSnapshot`：

```ts
{
  kind: 'agent',
  active: true,
  interrupt: 'strong',
  status: 'warning',
  label: '等待授权',
  unreadCount: 3
}
```

| Codex 状态 | 视觉状态 | 打断等级 |
|---|---|---|
| 等待授权 | warning | strong |
| 执行失败 | error | 首次 strong，之后 none |
| 已完成 | success | soft |
| 状态中断 | warning | 首次 soft，之后 none |
| 普通执行 | running | none |
| 空闲常驻 | paused | none |

复用现有多岛优先级、用户焦点保护和主/卫星交换逻辑，不新增 Codex 专用调度器。

## 21. 设置页

新增“Codex 状态”分组：

```text
Codex 状态集成（状态分组，非开关）
全局 Hooks：已启用 / 需在 Codex 中手动启用 / 由组织管理
CodePulse Hook：未安装 / 等待信任 / 已安装 / 需要修复
监听状态：等待信任 / 正常运行 / 部分可用 / 配置冲突 / 服务异常
最近事件：刚刚
接入来源：Codex CLI、Codex App
[检测环境] [预览安装或修复 CodePulse Hook] [预览卸载 CodePulse Hook]
Codex 空闲时常驻                  [显示偏好开关]
显示脱敏后的命令摘要              [显示偏好开关，默认开启]
```

“Codex 状态集成”只是状态分组，不提供“Codex 状态监听”布尔开关。“全局 Hooks 是否启用”是 Codex 外部配置前置条件，只能由用户在 Codex 配置或官方 UI 中手动修改；CodePulse 只检测、解释并提供“重新检测环境”，不得代替用户启用。

“安装 CodePulse Hook”与“卸载 CodePulse Hook”都是独立的预览与确认动作。设置页不直接写文件，确认后只调用统一事务命令。只有 `idlePersistent` 与 `showCommandSummary` 是普通显示偏好开关，它们不得启动或停止 Runtime。

监听状态：未启用、未安装、等待信任、正常运行、部分可用、配置冲突、服务异常。UI 只报告用户层管理事实，不显示无法可靠判断的“全局唯一 Hook”。

配置写入成功不等于接入成功。收到第一条真实事件后才能显示“正常运行”。

默认无任务时隐藏；开启常驻后显示“Codex 已就绪”。

## 22. 配置写入与回滚

### 写入前

- 完整解析；
- 解析失败停止；
- 分配 transactionId 并以统一 Integration Journal 记录可恢复事务；
- 展示变更预览；
- 检查重复条目。

### 写入时

```text
临时文件
→ 重新解析验证
→ 原子替换
```

### 卸载时

- 精确删除 CodePulse 条目；
- 保留其他 Hook；
- 不用旧备份覆盖用户完整当前配置；
- 配置引用移除并验证成功后，再原子捕获 Bridge 与安装记录；
- `StructureCommitted` 落盘后释放普通事务 Lease，使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记；
- cleanup 失败只保留警告与待恢复事务，不回滚已正确提交的 Hook 或 Bridge；
- 用户手动修改过条目时展示差异，不强制覆盖。

### 修复功能

处理 Bridge 缺失/过旧、Hook 路径失效、重复条目、协议不匹配和运行时目录权限异常。

## 23. 异常处理

- 固定端口冲突：自动随机端口，不作为故障；
- 发现文件写入失败：停止 HTTP 服务并显示服务异常；
- 配置解析失败：不修改配置，显示冲突；
- 协议不兼容：HTTP 拒绝，Bridge 仍输出 `{}`；
- 认证失败：返回 `401`，不创建卡片；
- 队列已满：返回 `429`，Bridge 不重试；
- 来源识别失败：降级为“Codex”，不影响状态接收。

## 24. 第一版兼容范围

正式验收：

- Windows 原生 Codex CLI；
- Codex App 原生 PowerShell 模式；
- 多个 CLI/App 会话并行；
- 来源无法识别时合理降级。

暂不正式验收：

- WSL 中运行的 Codex CLI；
- Codex App 的 WSL2 环境；
- Linux 路径到 Windows Bridge 的跨环境调用。

## 25. 测试计划

### 25.1 Bridge 单元测试

非法 JSON、字段缺失、超长字段、敏感内容脱敏、命令分类、CodePulse 未运行、发现文件过期、动态端口、任何错误下输出 `{}`、处理时间约束。

### 25.2 Rust 聚合器测试

新会话、新轮次覆盖、多会话汇总、优先级、最近活动排序、1 秒平滑、授权强打断、中间命令失败、Stop 保守判定、5 分钟完成删除、失败手动清除、10/30 分钟中断、授权不超时、乱序、重复事件、子智能体计数。

### 25.3 HTTP 集成测试

仅回环地址、正确/错误 Token、16 KB 限制、固定/动态端口、发现文件原子写入、重启 Token 失效、并发会话和队列过载。

### 25.4 Vue 测试

空闲隐藏/常驻、紧凑态、汇总列表、任务详情、返回、完成/失败/中断/授权、手动清除、主/卫星交换、展开时新事件、详情任务自动移除。

### 25.5 验收证据分层

#### A. 自动行为矩阵

自动测试覆盖十四项设计场景对应的内部行为和不变量：CLI/App 来源 DTO 的模拟输入、两端并行聚合、读取/修改/命令/测试阶段、授权、先失败后成功、最终失败、五分钟保留、失败清除、退出无历史补偿、端口 fallback、用户 Hook 保留、等待信任状态、Bridge 更新与卸载行为。它还覆盖协议、优先级、生命周期、文件事务、恢复、generation/revision 和多配置层逻辑事件去重。

自动行为矩阵不能证明真实 Codex App 或独立 Codex CLI 已正式兼容。模拟 `source='cli'`、mock 父进程链或直接 POST 事件都只属于自动行为证据。

#### B. Codex App 真实验收

必须在真实 Codex App 环境人工或真实运行验证：官方信任流程、真实 Hook 触发、来源识别为 App、GUI Subsystem 无控制台闪烁、多会话、实际安装/修复/卸载，以及只有当前 generation 的第一条真实事件才进入 `running`。

#### C. 独立 CLI 真实验收

必须在 PowerShell 可独立运行的官方 Codex CLI 环境验证：版本读取、真实任务、真实 Hook、来源识别、App 与 CLI 并行、授权和完成/失败场景。CLI 不可用时只能记录“环境阻塞”；此时文档与实现、App 门禁可以完成，但不得声明“Windows 原生 CLI 与 App 完整正式兼容已通过”。

## 26. 完成标准

- 不干预 Codex；
- 不明显拖慢 Codex；
- 不破坏已有 Hook；
- 不持久化项目内容；
- 同时汇总 CLI 与 App 会话；
- 关键状态提醒可靠；
- 普通状态稳定、不闪烁；
- CodePulse 未运行时 Bridge 快速静默退出；
- Bridge 或本地服务故障不影响 Codex 主流程。

## 27. 实施顺序

1. 协议、Bridge、本地 HTTP 接收器；
2. Rust 聚合器与测试；
3. Tauri 快照和命令接口；
4. Vue Codex 模块与多岛接入；
5. 设置页、Hook 安装、修复、卸载；
6. CLI 与 Codex App 端到端验收。

不得跳过协议和聚合器测试，也不得把状态机直接堆入 `IslandView.vue`。

## 28. 参考资料

- Codex Hooks：`https://developers.openai.com/codex/hooks/`
- Codex Windows App：`https://developers.openai.com/codex/windows/windows-app/`
