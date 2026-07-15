# AGENTS.md — NetSpeed Dynamic Pro 项目指南

## 项目概况

**NetSpeed Dynamic Pro（NSD）**是一个基于 Tauri 2、Vue 3 与 Rust 的 Windows 桌面灵动岛应用。主控制台负责设置、网速与流量统计；透明的 Widget 窗口负责网速、音乐、硬件、通知及系统提示展示。

- **版本**：`2.3.8`
- **应用标识**：`com.ryen.nsd`
- **仓库**：<https://github.com/GEORGEWWWU/NetSpeed-Dynamic>
- **协议**：MIT
- **目标平台**：Windows；Rust 后端直接依赖 Windows API，不要求跨平台兼容。
- **包管理器**：`pnpm@10.33.2`，锁文件为 `pnpm-lock.yaml`。

## 当前目录结构

```text
CodePulse/
├─ docs/
│  ├─ plans/                              # 已完成的设计与重构记录
│  ├─ superpowers/plans/                  # 音乐歌词重构实施记录
│  └─ 2026-07-16-codex-status-island-design.md
│                                          # Codex 状态岛设计，尚未实现
├─ src/                                   # Vue 3 + TypeScript 前端
│  ├─ components/
│  │  ├─ dashboard/                       # 控制台视图、设置和图表
│  │  └─ island/                          # 灵动岛外壳、展示与内容组件
│  ├─ composables/                        # 窗口、动画、音乐会话、歌词等组合式逻辑
│  ├─ modules/island/                     # 无副作用的岛布局、歌词、时间线逻辑
│  ├─ router/                             # `/` 与 `/widget` 路由
│  ├─ shared/
│  │  ├─ ipc/                             # Tauri 命令、事件和契约
│  │  └─ utils/                           # localStorage 与事件监听器注册表
│  ├─ stores/                             # Pinia 设置、网络、灵动岛状态
│  ├─ styles/theme.css                    # 全局主题变量
│  └─ assets/                             # 图标、音乐平台图标与截图
├─ src-tauri/                             # Rust / Tauri 后端
│  ├─ capabilities/default.json           # Tauri 权限
│  ├─ src/
│  │  ├─ app/                             # AppState：sysinfo 网络与系统状态
│  │  ├─ commands/                        # Tauri 命令及 SMTC 时间线
│  │  ├─ lyrics/                          # 歌词服务、缓存、解析、源与测试
│  │  ├─ lib.rs                           # 初始化、命令注册、托盘、窗口事件
│  │  └─ main.rs                          # Rust 入口
│  ├─ Cargo.toml
│  └─ tauri.conf.json                     # 双窗口配置
├─ package.json
├─ pnpm-lock.yaml
├─ vite.config.ts
└─ vitest.config.ts
```

### 路由与窗口

| 路径 | 组件 | 窗口 | 用途 |
|---|---|---|---|
| `/` | `DashboardView.vue` | `main`，700×550 | 主控制台 |
| `/widget` | `IslandView.vue` | `widget`，初始 210×36 | 透明、无边框、置顶、跳过任务栏的灵动岛 |

运行时尺寸由 `resolveIslandLayout()` 与 `useIslandWindow()` 协同计算并通过 `set_window_bounds` 设置；紧凑岛基准尺寸为 260×42，展开音乐、通知、硬件等内容时会变大。因此不要把 `tauri.conf.json` 中的 Widget 初始尺寸当成固定展示尺寸。

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面框架 | Tauri 2 |
| 前端 | Vue 3.5、TypeScript 5.6、Vue Router 5、Pinia 3 |
| 构建与质量 | Vite 6、ESLint 10、Prettier 3、Vitest 4、`@vue/test-utils` 2、jsdom |
| 图表 | ECharts 6 |
| Rust 运行时 | Tokio 1、serde、reqwest 0.12、async-trait |
| Windows 能力 | `windows` 0.58、Windows SMTC、Toast、WASAPI、Win32 窗口与电源 API |
| 系统与音频 | sysinfo 0.30、rustfft 6.2、WASAPI loopback |

## 架构要点

### 双窗口与状态同步

主窗口与 Widget 分别创建 Vue 应用，**不共享 Pinia 内存状态**。跨窗口状态通过 Tauri 事件同步：事件常量在 `src/shared/ipc/events.ts`，Payload 在 `contracts.ts`，命令封装在 `commands.ts`。

```text
主窗口（设置 / 图表）
        │  Tauri 事件与 invoke
        ▼
Widget（IslandView） ── Tauri 命令 ── Rust 后端 / Windows API
```

`settings.ts` 仍以 localStorage 为前端设置来源。`settings_commands.rs` 中的快照与更新命令当前是**简化实现**：快照返回默认值，`update_settings` 广播补丁但不持久化。修改设置同步方案时，不能误以为 Rust 侧已经保存了完整真实设置。

### 多岛布局

布局调度位于 `src/modules/island/display.ts` 的 `resolveIslandLayout()`。当前可识别的类型为：

- `network`：永久兜底岛；
- `music`、`hardware`、`notification`、`system-toast`：已接入展示；
- `agent`、`wechat`、`update`：布局模型已预留，尚无完整运行时模块。

主岛选择顺序为：强打断 → 未过期的手动聚焦 → 软打断 → 轮换 → 稳定主岛 → 优先级 → 网速兜底。卫星岛默认最多三个，排除网速与系统提示，并显示溢出数量。`musicProgressVisible` 会影响展开音乐岛的高度，改动进度条时必须同时检查布局尺寸逻辑和组件渲染条件。

### 音乐播放、歌词与进度跳转

音乐链路已拆分，新增功能不要重新堆回 `IslandView.vue`：

```text
目标播放器设置
  → musicTargetCoordinator（目标提交与操作串行化）
  → useMusicPlaybackSession
  → musicPlaybackRuntime（1 秒轮询、3 秒陈旧看门狗）
  → usePlaybackTimeline（100 毫秒响应式刷新）
  → useTrackLyrics / useTrackCover
  → MusicContent、MusicLyricsPanel、MusicProgressControl
```

- Rust SMTC 快照包含 `canSeek`、时长、播放位置、源时间锚点和采样时间。
- `playbackTimeline.ts` 只用单调时钟推动本地播放进度，并对服务端快照做平滑校正。
- 进度条只在会话就绪、可跳转且时间线有效时展示；跳转通过 `seek_system_media`，成功后强制拉取新快照。
- 前端歌词按播放会话身份隔离，支持内存正/负缓存、请求代际隔离和两次退避重试；封面使用最近 50 首的 LRU 内存缓存。
- Rust `LyricsService` 管理于应用数据目录的 `lyrics` 子目录，缓存 TTL 为 30 天；单次 HTTP 超时 3 秒、整次查询截止 8 秒。当前在线源为网易云与 QQ 音乐，并按目标播放器偏好排序后选择置信度最高的结果。

### 后端初始化与系统集成

`src-tauri/src/lib.rs` 按以下顺序初始化：创建歌词服务、启动音频频谱与系统事件监控、按启动参数显示主窗口、创建托盘、注册主窗口与 Widget 关闭拦截。两个窗口的关闭请求都会改为隐藏；托盘左键恢复主窗口，菜单“强制退出”直接退出进程。

Widget 在 Windows 下会额外设置 `WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT`。所有新增 Win32 `unsafe` 调用必须说明安全前提、保持传入缓冲区生命周期，并处理可恢复错误。

## 关键前端模块

### Stores

| Store | 职责 |
|---|---|
| `useSettingsStore` | 主题、透明度、停靠、自启动、目标播放器与模块开关；通过 `watch` 持久化 localStorage。 |
| `useNetworkStore` | 网速采样、15 个点的趋势数据、每日与月度流量统计。 |
| `useIslandStore` | 灵动岛可见性与设置面板状态，监听显隐同步事件。 |

### Composables 与纯逻辑

| 位置 | 职责 |
|---|---|
| `useIslandWindow`、`useIslandAnimation`、`useIslandDrag` | Widget 尺寸位置、进出场动画、拖拽和锁定。 |
| `useMusicSpectrum` | 音频频谱轮询和无频谱时的保底脉冲。 |
| `useMusicPlaybackSession`、`musicPlaybackRuntime`、`musicTargetCoordinator` | 目标播放器切换、串行媒体操作、轮询、陈旧和异步代际保护。 |
| `usePlaybackTimeline`、`modules/island/playbackTimeline.ts` | 播放位置时钟与时间锚点校正。 |
| `useTrackLyrics`、`trackLyricsCache`、`modules/island/lyrics.ts` | 歌词请求、重试、缓存、标准化与当前行匹配。 |
| `useTrackCover` | 封面请求、LRU 缓存与旧请求覆盖防护。 |
| `modules/island/musicActivity.ts` | 启动阶段与开关切换时的音乐会话启停规则。 |
| `shared/utils/eventListenerRegistry.ts` | 统一登记与释放 Tauri 事件监听器。 |

`IslandView.vue` 仍是现有的核心编排组件（约 1,200 行）。新增音乐、歌词、Agent 或其他业务状态时，应优先添加 composable、纯逻辑模块或内容组件，只在其中接线，避免继续扩大该文件。

### 灵动岛内容组件

- `IslandShell.vue`：外壳、流光边框、展开区域；
- `IslandDisplayController.vue`：按布局种类分发内容；
- `IslandSatelliteStrip.vue`、`IslandStatusIndicator.vue`：卫星岛与状态指示；
- `MusicContent.vue`：紧凑音乐信息、展开歌词、媒体控制与进度条；样式拆分在 `MusicContent.css`；
- `MusicLyricsPanel.vue`、`MusicProgressControl.vue`：歌词状态和可访问的范围进度控件；
- `SpeedContent.vue`、`HardwareContent.vue`、`NotificationContent.vue`、`SystemToastContent.vue`：其余已接入内容。

样式通常使用 SFC 的 `<style scoped>`，但已有 `MusicContent.css` 和 `IslandSettingsPanel.css` 这类与组件同目录的拆分样式。遵循附近模块的做法，不要为了形式把已有拆分样式强行内联。

## Rust 命令清单

| 命令 | 位置 | 功能 |
|---|---|---|
| `set_target_player` | `media_session_commands.rs` | 设置目标 SMTC 播放器。 |
| `fetch_netease_music_info` | `media_session_commands.rs` | 兼容性音乐信息查询。 |
| `get_music_playback_state` | `media_session_commands.rs` | 获取包含时间线锚点与可跳转能力的完整播放快照。 |
| `control_system_media` | `media_session_commands.rs` | 播放暂停、上一首、下一首。 |
| `seek_system_media` | `media_session_commands.rs` | 将相对毫秒位置换算为 SMTC ticks 并跳转。 |
| `get_random_cover_url` | `media_commands.rs` | 获取曲目封面。 |
| `get_lyrics_for_track` | `lyrics_commands.rs` | 调用统一歌词服务。 |
| `get_audio_spectrum` | `audio_spectrum_commands.rs` | 获取五段 WASAPI/FFT 频谱。 |
| `get_network_stats` | `system_commands.rs` | 返回累计收发字节。 |
| `get_hardware_stats` | `system_commands.rs` | 返回 CPU 使用率、已用内存和总内存。 |
| `get_network_latency` | `system_commands.rs` | 测试到 `223.5.5.5:53` 的 TCP 延迟。 |
| `is_widget_visible`、`force_window_topmost`、`set_window_bounds`、`start_island_animation` | `window_commands.rs` | Widget 可见性、置顶、边界与窗口动画。 |
| `fetch_latest_notification`、`open_app_by_aumid` | `notification_commands.rs` | Windows Toast 轮询、通知应用唤起。 |
| `get_app_snapshot`、`update_settings`、`set_island_visible` | `settings_commands.rs` | 简化设置快照/事件广播与统一显隐。 |

`media_timeline.rs` 是 `media_session_commands.rs` 的私有辅助模块，负责 Windows 时间单位换算、范围校验和跳转位置裁剪；不要在前端重复实现 Windows ticks 换算。

## IPC 约定

- 前端调用 Rust 命令时，优先从 `src/shared/ipc/commands.ts` 使用已封装的接口；新增命令要同步添加 TypeScript 契约、封装、测试与 Rust 注册。
- 事件名称集中于 `events.ts`，保持 kebab-case；统一状态事件为 `app.settings.updated`、`app.snapshot.updated`、`app.island.visibility`、`island.display.changed`。
- 跨窗口 Payload 集中于 `contracts.ts`，接口名使用 PascalCase，并避免在组件内散落重复类型。
- `MusicPlaybackState` 的 `durationMs`、`positionMs`、`timelineUpdatedAtMs`、`snapshotTakenAtMs` 与 `canSeek` 是一组时间线契约，任何一侧改名或更改单位都必须同步更新 Rust、IPC、时间线逻辑与测试。

## 编码与实现规范

1. 所有文本文件使用 **UTF-8 without BOM**；禁止 UTF-16、GBK 与 `\uXXXX` 形式的中文转义。
2. 代码注释、提交信息和 PR 描述使用中文。新增注释只解释必要的意图、边界或安全性。
3. 只使用 `pnpm` 管理 JavaScript 依赖和执行脚本；不得创建或修改 `package-lock.json`、`yarn.lock`。
4. Vue 使用 Composition API 和 `<script setup lang="ts">`；Props 使用 `defineProps`，事件使用 `defineEmits`。
5. 异步 UI 操作必须处理组件卸载、目标切换和旧请求回写问题。参考音乐模块中的 generation、`isCurrent`、`onScopeDispose` 与事件监听器注册表。
6. 业务判断优先放在 `modules/` 的可测试纯函数；复杂状态放进 composable；展示组件只负责渲染和用户交互。
7. Rust Tauri 命令使用 `#[tauri::command]`；共享状态通过 `State<T>` 或明确的同步原语管理。耗时任务不能阻塞 UI 线程。
8. 新增或修改定时器、`listen` 监听器、异步轮询时，必须有明确的取消/清理路径。
9. 组件和 composable 应按职责拆分。现存的大型 `IslandView.vue` 是编排边界，不应继续承载新的状态机。
10. 如需提交，提交信息使用中文，并在末尾添加 `Co-Authored-By: Claude <noreply@anthropic.com>`。

## 测试与验证

### 现有覆盖重点

- `modules/island`：布局优先级、歌词匹配、音乐活动与播放时间线；
- `composables`：音乐目标切换、会话运行时、频谱、时间线、歌词、封面和窗口控制；
- `shared`：IPC 命令、localStorage、事件监听器释放；
- `components`：岛内容分发、卫星岛、状态指示、音乐内容、歌词面板、进度跳转与设置面板；
- Rust：`media_timeline.rs` 内联测试，以及 `lyrics` 下的缓存、匹配、解析、HTTP、服务和回归测试模块。

新增业务逻辑必须添加相邻测试，尤其覆盖：异步旧结果不覆盖新状态、定时器/监听器清理、时间单位边界、错误与降级路径。

### 常用命令

```powershell
# 安装依赖
pnpm install

# 前端开发、构建、类型检查与质量检查
pnpm run dev
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run lint:fix
pnpm run format:check
pnpm run format

# 前端测试
pnpm run test
pnpm run test:watch
pnpm run test:coverage

# Tauri 开发与发布
pnpm run tauri dev
pnpm run tauri build

# Rust 检查
Push-Location src-tauri
cargo build
cargo test
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
Pop-Location
```

## 已知约束与后续工作

1. 应用仅面向 Windows；通知、SMTC、频谱、电源事件和窗口样式均依赖 Windows API。
2. 主窗口关闭仅隐藏到托盘；Widget 关闭也仅隐藏。
3. 通知轮询会过滤微信内容；首次轮询只建立基线，不弹出历史通知。
4. 目前硬件命令只提供 CPU 与内存数据；不要将 GPU 细项视为已实现能力。
5. Rust 设置快照/更新仍是过渡实现，设置持久化迁移到 Rust 存储尚未完成。
6. `agent` 类型仅是多岛布局占位。`docs/2026-07-16-codex-status-island-design.md` 已定义 Codex 实时状态岛的协议、边界和实施顺序，但尚未有 `src/modules/codex`、后端接收器或界面实现。
7. 未来计划还包括更细的 GPU、磁盘 I/O、进程网络监控，以及天气、日程、倒计时等岛模块。

## 审查清单

1. 新状态是否明确了主窗口、Widget 与 Rust 三侧的所有权和同步方式？
2. 新增音乐/歌词改动是否保持目标切换、时间线和请求代际隔离？
3. 新增布局内容是否更新了 `resolveIslandLayout()`、尺寸、卫星岛与相邻测试？
4. 定时器、Tauri 事件监听器与异步任务是否会在卸载、停止或切换后清理？
5. Win32 `unsafe` 块是否有中文安全说明，并保证指针/缓冲区生命周期正确？
6. 代码、文档和测试文件是否为 UTF-8 without BOM，且没有引入无关重构？
