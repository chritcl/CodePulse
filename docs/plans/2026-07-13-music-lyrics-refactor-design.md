# 音乐歌词与播放进度重构设计

## 背景

当前音乐链路把 SMTC 快照轮询、本地播放进度推算、歌词请求、歌词匹配、封面加载和组件生命周期集中在 `IslandView.vue`。现有实现还同时保留 `estimatePlaybackPosition()` 与 `createLyricTimelineClock()` 两套时间算法，生产代码使用的时钟没有消费后端返回的采样时间。

已确认的问题包括暂停恢复前跳、粗粒度快照造成歌词回退、歌词错误永久去重、播放器切换时旧快照回写、网络故障误报为未找到、元数据渐进补全触发重复请求，以及监听器卸载不完整。

## 目标

1. 建立唯一、可测试的播放时间线，正确处理播放、暂停、恢复、跳播、粗粒度 SMTC 快照和陈旧状态。
2. 重建歌词获取服务，准确区分命中、未找到和临时故障，支持有限重试与可靠缓存。
3. 将音乐会话、播放时钟和歌词状态从 `IslandView.vue` 中拆出，消除异步串曲和定时器泄漏。
4. 保持现有灵动岛 UI、播放器选择和一秒 SMTC 校准行为，不引入 Windows 事件订阅。

## 非目标

- 本轮不增加歌词翻译展示。
- 本轮不接入逐字歌词或卡拉 OK 时间轴。
- 本轮不读取 QQ 音乐或网易云的私有播放进度接口。
- 本轮不修改灵动岛的视觉布局和交互方式。

## 总体架构

Rust 侧以单例 `LyricsService` 作为歌词用例入口。服务持有复用的 `reqwest::Client`、歌词源集合、全局查询期限和缓存目录。Tauri 命令只完成 IPC 参数适配，缓存、网络、匹配和错误决策均位于歌词模块中。

前端拆成四个职责明确的组合式函数：

- `useMusicPlaybackSession`：负责目标播放器、SMTC 快照串行轮询、播放控制、请求代际和陈旧状态。
- `usePlaybackTimeline`：负责唯一播放时钟，内部使用纯逻辑 `createPlaybackTimelineClock`，持续推进使用 `performance.now()`。
- `useTrackLyrics`：负责曲目会话身份、歌词请求、内存缓存、负缓存、有限退避、旧响应隔离和歌词匹配。
- `useTrackCover`：负责封面请求代际、曲目身份校验和有限容量内存缓存，旧请求不得覆盖新曲目。

`IslandView.vue` 只组合这些状态、保留岛屿布局调度，并把展示数据交给 `IslandDisplayController`。

播放器目标写入和媒体控制通过 `musicTargetCoordinator` 串行化，`musicPlaybackRuntime` 负责单一目标下的快照串行轮询、陈旧看门狗和时间线同步；歌词与封面仍由 `IslandView.vue` 分别组合对应控制器。模块启停与启动状态解析集中在音乐活动纯逻辑中，避免设置同步、轮换模式和挂载恢复互相覆盖。

## 播放时间线契约

SMTC 的 `Position` 是时间线锚点，不保证每次读取都持续递增。Rust 必须同时读取 `GlobalSystemMediaTransportControlsSessionTimelineProperties.LastUpdatedTime`，并返回：

- `positionMs`：播放器报告的锚点位置。
- `timelineUpdatedAtMs`：该锚点对应的 Unix 毫秒时间；播放器不提供时为空。
- `snapshotTakenAtMs`：Rust 完成快照读取时的 Unix 毫秒时间，只用于新鲜度和降级处理。
- `durationMs` 与 `isPlaying`。

前端收到快照后，先用 `timelineUpdatedAtMs` 把位置推进到接收时刻，再在本地单调时钟上建立锚点。播放状态变化必须重新锚定。正常快照的纠偏依据是“系统报告位置与本地预测位置的残差”，不再比较相邻系统位置。缺少 `timelineUpdatedAtMs` 时，重复的静止位置不会把正在推进的本地时钟拉回；只有位置显著变化才判定跳播。

连续同步失败时允许短时间沿用本地时钟。超过三秒没有成功快照后进入 `stale`，冻结进度。播放器恢复后使用新快照重建锚点。

## 曲目身份与歌词状态

播放会话身份使用播放器、来源应用、标题和歌手，不包含专辑与时长。专辑和容差化时长只参与后端歌词查询键及候选匹配。因此同一播放会话中专辑或时长稍后补全不会重置进度或清空已加载歌词。

歌词服务对外维持 `ready | not_found | error` 三种稳定 IPC 状态，并增加结构化错误码与 `retryable`。前端内部使用更细的 `idle | loading | ready | not_found | retrying | error` 状态，但展示组件仍接收兼容的文案状态。

- 所有歌词源都正常响应且均未命中，结果才是 `not_found`。
- 任一歌词源命中时返回 `ready`，即使其他源故障。
- 没有命中且至少一个歌词源故障时返回可重试 `error`。
- `not_found` 使用五分钟内存负缓存；可重试错误按一秒、三秒两次退避，之后进入 `error`。

切歌、切换播放器、关闭音乐模块或卸载组件都会递增 generation。播放快照、歌词和封面结果写入前必须校验 generation 或曲目身份。

## 后端歌词服务

`LyricsService` 通过可注入的 `LyricsProvider` trait 编排 QQ 音乐与网易云。生产 provider 共享同一个 HTTP Client；测试使用内存 fake provider，不访问真实网络。整个歌词查询使用八秒总期限，每个 HTTP 请求使用三秒期限，所有响应执行状态码检查和 512 KiB 大小限制。

候选匹配改用保留字符顺序和重复次数的相似度算法。请求与候选都提供歌手时，低歌手相似度不能再仅凭标题和时长通过。不同 provider 的命中结果统一比较置信度后选择最佳结果。

缓存升级 schema，保存规范化曲目身份、创建时间、解析器版本、provider 和歌词行。时长按五秒分桶，缓存读取时校验身份和三十天 TTL。写入先生成同目录临时文件，再替换正式文件；损坏、过期或身份不符的缓存均视为未命中并可重新获取。

LRC 解析器严格校验分钟、秒和小数格式，使用检查算术，支持标准 `[offset:+/-N]`，翻译时间允许 100ms 偏差。解析结果限制行数及单行长度，任意 UTF-8 输入不得 panic。

## 生命周期与性能

音乐快照使用递归 `setTimeout`：本次请求完成后才安排下一次，避免异步请求重叠。播放位置的本地刷新由 `usePlaybackTimeline` 单独管理，启动与停止均可重复调用。所有 Tauri `listen()` 返回值加入统一清理列表，异步挂载流程以 disposed 标志阻止卸载后继续注册定时器。

歌词行在进入前端时一次性过滤、排序和去重，当前歌词通过二分查找选择，不再每 250ms 重新过滤并线性扫描完整列表。

## 测试策略

实施遵循 RED-GREEN-REFACTOR：每项生产行为先写失败测试并确认失败原因，再写最小实现。

Rust 测试覆盖时间锚点转换、Serde 契约、严格 LRC 解析、错误歌手拒绝、缓存身份与 TTL、provider 全部未命中、部分失败后命中、全部失败和全局超时。网络编排测试不连接真实服务。

前端测试使用 Vitest 假时钟和可控 Promise，覆盖采样延迟、静止锚点、暂停恢复、前后跳播、陈旧冻结、歌词退避、负缓存、逆序响应、播放器切换、卸载清理和 IPC 参数形状。

最终验证包括 `pnpm test`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run build`、`cargo test --lib`、`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`，以及文本文件 UTF-8 without BOM 检查。

## 实施结果

本次重构已于 2026-07-13 完成。除设计中的四个音乐控制器外，集成阶段还补充了统一事件监听注册表、音乐活动判定和音频频谱请求代际，分别解决卸载后迟到监听、启动状态竞态和频谱旧响应回写。歌词展示拆入 `MusicLyricsPanel.vue`，音乐设置面板样式独立为 CSS 文件，新增组件与组合式函数均满足项目规模限制。

最终前端验证为 22 个测试文件、186 个测试全部通过，类型检查、Lint 和生产构建均成功；新增前端文件没有 ESLint 告警。Rust 验证为 58 个库测试全部通过，完整测试、Clippy、构建和本分支变更文件的 Rustfmt 检查均成功。全仓 `cargo fmt --check` 仍只报告未修改的 `src-tauri/build.rs` 与 `src-tauri/src/main.rs` 既有换行风格问题，因此未扩大范围改写基线文件。全仓 Lint 从主分支基线的 11538 条告警降为 5386 条，本次发现的新增告警已清零。
