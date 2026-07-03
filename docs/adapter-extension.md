# CodePulse 适配器扩展说明

## 适配器边界

适配器只负责读取状态并输出统一事件，不得直接操作界面、托盘、通知、窗口、数据库或 IPC。

统一接口必须包含：

1. `start`
2. `stop`
3. `detect`
4. `refresh`
5. `subscribe`
6. `getCurrentTasks`
7. `getQuota`
8. `getConnectionStatus`
9. `dispose`

需要支持设置热更新的适配器可以额外实现 `updateRuntimeConfig(config)`。该能力不是基础适配器必需项；当前 `CodexAdapter` 用于状态源和日志源路径运行期同步，`LogAdapter` 用于日志源路径运行期同步，`CustomCommandAdapter` 用于授权、命令路径、参数、工作目录、超时时间和输出限制的运行期同步。

## 事件输出

适配器通过 `AgentAdapterEvent` 输出：

1. Provider 更新。
2. 任务列表更新。
3. 单任务更新。
4. 活动创建。
5. 额度更新。
6. 连接状态变化。
7. 错误事件。

## 错误处理

适配器异常必须转为连接、解析或权限类状态。异常不得抛到主进程事件循环之外，也不得导致应用退出。

## CodexAdapter 当前边界

`CodexAdapter` 当前实现进程检测、可配置状态源和可配置日志源最小版本：

1. 通过本机进程列表识别 Codex CLI 是否运行。
2. 检测到进程时输出运行中任务。
3. 未检测到进程时输出未运行连接状态。
4. 进程检测异常时输出连接错误状态。
5. 额度暂不可用时返回空额度字段，不得返回 0%。
6. 任务模型不得暴露命令行参数、Token、API Key、用户目录或项目完整路径。
7. 可通过 `statusFilePath` 或 `CODEPULSE_CODEX_STATUS_FILE` 读取 UTF-8 JSON 状态源。
8. 状态源支持 `tasks` 和 `quota` 字段，任务字段会被转换为统一 `AgentTask`，额度字段会被转换为统一 `QuotaSnapshot`。
9. 状态源为空时回退到进程检测；状态源格式错误、文件过大或无法解析时降级为连接错误状态。
10. 可通过 `logFilePath` 或 `CODEPULSE_CODEX_LOG_FILE` 读取 UTF-8 JSONL 日志源。
11. 日志源支持 `type: "task"` 和 `type: "quota"` 事件，同一任务多条记录取最新记录，任务和额度会转换为统一模型。
12. 日志源为空时回退到进程检测；日志源格式错误、文件过大或无法解析时降级为连接错误状态。
13. 状态源和日志源任务会话标识支持 `id`、`taskId`、`task_id`、`sessionId`、`session_id`、`codexSessionId`、`codex_session_id`、`conversationId`、`conversation_id`、`threadId`、`thread_id` 以及 `session`、`conversation`、`thread` 嵌套对象；缺少任务 ID 时会使用会话标识生成稳定任务 ID，日志源同一会话多条任务记录取最新记录。

状态源和日志源路径已可通过设置页持久化配置，并会通过 `settings.update(partialSettings)` 同步到运行期适配器。运行期修改路径后，下一次刷新会读取新路径；运行期清空路径后，不得继续沿用旧文件，状态源和日志源都会回退到进程检测。后续增加更多 Codex 原生日志格式覆盖时，仍必须通过 `AgentStateHub` 输出统一快照，不得由界面直接读取日志或进程。

## ProcessAdapter 当前边界

`ProcessAdapter` 当前实现本机 Agent 进程检测最小版本：

1. 通过本机进程列表识别 Claude Code、Cursor Agent 和 Gemini CLI 等已知 Agent 进程。
2. 检测到进程时输出运行中任务。
3. 未检测到进程时输出未运行连接状态和空任务列表。
4. 进程检测异常时输出连接错误状态。
5. 额度暂不可用时返回空额度字段，不得返回 0%。
6. 任务模型不得暴露命令行参数、Token、API Key、用户目录或项目完整路径。
7. `tasks:updated` 事件会替换同一数据源的任务列表，进程消失后不得保留旧运行任务。

`ProcessAdapter` 只做进程级存在检测，不解析日志和项目上下文。后续如需解析特定工具日志，应通过 `LogAdapter` 或具体工具适配器输出统一事件。

## LogAdapter 当前边界

`LogAdapter` 当前实现通用 UTF-8 JSONL 日志源解析最小版本：

1. 默认以可见禁用态注册到主进程；设置页启用后才会读取通用 Agent 日志源。
2. 日志源支持 `type: "task"` 和 `type: "quota"` 事件。
3. 同一任务多条记录按日志顺序取最新记录。
4. 任务事件会按白名单字段转换为统一 `AgentTask`，不会复制命令行参数、Token、API Key 或其他未声明字段。
5. 额度事件会转换为统一 `QuotaSnapshot`；额度缺失时返回空额度字段，不得返回 0%。
6. 未启用时由 AgentStateHub 停止读取并清空该数据源任务和额度；启用但未配置日志源时返回“日志源未配置”；日志为空时返回未运行状态。
7. 日志文件不存在、无权限、超过大小限制或格式无法解析时降级为连接错误状态，不得导致主进程崩溃。
8. 日志源路径已可通过设置页持久化配置，并会通过 `settings.update(partialSettings)` 同步到运行期适配器。运行期修改路径后，下一次刷新会读取新路径；运行期清空路径后，不得继续沿用旧文件，应恢复为“日志源未配置”状态。

通用日志事件格式适合由外部工具主动输出状态，不得要求 CodePulse 读取源代码正文或无关文件。

## CustomCommandAdapter 当前边界

`CustomCommandAdapter` 当前实现默认禁用的自定义命令适配器最小版本：

1. 默认以可见禁用态注册到主进程，不执行任何命令。
2. 只有设置页中启用自定义命令、确认授权执行并提供命令路径后才会执行。
3. 命令通过 `execFile` 无 shell 执行，不拼接 shell 字符串。
4. 每次执行强制使用超时时间和输出大小限制。
5. 命令参数、工作目录、超时时间和输出限制必须通过 IPC 白名单校验。
6. 明确拒绝 `runas`、`sudo`、`pkexec` 和 PowerShell `Start-Process -Verb RunAs` 这类提权入口。
7. 命令输出必须是 UTF-8 JSON，支持 `tasks` 和 `quota` 字段。
8. 任务字段按白名单转换为统一 `AgentTask`，不会复制命令路径、命令参数或未声明字段。
9. 输出中的 Token、API Key、Authorization、环境变量敏感值、敏感命令参数和 Windows 路径会在进入任务模型前脱敏。
10. 未启用会由 AgentStateHub 停止读取并清空该数据源任务和额度；未授权、未配置、执行超时、输出无法解析和执行失败都会转为明确连接状态或错误事件，不得导致主进程崩溃。
11. 设置页修改授权、命令路径、参数、工作目录、超时时间或输出限制后，会通过 AgentStateHub 同步到运行期适配器，无需重启应用即可生效。

## 数据源启用联动

`providers.setEnabled(providerId, enabled)` 和 `settings.update(partialSettings)` 中的 provider 启用字段都会同步 AgentStateHub 运行态并持久化设置。当前白名单数据源 ID 为 `codex`、`process`、`log`、`custom-command` 和 `mock-codex`。

禁用数据源时，AgentStateHub 会停止对应适配器并清空该数据源的任务和额度；重新启用时会重新启动适配器并恢复快照。适配器上报的 provider 快照不得覆盖用户当前启用状态。

`settings.update(partialSettings)` 中的 Codex 状态源路径、Codex 日志源路径、通用日志源路径和自定义命令配置会同时触发运行期配置同步。若对应数据源已启用，AgentStateHub 会在配置更新后刷新该适配器并重新广播统一快照；若处于禁用状态，只保存配置并保持任务和额度为空。

自定义命令输出应该只包含状态所需字段，不得要求 CodePulse 读取源代码正文或无关文件。

## 自定义命令限制

`CustomCommandAdapter` 默认禁用。启用前必须具备明确用户授权、执行超时、输出大小限制、参数校验、错误处理和敏感内容脱敏。自定义命令不得以管理员权限运行。
