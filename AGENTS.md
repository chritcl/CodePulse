# AGENTS.md — NetSpeed Dynamic Pro 项目指南

## 项目概况

**NetSpeed Dynamic Pro (NSD)** — 基于 Tauri 2 + Vue 3 + Rust 的 Windows 桌面灵动岛组件。实时显示网速、支持多平台音乐控制、系统通知接收、硬件监控，支持置于任务栏及智能轮换模式。

- **版本**: 2.3.8
- **标识**: `com.ryen.nsd`
- **仓库**: https://github.com/GEORGEWWWU/NetSpeed-Dynamic
- **协议**: MIT

---

## 项目结构

```
CodePulse/
├── src/                            # 前端 (Vue 3 + TypeScript)
│   ├── App.vue                     # 根组件，仅 <router-view />
│   ├── main.ts                     # 应用入口 (Pinia + Router)
│   ├── router/index.ts             # 路由: / → 控制台, /widget → 灵动岛
│   ├── styles/theme.css            # 全局 CSS 变量 (亮/暗色主题)
│   ├── types/index.ts              # 共享 TypeScript 类型定义
│   │
│   ├── shared/                     # 跨模块共享
│   │   ├── ipc/                    # IPC 通信层
│   │   │   ├── contracts.ts        # 所有 Payload 类型定义
│   │   │   ├── events.ts           # 事件名称常量 (kebab-case)
│   │   │   ├── commands.ts         # Tauri invoke 命令封装
│   │   │   └── index.ts            # 统一导出
│   │   └── utils/
│   │       ├── storage.ts          # localStorage 类型安全读写
│   │       └── storage.test.ts     # 存储工具测试
│   │
│   ├── stores/                     # Pinia 状态管理
│   │   ├── settings.ts             # 应用设置 (主题/透明度/模块开关)
│   │   ├── network.ts              # 网速监控与流量统计
│   │   ├── island.ts               # 灵动岛显示状态与控制
│   │   ├── island.test.ts          # 灵动岛 Store 测试
│   │   └── index.ts                # 统一导出
│   │
│   ├── composables/                # Vue 组合式函数
│   │   ├── useTheme.ts             # 主题切换 (亮/暗/跟随系统)
│   │   ├── useUpdateChecker.ts     # GitHub Release 更新检查
│   │   ├── useDialog.ts            # 对话框管理
│   │   ├── useAutoStart.ts         # 开机自启动
│   │   ├── useIslandWindow.ts      # 灵动岛窗口尺寸/位置/透明度
│   │   ├── useIslandAnimation.ts   # 入场/出场/内容切换动画
│   │   ├── useIslandDrag.ts        # 拖拽与位置锁定
│   │   ├── useMusicSpectrum.ts     # 音乐频谱轮询 + 保底脉冲
│   │   └── index.ts                # 统一导出
│   │
│   ├── modules/                    # 纯业务逻辑
│   │   └── island/
│   │       ├── display.ts          # 灵动岛多岛布局调度引擎
│   │       ├── display.test.ts     # 展示优先级测试
│   │       ├── lyrics.ts           # 歌词解析 (播放位置推算、当前歌词匹配)
│   │       ├── lyrics.test.ts      # 歌词解析测试
│   │       ├── musicPlatform.ts    # 音乐平台归一化与显示名称
│   │       └── musicPlatform.test.ts # 音乐平台测试
│   │
│   ├── components/
│   │   ├── dashboard/              # 主控制台组件
│   │   │   ├── DashboardView.vue   # 控制台主视图
│   │   │   ├── DashboardHeader.vue # 头部 (品牌/开关/设置按钮)
│   │   │   ├── RealtimeNetworkCard.vue    # 实时网速 + 折线图
│   │   │   ├── TrafficStatisticsCard.vue  # 流量统计 + 柱状图
│   │   │   ├── GeneralSettingsCard.vue    # 常规设置 (主题/自启动/透明度)
│   │   │   ├── IslandSettingsPanel.vue    # 灵动岛设置 (音乐平台/模块开关)
│   │   │   ├── UpdateChecker.vue          # 更新检查按钮
│   │   │   └── AppDialog.vue              # 模态对话框
│   │   │
│   │   └── island/                 # 灵动岛组件
│   │       ├── IslandView.vue             # 灵动岛主视图 (~1230 行, 核心调度)
│   │       ├── IslandShell.vue            # 灵动岛外壳 (布局、流光边框、展开面板)
│   │       ├── IslandDisplayController.vue # 内容分发控制器
│   │       ├── IslandSatelliteStrip.vue   # 卫星岛条 (附属模块图标)
│   │       ├── IslandStatusIndicator.vue  # 状态指示器 (频谱/网络灯)
│   │       ├── IslandContextMenu.ts       # 右键菜单 (Tauri native Menu)
│   │       ├── SpeedContent.vue           # 网速展示
│   │       ├── MusicContent.vue           # 音乐控制 (封面/歌名/歌词/播放控制)
│   │       ├── HardwareContent.vue        # 硬件监控 (CPU/GPU/RAM)
│   │       ├── NotificationContent.vue    # 通知展示
│   │       ├── SystemToastContent.vue     # 系统提示 (音量/电量/锁屏)
│   │       └── *.test.ts (3 个测试文件)
│   │
│   └── assets/                     # 静态资源 (图标/SVG)
│
├── src-tauri/                      # Rust 后端
│   ├── Cargo.toml                  # Rust 依赖
│   ├── tauri.conf.json             # Tauri 配置 (双窗口)
│   ├── capabilities/default.json   # Tauri 权限声明
│   ├── clippy.toml                 # Clippy 配置
│   ├── .rustfmt.toml               # Rust 格式配置
│   ├── build.rs                    # Tauri 构建脚本
│   └── src/
│       ├── main.rs                 # Rust 入口
│       ├── lib.rs                  # 应用初始化/插件注册/托盘/窗口事件
│       ├── error.rs                # 统一错误类型 AppError
│       ├── app/
│       │   ├── state.rs            # 全局 AppState (Networks + System)
│       │   └── mod.rs
│       ├── commands/
│       │   ├── mod.rs              # 命令模块聚合导出
│       │   ├── media_commands.rs   # 媒体控制 (SMTC/封面/播放)
│       │   ├── system_commands.rs  # 系统监控 (网速/硬件/延迟)
│       │   ├── window_commands.rs  # 窗口管理 (置顶/边界/动画)
│       │   ├── notification_commands.rs # 通知读取/应用打开
│       │   ├── settings_commands.rs     # 设置快照/更新/显隐
│       │   ├── audio_spectrum_commands.rs # 音频频谱采集 (WASAPI loopback + FFT)
│       │   ├── lyrics_commands.rs  # 歌词获取 (缓存 + 在线)
│       │   └── system_event_commands.rs # 系统事件 (音量/电源/电量)
│       └── lyrics/
│           ├── mod.rs              # 歌词模块入口
│           ├── types.rs            # 歌词类型定义
│           ├── cache.rs            # 歌词文件缓存
│           ├── matcher.rs          # 曲目身份构建
│           ├── parser.rs           # LRC 歌词解析
│           └── providers.rs        # 在线歌词源
│
├── package.json                    # 前端依赖与脚本
├── vite.config.ts                  # Vite 配置
├── vitest.config.ts                # Vitest 测试配置
├── tsconfig.json                   # TypeScript 配置
└── index.html                      # Vite 入口 HTML
```

### 路由结构

| 路径 | 组件 | 窗口 | 用途 |
|------|------|------|------|
| `/` | `DashboardView.vue` | main (700×550) | 主控制台 |
| `/widget` | `IslandView.vue` | widget (210×36) | 灵动岛悬浮窗 |

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Tauri | 2.x |
| 前端框架 | Vue 3 (Composition API) | 3.5 |
| 构建工具 | Vite | 6.x |
| 路由 | Vue Router | 5.x |
| 状态管理 | Pinia | 3.x |
| 图表 | ECharts | 6.x |
| 系统监控 | sysinfo (Rust) | 0.30 |
| 音频采集 | WASAPI loopback + rustfft (Rust) | windows 0.58 / 6.2 |
| 异步运行时 | Tokio (Rust) | 1.x |
| HTTP 客户端 | reqwest (Rust) | 0.12 |
| 媒体控制 | Windows SMTC API | windows 0.58 |
| 测试 | Vitest + @vue/test-utils | 4.x / 2.x |
| 包管理 | pnpm | 10.x |

---

## 架构要点

### 双窗口架构

```
主窗口 (main, /)               灵动岛窗口 (widget, /widget)
├── 控制台 UI                   ├── 悬浮灵动岛 (透明/无边框/置顶)
├── 设置管理                    ├── 内容展示 (网速/音乐/硬件/通知)
├── 流量统计图表 (ECharts)      ├── 右键菜单
└── 更新检查                    └── 拖拽/弹簧动画
```

两个窗口通过 Tauri 事件系统双向通信，不共享 Vue 状态。

### 灵动岛多岛布局引擎

由 `src/modules/island/display.ts` 的 `resolveIslandLayout()` 调度，支持多模块优先级决策：

**支持的模块类型** (IslandDisplayKind):
- `network` — 网速监控 (默认兜底)
- `music` — 音乐控制 (含歌词显示)
- `hardware` — 硬件监控
- `notification` — 消息通知
- `system-toast` — 系统提示 (音量/电量/锁屏)
- `agent` — AI Agent (待接入)
- `wechat` — 微信消息 (待接入)
- `update` — 版本更新 (待接入)

**布局决策优先级** (从高到低):
1. **强打断** — 硬件超过 90% 阈值 (连续 2 次采样)
2. **手动聚焦** — 用户点击卫星岛
3. **软打断** — 新通知 / 系统提示
4. **轮换模式** — 自动轮换 network / music / hardware
5. **稳定主模块** — 上次展示的模块
6. **优先级排序** — 按预定义优先级

**卫星岛**: 最多显示 3 个附属模块图标，超出显示 "+N"。

### IPC 通信模式

- **前端 → Rust**: `invoke('command_name', { params })`，封装在 `src/shared/ipc/commands.ts`
- **Rust → 前端**: `app.emit('event-name', payload)`，事件常量在 `src/shared/ipc/events.ts`
- **主窗口 ↔ 灵动岛**: Tauri 事件双向通信，Payload 类型在 `src/shared/ipc/contracts.ts`

### 动画系统

- **入场**: 弹簧衰减方程 `1 - cos(2πft) * e^(-dt)`，Rust 线程驱动窗口大小变化 (400ms)
- **出场**: 三次方缩放衰减 + 透明度淡出 (300ms)
- **内容切换**: 简单淡入淡出 (180ms/140ms)
- **动画中断**: 原子计数器 `ANIMATION_ID` 实现新动画打断旧动画

---

## 前端 Stores

### `useSettingsStore` (settings.ts)

管理所有应用设置：主题模式、灵动岛主题、透明度、任务栏停靠、自启动、音乐平台、各模块开关 (音乐控制/消息通知/硬件监控/消息模式/轮换模式)。所有设置通过 `watch` 自动持久化到 localStorage。

### `useNetworkStore` (network.ts)

管理网速监控和流量统计：实时上传/下载速度、图表数据队列 (15 个点)、每日流量记录、本月流量汇总。使用节流保存策略 (每 5 次采样保存一次)。

### `useIslandStore` (island.ts)

管理灵动岛显示状态：可见性、设置面板开关。监听 Rust 侧状态同步事件，处理初始状态恢复和补发显示命令。

---

## Composables

| Composable | 职责 |
|---|---|
| `useTheme` | 主题切换，监听系统 `prefers-color-scheme` 变化 |
| `useUpdateChecker` | GitHub Release 静默/手动更新检查 (10 秒超时) |
| `useDialog` | 模态对话框状态管理 (确认/提示) |
| `useAutoStart` | 开机自启动开关 (`tauri-plugin-autostart`) |
| `useIslandWindow` | 灵动岛窗口尺寸/位置/透明度/主题/停靠/锁定 |
| `useIslandAnimation` | 入场/出场/内容切换动画 (requestAnimationFrame) |
| `useIslandDrag` | 拖拽判定与位置锁定 (5px 阈值) |
| `useMusicSpectrum` | 音乐频谱轮询 + 保底脉冲动画 |

---

## Rust 后端命令清单

| 命令 | 文件 | 功能 |
|---|---|---|
| `set_target_player` | media_commands.rs | 设置目标音乐平台 |
| `fetch_netease_music_info` | media_commands.rs | 获取当前播放歌曲信息 |
| `get_music_playback_state` | media_commands.rs | 获取完整音乐播放状态 (SMTC) |
| `control_system_media` | media_commands.rs | 媒体播放控制 (播放/暂停/上下首) |
| `get_random_cover_url` | media_commands.rs | 获取歌曲封面 (本地 SMTC + 多源竞速) |
| `get_lyrics_for_track` | lyrics_commands.rs | 获取歌词 (缓存 + 在线) |
| `get_audio_spectrum` | audio_spectrum_commands.rs | 获取 5 段音频频谱数据 |
| `get_network_stats` | system_commands.rs | 获取网络收发字节数 |
| `get_hardware_stats` | system_commands.rs | 获取 CPU/内存使用率 |
| `get_network_latency` | system_commands.rs | TCP 延迟测试 (223.5.5.5:53) |
| `is_widget_visible` | window_commands.rs | 检查灵动岛窗口是否可见 |
| `force_window_topmost` | window_commands.rs | 强制窗口置顶 (智能全屏检测) |
| `set_window_bounds` | window_commands.rs | 原子化设置窗口位置和大小 |
| `start_island_animation` | window_commands.rs | 弹簧物理动画驱动窗口变化 |
| `fetch_latest_notification` | notification_commands.rs | 轮询 Windows 通知系统 |
| `open_app_by_aumid` | notification_commands.rs | 通过 AUMID 或协议打开应用 |
| `get_app_snapshot` | settings_commands.rs | 获取应用完整状态快照 |
| `update_settings` | settings_commands.rs | 更新应用设置并广播事件 |
| `set_island_visible` | settings_commands.rs | 统一的灵动岛显隐控制 |

---

## 代码规范

### 通用规则

1. **编码**: 所有文本文件必须 UTF-8 without BOM，中文直接输出，禁止 `\uXXXX` 转义。
2. **语言**: 代码注释、commit message、PR 描述均使用中文。
3. **风格**: 优先遵循项目已有代码风格，不做无关重构。
4. **平台**: 仅支持 Windows，可大胆使用 Win32 API，不需要跨平台兼容。
5. **提交**: commit message 结尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`。

### TypeScript / Vue 前端

- Vue 3 Composition API (`<script setup lang="ts">`)。
- 响应式数据使用 `ref` / `computed` / `watch`。
- Props 通过 `defineProps` 声明，事件通过 `defineEmits` 声明。
- 窗口间通信使用 Tauri 事件系统 (`emit` / `listen`)。
- Tauri 命令调用使用 `@tauri-apps/api` 的 `invoke`。
- CSS 直接写在 Vue SFC 的 `<style scoped>` 中，主题色通过 CSS 变量引用。
- 组件文件不超过 300 行，单个 composable 不超过 200 行。

### Rust 后端

- Tauri 命令使用 `#[tauri::command]` 标注。
- 全局状态使用 `static` + `Mutex` / `AtomicU32` / `AtomicBool`。
- Tauri 管理状态通过 `State<T>` 注入。
- 异步任务使用 `tokio::spawn` 或 `std::thread::spawn`。
- Win32 API 调用封装在 `unsafe` 块中，添加注释说明安全性。
- 模块文件不超过 300 行，每个函数不超过 50 行。

### 命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| Vue 组件 | PascalCase | `IslandShell.vue` |
| Composable | camelCase, `use` 前缀 | `useIslandDrag.ts` |
| Store | camelCase, `use` + `Store` 后缀 | `useSettingsStore` |
| IPC 事件 | kebab-case | `control-island-visibility` |
| IPC Payload 类型 | PascalCase + `Payload` 后缀 | `IslandOpacityPayload` |
| Rust 命令 | snake_case | `get_network_stats` |
| CSS 变量 | kebab-case | `--card-bg` |

---

## 测试

### 前端测试

- **框架**: Vitest + @vue/test-utils
- **环境**: jsdom
- **运行**: `pnpm test` (单次) / `pnpm test:watch` (监听) / `pnpm test:coverage` (覆盖率)

### 现有测试文件

| 测试文件 | 覆盖内容 |
|---|---|
| `src/modules/island/display.test.ts` | 灵动岛多岛布局调度引擎 |
| `src/modules/island/lyrics.test.ts` | 歌词解析 (播放位置推算、当前歌词匹配) |
| `src/modules/island/musicPlatform.test.ts` | 音乐平台归一化 |
| `src/shared/utils/storage.test.ts` | localStorage 类型安全读写 |
| `src/stores/island.test.ts` | 灵动岛 Store 状态管理 |
| `src/composables/useIslandWindow.test.ts` | 灵动岛窗口管理 |
| `src/composables/useMusicSpectrum.test.ts` | 音乐频谱轮询 |
| `src/components/island/IslandStatusIndicator.test.ts` | 频谱/状态灯渲染 |
| `src/components/island/IslandDisplayController.test.ts` | 内容分发控制器 |
| `src/components/island/IslandSatelliteStrip.test.ts` | 卫星岛条 |
| `src/components/island/MusicContent.test.ts` | 音乐内容渲染 |

---

## 常用命令

```powershell
# 安装依赖
pnpm install

# 开发模式 (前端 + Rust 热重载)
pnpm tauri dev

# 仅前端构建检查
pnpm build

# 类型检查
pnpm typecheck

# Lint 检查
pnpm lint

# Lint 自动修复
pnpm lint:fix

# 格式化
pnpm format

# 前端测试
pnpm test

# Rust 构建
cd src-tauri; cargo build

# Rust 测试
cd src-tauri; cargo test

# Rust 格式检查
cd src-tauri; cargo fmt --check

# Rust Clippy 检查
cd src-tauri; cargo clippy --all-targets --all-features -- -D warnings
```

### 构建发布

```powershell
pnpm tauri build
```

产物位于 `src-tauri/target/release/bundle/`。

---

## 已知架构约束

1. **平台限制**: 仅支持 Windows，Rust 后端大量使用 `windows` crate 的 Win32 API。
2. **单实例**: 通过 `tauri-plugin-single-instance` 确保只运行一个实例。
3. **主窗口关闭行为**: 关闭主窗口时隐藏到托盘而非退出，通过系统托盘图标恢复。
4. **设置存储**: 当前使用 localStorage，Rust 侧 `settings_commands.rs` 的快照/更新为简化实现。
5. **音乐封面获取**: 多源竞速策略 (本地 SMTC → Apple Music → 网易云 → Deezer)，3 秒超时。
6. **音频频谱**: 使用 WASAPI loopback 采集系统默认输出设备，通过 FFT 转换为 5 段频谱 (20-150Hz / 150-500Hz / 500-2kHz / 2k-6kHz / 6k-20kHz)。
7. **歌词系统**: LRC 格式解析 + 文件缓存 + 在线获取，250ms 精度播放位置推算。
8. **通知过滤**: 自动过滤微信通知，通过 AUMID 识别。
9. **互斥模块**: 音乐控制器与硬件监控互斥，开启一方自动关闭另一方。
10. **系统事件**: 音量变化通过 WASAPI 音频端点 800ms 轮询，电源事件通过 Win32 Power API 监控。

---

## 审查要点

代码审查时重点关注：

1. **状态管理**: 新增状态是否考虑了窗口间同步的需求。
2. **Win32 安全性**: `unsafe` 块是否有充分注释和错误处理。
3. **内存泄漏**: 定时器、事件监听器、Tauri event listener 是否在组件卸载时清理。
4. **性能**: 灵动岛动画期间，前端是否有不必要的重渲染。
5. **编码问题**: 文件是否为 UTF-8 without BOM。
6. **测试覆盖**: 新增业务逻辑是否有对应测试。

---

## 未来功能规划

- **AI Agent 监控面板**: 监控 AI agent 运行状态，实时显示输出流。
- **更多监控维度**: GPU 详细监控、磁盘 I/O、进程级网络流量。
- **灵动岛功能扩展**: 天气、日程、倒计时等更多岛模式。
- **存储迁移**: 设置迁移到 Rust 存储，流量统计预留 SQLite。
