# CodePulse 代理执行边界

本文档定义 CodePulse 项目中所有自动化代理、代码生成器和维护者必须遵守的执行边界。除非用户在当前对话中明确覆盖，本文件优先于临时推断。

## 当前阶段边界

1. 边界确认已完成，`AGENTS.md` 不再是唯一落地文件。
2. 工程脚手架、共享模型、状态核心和桌面外壳最小版本已完成。
3. 已完成的首批代码范围为：`MockAdapter`、`AgentStateHub`、系统托盘、动态岛窗口、任务栏贴边弹窗、基础任务中心、基础设置页和 Preload 白名单 API。
4. 当前项目仍处于 MVP 分阶段实现中，不得一次性补齐所有后续功能。
5. 后续代码必须继续按 MVP 阶段分批生成，并在每一阶段完成验证后再进入下一阶段。
6. 不得跳过 AgentStateHub 直接实现多个互相独立的数据源读取逻辑。
7. 当前下一优先级为：Windows 原生通知动作手测、更完整动态岛菜单策略、更完整 Codex 会话识别、多显示器/DPI/Explorer/系统休眠 Windows 手测和更细 UI 失败展示。
8. `pnpm-workspace.yaml` 仅用于 pnpm 构建脚本审批配置，不代表项目进入多包工作区架构。

## 当前实现状态

### 已完成

1. Electron、Vue 3、TypeScript strict、Vite、Pinia、Vue Router、Element Plus、ECharts、SQLite 依赖和 Electron Builder 基础配置。
2. 共享类型、适配器接口、IPC channel、IPC 返回模型和设置模型。
3. `MockAdapter` 模拟数据源。
4. `AgentStateHub` 状态中心，包含任务优先级、事件去重、过期判断、额度不可用和适配器异常隔离。
5. 系统托盘最小版本，包含动态图标、托盘菜单、贴边弹窗入口和 Explorer 重启后托盘重建最小版本。
6. 动态岛窗口最小版本，包含收起、标准、展开和持续提醒视觉状态。
7. 任务栏贴边弹窗最小版本，包含任务栏方向推断、显示器选择和工作区边界限制。
8. 主任务中心搜索、筛选、详情、当前快照活动时间线、错误详情和复制摘要最小版本，以及设置页基础持久化。
9. `CodexAdapter` 真实接入最小版本，包含 Codex CLI 进程识别、可配置 UTF-8 JSON 状态源解析、可配置 UTF-8 JSONL 日志源解析、设置页状态源和日志源路径入口、状态源和日志源路径运行期热更新、任务和额度读取、未运行状态、检测异常降级和额度暂不可用；`ProcessAdapter` 独立适配器最小版本，包含 Claude Code、Cursor Agent 和 Gemini CLI 等本机 Agent 进程识别、运行中任务生成、命令行敏感信息隔离、未运行状态、检测异常降级和额度暂不可用；`LogAdapter` 通用日志适配器最小版本，包含可配置 UTF-8 JSONL 日志源解析、日志源路径运行期热更新、最新任务事件覆盖、额度事件读取、未配置状态、解析异常降级、命令行敏感字段隔离和额度暂不可用；`CustomCommandAdapter` 自定义命令适配器最小版本，包含默认禁用、显式授权、无 shell 执行、超时限制、输出大小限制、参数校验、输出解析、敏感内容脱敏、禁止提权命令、异常降级和授权/命令路径/参数运行期热更新。
10. `providers.detect()` 已接入真实适配器检测结果，并会更新 AgentStateHub 中的提供方连接状态。
11. IPC 参数校验、安全测试和任务操作授权最小版本，覆盖任务 ID、数据源 ID、动态岛模式、稍后提醒时间、启用状态、设置更新白名单、数据源启用与设置持久化联动、`settings.update` 启用状态同步 AgentStateHub、Codex/通用日志路径运行期配置同步、自定义命令运行期配置同步、任务打开、打开 Codex Agent、非 Codex Agent 项目目录回退、复制摘要、稍后提醒和标记已读的真实任务校验、Preload API 白名单冻结、状态订阅清理和诊断导出脱敏。
12. Windows 通知最小版本，包含任务完成、任务失败、等待处理、长时间无活动、数据源断开、额度不足和额度耗尽通知，以及事件去重、点击跳转、稍后提醒、勿扰时间段、暂停监控时抑制通知、通知去重记录清理、过期稍后提醒清理和通知运行时诊断统计。
13. 动态岛状态机、拖拽位置持久化、右键菜单、全屏自动隐藏、显示器变化处理和系统休眠恢复最小版本，包含任务开始、阶段变化、任务完成、额度阈值跨越触发展开，等待、失败、额度耗尽、数据源断开持续提醒，阶段变化节流、自动收起、悬停暂停、滚轮切换任务、Esc 收起、稍后提醒、顶部拖拽区域、自定义坐标保存、工作区限制、显示器断开回落，多显示器热插拔和 DPI 指标变化后重新限制动态岛位置并关闭贴边弹窗，系统休眠前关闭贴边弹窗、恢复后重算动态岛位置并刷新状态，全屏应用出现时按设置隐藏并在退出全屏后恢复，以及展开、收起、隐藏、打开当前任务、打开当前任务对应 Agent、复制当前任务摘要、稍后提醒当前任务、打开任务中心和设置入口。
14. 主任务中心交互补强最小版本，包含关键词搜索、状态筛选、数据源筛选、项目筛选、时间筛选、当前快照历史分组、持久化历史查询、活动时间线、错误详情、项目路径展示、任务摘要复制到剪贴板、运行统计面板、数据源异常状态和恢复建议，以及通过主进程受控打开 Codex Agent、非 Codex Agent 项目目录回退和打开项目目录；运行统计覆盖总任务、运行中、等待、失败、完成、历史样本、覆盖数据源、覆盖项目、平均结束耗时、最长无活动任务和最近活动时间。
15. SQLite 历史持久化、查询、损坏恢复和清理最小版本，包含 AgentStateHub 快照中的任务和活动 upsert 落库、应用重启后读取历史记录、历史任务和历史活动受控 IPC 查询、历史任务复制摘要与打开项目目录授权、损坏数据库备份后重建、按保留期和数量上限清理历史、历史库运行时诊断状态、退出时释放数据库。
16. 设置页通知策略配置最小版本，包含通知总开关、勿扰模式、勿扰时间段、额度提醒阈值和长时间无活动提醒阈值，并通过 `settings.update` 同步到通知管理器运行态。
17. 开发、打包、适配器扩展、故障排查和产品架构文档。
18. 构建产物已可通过 `pnpm run dist` 生成 Windows NSIS 安装包。

### 未完成

1. `CodexAdapter` 已完成可配置状态源和日志源解析、状态源和日志源路径运行期热更新最小版本，`ProcessAdapter` 已完成本机 Agent 进程检测最小版本，`LogAdapter` 已完成通用 JSONL 日志源解析和日志源路径运行期热更新最小版本，`CustomCommandAdapter` 已完成默认禁用、授权执行和授权/命令路径/参数运行期热更新最小版本；更完整的 Codex 会话识别仍需补强。
2. 动态岛状态机、拖拽位置持久化和右键菜单已完成最小版本，并已支持主进程右键菜单打开当前任务、打开当前任务对应 Agent、复制当前任务摘要和稍后提醒当前任务；更完整的任务级菜单策略和 Windows 手测仍未完成。
3. Windows 通知已完成最小版本、暂停监控通知抑制和设置页通知策略配置最小版本，但原生通知动作在不同 Windows 版本上的手测仍需加强。
4. 主任务中心已完成搜索、状态筛选、数据源筛选、项目筛选、时间筛选、当前快照历史分组、持久化历史查询、活动时间线、错误详情、项目路径展示、复制摘要、打开 Codex Agent、非 Codex Agent 项目目录回退、打开项目目录、运行统计和数据源异常展示最小版本；更深入的趋势图、成功率、运行质量分析和更多失败恢复视图仍未完成。
5. 设置页仍为基础页，已包含 Codex 状态源、Codex 日志源、通用 Agent 日志源路径入口、Codex/本机进程/通用日志/模拟/自定义命令启用开关、自定义命令基础配置、通知策略配置、Codex/通用日志路径运行期配置同步和自定义命令运行期配置同步；尚未完成显示器选择和动态岛位置细项。
6. SQLite 已完成任务历史和活动记录最小落库、任务中心历史查询、数据库损坏恢复和清理策略；诊断数据落库和更多数据库失败 UI 展示尚未完成。
7. 全屏应用自动隐藏、Explorer 重启托盘恢复、多显示器热插拔、DPI 动态变化和系统休眠恢复已完成最小版本；多显示器、DPI、Explorer 重启和系统休眠恢复仍需 Windows 手测和更多系统事件失败 UI 展示。
8. IPC 已有白名单 API、参数校验、错误码归一化、任务操作真实任务校验、数据源启用与设置持久化联动、Codex/通用日志路径运行期配置同步、自定义命令运行期配置同步、Preload API 安全测试和诊断脱敏测试最小版本，但更细业务授权仍需加强。
9. UI/E2E 测试和 Windows 手测尚未完成。
10. 正式应用图标、代码签名和发布级安装体验尚未完成。

## 产品目标

CodePulse 是 Windows 本地 AI Agent 状态助手，首期提供两种核心交互形态：

1. Windows AI Agent 动态岛，用于展示任务开始、阶段变化、等待用户、任务失败、任务完成、额度不足等重要事件。
2. 系统托盘状态图标和任务栏贴边弹窗，用于持续展示 Agent 总体状态、运行任务数量、剩余额度和待处理事项。

动态岛、托盘、贴边弹窗、主任务中心和设置页必须共享同一套状态数据，不得分别读取日志、轮询进程或维护业务状态。

## 技术栈边界

项目技术栈固定为：

1. Electron
2. Vue 3
3. TypeScript
4. Vite
5. Pinia
6. Vue Router
7. Element Plus
8. ECharts
9. SQLite
10. Electron Builder

所有 TypeScript 必须开启严格模式。首期不使用 Spring Boot，不依赖云端服务器，不引入账号体系、团队协作、云同步或远程控制。

## 代码与文件规则

1. 所有代码注释必须使用中文，请勿进行转码。
2. 页面文本、变量说明、类型说明和错误说明必须使用中文；公共类型名、字段名和协议字段可沿用英文标识。
3. 禁止使用 UTF-16、GBK 等编码。
4. 中文内容必须直接输出，不允许使用 `\uXXXX` Unicode 转义格式。
5. 所有文本文件写入必须使用 UTF-8 编码。
6. 创建、修改、写入文本文件时必须使用 UTF-8 without BOM 编码。
7. 使用 PowerShell 写入文件时必须明确指定 UTF-8 编码；在会产生 BOM 的旧版 PowerShell 中，应使用无 BOM 写入方式。
8. 禁止创建或修改 `package-lock.json`、`yarn.lock`。
9. 项目依赖锁定文件统一使用 `pnpm-lock.yaml`。

## 包管理规则

项目统一使用 `pnpm` 作为包管理工具，禁止使用 `npm` 或 `yarn` 执行依赖安装、删除、更新及项目脚本。

允许的命令形式：

1. 安装项目依赖：`pnpm install`
2. 添加生产依赖：`pnpm add 包名`
3. 添加开发依赖：`pnpm add -D 包名`
4. 删除依赖：`pnpm remove 包名`
5. 执行项目脚本：`pnpm run 脚本名`
6. 临时执行 npm 包命令：`pnpm dlx 包名`

禁止的命令形式：

1. `npm install`
2. `npm run`
3. `npx`
4. `yarn`
5. `yarn add`
6. `yarn run`

## 目标目录结构

当前工程目录应按以下结构组织：

```text
CodePulse/
  AGENTS.md
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  electron-builder.yml
  vite.config.ts
  index.html
  tsconfig*.json
  src/
    shared/
      types/
      ipc/
      constants/
    main/
      bootstrap/
      windows/
      tray/
      state/
      adapters/
      persistence/
      notifications/
      system/
      ipc/
    preload/
      index.ts
      codePulseApi.ts
    renderer/
      apps/
        island/
        popup/
        center/
        settings/
      components/
      stores/
      router/
      styles/
  docs/
    product-architecture.md
    development.md
    packaging.md
    adapter-extension.md
    troubleshooting.md
    plans/
```

不得在没有必要时引入额外顶层目录。新增目录必须服务于 Electron 主进程、Preload 安全层、Vue 渲染进程、共享类型或文档。

## 核心架构边界

项目分为四个主要层次：

1. Electron 主进程：负责单实例锁、系统托盘、动态岛窗口、贴边弹窗、主任务中心窗口、设置窗口、多显示器检测、DPI 缩放、位置管理、贴边吸附、始终置顶、鼠标穿透、全屏检测、开机启动、Windows 通知、本地进程检测、日志和状态文件监听、数据持久化、IPC 通信、任务栏进度、Overlay 状态、休眠恢复、Explorer 重启后的托盘恢复。
2. Preload 安全层：只暴露经过限制的业务 API，不得直接暴露 `ipcRenderer`、文件系统、Shell 或 Node.js API。
3. Vue 渲染进程：包含动态岛界面、任务栏贴边弹窗、主任务中心、设置页面、任务详情、额度展示、历史记录、错误和空状态。
4. AgentStateHub：统一接收适配器事件、转换模型、去重、判断优先级、维护运行时长、判断过期、触发动态岛事件、更新托盘、更新任务栏进度、发送通知、保存历史、广播状态。

所有界面只能消费 AgentStateHub 广播的统一快照。

## AgentStateHub 规则

AgentStateHub 是唯一业务状态中心，必须负责：

1. 接收不同适配器的原始事件。
2. 转换为统一数据模型。
3. 合并重复事件。
4. 判断当前最高优先级任务。
5. 维护任务运行时间。
6. 判断数据是否过期。
7. 触发动态岛事件。
8. 更新托盘图标。
9. 更新任务栏进度。
10. 发送 Windows 通知。
11. 保存历史记录。
12. 向所有渲染窗口广播状态。

状态优先级从高到低固定为：

```text
waiting
failed
quotaCritical
disconnected
completed
executing
analyzing
idle
```

当多个任务同时存在时，动态岛默认展示优先级最高的任务。如果存在两个以上相同高优先级任务，必须显示聚合信息，例如“3 个任务需要处理”。

## 适配器规则

统一适配器接口必须包含：

1. `start`
2. `stop`
3. `detect`
4. `refresh`
5. `subscribe`
6. `getCurrentTasks`
7. `getQuota`
8. `getConnectionStatus`
9. `dispose`

首期至少规划以下适配器：

1. `MockAdapter`
2. `ProcessAdapter`
3. `LogAdapter`
4. `CustomCommandAdapter`
5. `CodexAdapter`

适配器必须输出统一事件，不能直接操作界面、托盘、通知、窗口、数据库或 IPC 广播。适配器错误必须转化为连接、解析或权限类状态，不得导致主进程崩溃。

`CustomCommandAdapter` 默认禁用，启用前必须具备明确用户授权、执行超时、输出大小限制、参数校验、错误处理和敏感内容脱敏。自定义命令不得以管理员权限运行。

## 数据模型边界

后续共享类型必须覆盖以下模型：

1. `AgentProvider`
2. `AgentTask`
3. `AgentActivity`
4. `QuotaSnapshot`
5. `DisplaySettings`
6. `AgentStateSnapshot`

任务状态必须覆盖：

```text
idle
detecting
analyzing
planning
executing
testing
waiting
completed
failed
disconnected
stale
unknown
```

任务进度类型必须覆盖：

```text
determinate
staged
indeterminate
unavailable
```

只有数据源提供可靠百分比时，才能显示确定进度。禁止根据运行时间伪造任务百分比。额度无法获取时必须显示“额度暂不可用”，不得显示为 0%。

## IPC 安全边界

Preload 只允许暴露 `window.codePulse`。

公开业务 API 规划如下：

1. 状态接口：`state.getSnapshot()`、`state.subscribe(listener)`、`state.refresh(providerId?)`
2. 任务接口：`tasks.open(taskId)`、`tasks.openAgent(taskId)`、`tasks.copySummary(taskId)`、`tasks.listHistory(limit?)`、`tasks.getHistoryActivities(taskId, limit?)`、`tasks.snooze(taskId, until)`、`tasks.markViewed(taskId)`
3. 适配器接口：`providers.list()`、`providers.detect()`、`providers.setEnabled(providerId, enabled)`
4. 设置接口：`settings.get()`、`settings.update(partialSettings)`
5. 窗口接口：`windows.openTaskCenter(taskId?)`、`windows.openSettings()`、`windows.setIslandMode(mode)`、`windows.closePopup()`
6. 系统接口：`system.getDisplays()`、`system.getConnectionStatus()`
7. 诊断接口：`diagnostics.exportRedacted()`

主进程内部 IPC channel 必须使用 `codepulse:*` 前缀，并进行参数校验、错误归一化和取消订阅清理。

## Electron 窗口规则

动态岛窗口：

1. 无边框、透明、始终置顶，默认不进入任务栏。
2. 支持 `hidden`、`collapsed`、`normal`、`expanded`、`persistent`、`dragging`。
3. 收起态约为 `160 × 36` DIP，标准态约为 `360 × 88` DIP，展开态约为 `420 × 260` DIP。
4. 收起态可以按设置启用鼠标穿透，展开态必须自动关闭鼠标穿透。
5. 支持屏幕顶部居中、顶部左侧、顶部右侧、屏幕右侧、用户自由拖拽、固定主显示器、跟随当前活动显示器。
6. 窗口位置必须限制在有效工作区内，显示器断开后自动移动到主显示器。

任务栏贴边弹窗：

1. 无边框，不进入 Alt + Tab，不创建普通任务栏按钮。
2. 默认尺寸约为 `360 × 480` DIP。
3. 点击托盘图标打开或关闭。
4. 点击弹窗外部关闭，再次点击托盘图标关闭，按 Esc 关闭。
5. 根据任务栏方向选择展开方向：底部向上，顶部向下，左侧向右，右侧向左。
6. 最终位置必须夹在目标显示器有效工作区内。

主任务中心：

1. 普通窗口，关闭后默认隐藏到托盘。
2. 支持任务列表、任务详情、筛选、搜索、刷新、设置入口、额度和运行统计。
3. 所有数据来自 AgentStateHub 快照或受控 IPC 请求。

## 动态岛状态机规则

默认状态为 `collapsed` 或根据设置进入 `hidden`。

触发展开：

1. 任务开始。
2. 有效阶段变化。
3. 任务完成。
4. 额度阈值跨越。

触发持续提醒：

1. 等待用户确认。
2. 任务失败。
3. 额度耗尽。
4. 数据源断开。

`persistent` 状态不得自动消失，必须等待用户查看、稍后提醒、状态恢复或勿扰策略处理。正常运行期间阶段变化必须节流和去重，不得频繁打扰用户。

交互规则：

1. 单击展开。
2. 双击打开对应 Agent 或任务中心。
3. 右键打开菜单。
4. 鼠标悬停暂停自动收起。
5. 拖拽移动位置。
6. 鼠标滚轮切换任务。
7. Esc 收起动态岛。

## 托盘规则

托盘图标至少覆盖以下状态：

1. 空闲
2. 正在运行
3. 等待用户
4. 已完成
5. 失败
6. 额度不足
7. 数据源断开

图标不能只依赖颜色区分，必须同时通过轮廓、角标或符号区分。

托盘菜单必须包含：

1. 打开状态面板
2. 打开任务中心
3. 显示或隐藏动态岛
4. 勿扰模式
5. 暂停监控
6. 刷新状态
7. 设置
8. 退出

Explorer 重启后必须尝试恢复托盘图标，并对恢复失败提供明确错误状态。

## 任务栏贴边弹窗定位算法边界

定位算法输入：

1. 托盘图标边界。
2. 当前鼠标点。
3. 所有显示器的 `bounds` 和 `workArea`。
4. 弹窗尺寸。
5. 边距和间距。

显示器选择顺序：

1. 托盘图标所在显示器。
2. 当前鼠标所在显示器。
3. 主显示器。

任务栏方向判断：

1. 根据 `bounds` 与 `workArea` 的差异判断底部、顶部、左侧、右侧。
2. 自动隐藏任务栏时使用托盘图标位置辅助判断。
3. 判断失败时默认按底部任务栏处理。

最终位置必须经过 `clamp` 限制在目标显示器有效工作区内。

## 通知规则

以下情况发送 Windows 通知：

1. 任务完成。
2. 任务失败。
3. 等待用户确认。
4. 长时间没有活动。
5. 数据源断开。
6. 额度低于阈值。
7. 额度耗尽。

同一任务、同一事件类型必须去重。通知点击后打开任务中心并定位到对应任务。等待确认通知必须提供“查看任务”和“稍后提醒”操作。必须支持勿扰时间段。

## 隐私和权限规则

应用默认仅在本地运行，默认不上传日志、任务名称、项目路径或源代码。

诊断信息导出时必须脱敏：

1. Windows 用户名。
2. 用户目录。
3. 项目完整路径。
4. Token。
5. API Key。
6. 环境变量。
7. 命令参数中的敏感内容。

适配器只读取状态所需的数据，不得读取源代码正文或无关文件。

## 异常状态规则

必须为以下异常提供明确状态、文案和恢复路径：

1. 未发现 Agent。
2. Agent 未运行。
3. 正在检测。
4. 数据源未配置。
5. 日志文件不存在。
6. 文件无权限。
7. 数据格式无法解析。
8. 自定义命令执行超时。
9. Agent 进程意外退出。
10. 状态数据过期。
11. 额度无法获取。
12. 额度为估算值。
13. 显示器断开。
14. DPI 发生变化。
15. 系统休眠后恢复。
16. Explorer 重启。
17. 托盘图标重建失败。
18. 数据库损坏。
19. 应用重复启动。

数据超过过期时间后，不得继续展示“正在运行”。

## 视觉和体验规则

整体风格为 Windows Fluent Design，深色优先，支持浅色主题，半透明背景，轻微磨砂效果，清晰圆角，克制阴影，高信息密度，低干扰动画，开发者工具风格。

动态岛视觉上应接近系统组件，而不是普通网页弹窗。动画只能表达状态变化，不得持续播放高频装饰动画。

## MVP 阶段顺序

1. 已完成：边界确认，创建并维护 `AGENTS.md`。
2. 已完成：工程脚手架，建立 Electron、Vue 3、TypeScript strict、Vite、Pinia、Vue Router、Element Plus、ECharts、SQLite、Electron Builder。
3. 已完成：共享模型，实现统一类型、事件模型、适配器接口、IPC schema 和设置模型。
4. 已完成：状态核心，实现 `MockAdapter`、`AgentStateHub`、优先级、去重、过期、额度不可用和广播。
5. 已完成最小版本：桌面外壳，实现单实例锁、托盘动态图标、Explorer 重启后托盘重建、动态岛窗口、贴边弹窗、窗口位置、多显示器热插拔回位和 DPI 指标变化基础适配。
6. 部分完成：真实接入已实现首期 `CodexAdapter` 进程检测、可配置状态源解析、可配置日志源解析、设置页状态源和日志源路径入口、状态源和日志源路径运行期热更新最小版本，`ProcessAdapter` 本机 Agent 进程检测最小版本，`LogAdapter` 通用 UTF-8 JSONL 日志源解析和日志源路径运行期热更新最小版本，以及 `CustomCommandAdapter` 默认禁用、显式授权、安全执行和授权/命令路径/参数运行期热更新最小版本；解析失败、进程检测失败和命令执行失败时必须继续降级为明确错误状态，更完整的 Codex 会话识别仍需补强。
7. 部分完成：完整体验已实现 Windows 通知最小版本、通知运行时记录清理、暂停监控通知抑制最小版本、设置页通知策略配置最小版本、主任务中心交互补强、运行统计和数据源异常展示最小版本、Codex 打开 Agent 最小版本、非 Codex Agent 项目目录回退最小版本、动态岛右键菜单打开当前任务、打开当前任务对应 Agent、复制当前任务摘要和稍后提醒当前任务最小版本、全屏自动隐藏最小版本、Explorer 托盘恢复最小版本、多显示器热插拔和 DPI 动态变化最小版本、系统休眠恢复最小版本、SQLite 历史持久化、任务中心历史查询、数据库损坏恢复、历史清理、数据源启用设置联动、设置页启用开关、Codex/通用日志路径运行期配置同步和自定义命令运行期配置同步最小版本；多显示器/DPI/Explorer/系统休眠 Windows 手测和更多系统事件失败 UI 展示仍未完成。

## 验证规则

后续阶段必须至少覆盖：

1. 单元测试：状态优先级、事件去重、过期判断、额度不可用不显示 0%、适配器异常隔离。
2. IPC 测试：渲染进程无法访问 Node.js，只能通过 Preload 调用白名单 API。
3. UI/E2E 测试：动态岛三态切换、等待或失败保持 `persistent`、托盘弹窗开关、Esc 关闭、外部点击关闭。
4. Windows 手测：100% 到 175% DPI、多显示器插拔、任务栏四方向、自动隐藏任务栏、全屏应用、系统休眠恢复、Explorer 重启。
5. 构建验证：统一使用 `pnpm run typecheck`、`pnpm run test`、`pnpm run build`、`pnpm run dist`。

当前阶段验证必须至少执行：

1. `pnpm run typecheck`
2. `pnpm run test`
3. `pnpm run build`
4. `pnpm run dist`
5. 项目文本文件 UTF-8 without BOM 检查。
6. 项目范围内不得出现 `package-lock.json` 或 `yarn.lock`。
