# 音乐歌词与播放进度重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重建基于 Windows SMTC 的播放时间线与多源歌词链路，消除暂停恢复、跳播纠偏、错误分类、请求竞态和生命周期问题。

**Architecture:** Rust 通过单例 `LyricsService` 管理 provider、总期限和缓存，SMTC 快照同时返回播放器锚点更新时间与读取时间。前端通过 `useMusicPlaybackSession`、`usePlaybackTimeline`、`useTrackLyrics` 分离播放器会话、单调时钟与歌词状态，`IslandView.vue` 只负责组合与展示。

**Tech Stack:** Tauri 2、Rust 2021、Windows SMTC、reqwest 0.12、Vue 3 Composition API、TypeScript 5.6、Vitest 4、pnpm 10。

## Global Constraints

- 所有代码注释必须使用中文（请勿进行转码），禁止使用英文注释。
- 所有文本文件必须使用 UTF-8 without BOM，中文必须直接输出，禁止 Unicode 转义格式。
- 项目统一使用 `pnpm`，禁止使用 `npm`、`npx`、`yarn`，不得创建或修改 `package-lock.json`、`yarn.lock`。
- Vue 组件文件不超过 300 行，单个 composable 不超过 200 行；Rust 模块文件不超过 300 行，每个函数不超过 50 行。
- 用户批准本次范围豁免：所有新建或拆出的音乐组件必须不超过 300 行，所有新 composable 必须不超过 200 行；`IslandView.vue` 必须移除音乐业务，但其中遗留的非音乐代码本次允许继续超过 300 行。
- 仅支持 Windows，可以直接使用 Windows SMTC 与 Win32 API。
- 保持现有灵动岛 UI、播放器选择和一秒 SMTC 校准；不增加翻译展示，不改为 Windows 事件订阅。
- 每个生产行为必须先写失败测试并确认因预期缺失而失败，再写最小实现。
- commit message 使用中文并以 `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾。

---

### Task 1: 锁定 SMTC 时间锚点与 IPC 契约

**Files:**
- Modify: `src-tauri/src/commands/media_commands.rs`
- Modify: `src/shared/ipc/contracts.ts`
- Modify: `src/shared/ipc/commands.ts`
- Modify: `src/shared/ipc/index.ts`
- Create: `src/shared/ipc/commands.test.ts`

**Interfaces:**
- Produces: `MusicPlaybackState.timelineUpdatedAtMs?: number`
- Produces: `MusicPlaybackState.snapshotTakenAtMs: number`
- Produces: `mediaCommands.getMusicPlaybackState()`、`setTargetPlayer()`、`controlSystemMedia()`、`getRandomCoverUrl()` 作为唯一前端媒体 IPC 边界

- [x] **Step 1: 写入失败的 Rust 时间锚点测试**

```rust
#[test]
fn converts_windows_datetime_to_unix_milliseconds() {
    let unix_epoch_windows_ticks = 116_444_736_000_000_000_i64;
    assert_eq!(datetime_ticks_to_unix_ms(unix_epoch_windows_ticks + 12_345_000), Some(1_234));
}

#[test]
fn timeline_snapshot_keeps_source_update_time() {
    let snapshot = build_timeline_snapshot(Some(500), Some(10_500), Some(2_500), Some(42_000));
    assert_eq!(snapshot.duration_ms, Some(10_000));
    assert_eq!(snapshot.position_ms, Some(2_000));
    assert_eq!(snapshot.timeline_updated_at_ms, Some(42_000));
}
```

- [x] **Step 2: 运行 Rust 定向测试并确认 RED**

Run: `cd src-tauri; cargo test timeline_tests --lib`

Expected: FAIL，原因是 `datetime_ticks_to_unix_ms` 或新的时间字段尚不存在。

- [x] **Step 3: 写入失败的 TypeScript IPC 契约测试**

```typescript
it('通过统一命令封装读取播放快照', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(null);
  await mediaCommands.getMusicPlaybackState();
  expect(invoke).toHaveBeenCalledWith('get_music_playback_state');
});

it('歌词请求保持 Rust 命令需要的扁平参数', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ status: 'not_found', lines: [] });
  await mediaCommands.getLyricsForTrack({ title: '晴天', artist: '周杰伦' });
  expect(invoke).toHaveBeenCalledWith('get_lyrics_for_track', {
    title: '晴天',
    artist: '周杰伦',
  });
});

it('通过统一命令封装读取歌曲封面', async () => {
  vi.mocked(invoke).mockResolvedValueOnce('data:image/png;base64,cover');
  await mediaCommands.getRandomCoverUrl('晴天', '周杰伦');
  expect(invoke).toHaveBeenCalledWith('get_random_cover_url', {
    songName: '晴天',
    artistName: '周杰伦',
  });
});
```

- [x] **Step 4: 运行 IPC 测试并确认 RED**

Run: `pnpm test -- src/shared/ipc/commands.test.ts`

Expected: FAIL，原因是公共类型导出和测试边界尚未补齐。

- [x] **Step 5: 实现 SMTC 锚点与公共契约**

```typescript
export interface MusicPlaybackState {
  title: string;
  artist: string;
  album?: string;
  sourceAppId: string;
  player: string;
  isPlaying: boolean;
  durationMs?: number;
  positionMs?: number;
  timelineUpdatedAtMs?: number;
  snapshotTakenAtMs: number;
}
```

Rust 从 `LastUpdatedTime()` 读取 Windows `DateTime.UniversalTime`，减去 Windows 与 Unix epoch 的 100ns tick 差；读取失败时返回 `None`。删除含糊的 `timelineSampledAtMs`，并为 `MusicPlaybackState` 增加 Serde JSON 字段测试。

同时把未被 Rust 实现的 `stop` 从 `MediaAction` 联合类型移除，避免控制命令静默成功。

- [x] **Step 6: 运行定向测试并确认 GREEN**

Run: `pnpm test -- src/shared/ipc/commands.test.ts && cd src-tauri && cargo test timeline_tests --lib`

Expected: PASS。

- [x] **Step 7: 提交契约变更**

```powershell
git add src/shared/ipc src-tauri/src/commands/media_commands.rs
git commit -m "refactor: 统一音乐播放时间锚点契约" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: 建立唯一播放时间线与歌词选择纯逻辑

**Files:**
- Create: `src/modules/island/playbackTimeline.ts`
- Create: `src/modules/island/playbackTimeline.test.ts`
- Create: `src/composables/usePlaybackTimeline.ts`
- Create: `src/composables/usePlaybackTimeline.test.ts`
- Modify: `src/modules/island/lyrics.ts`
- Modify: `src/modules/island/lyrics.test.ts`
- Modify: `src/composables/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `MusicPlaybackState`
- Produces: `createPlaybackTimelineClock(options?)`
- Produces: `usePlaybackTimeline()`，包含 `positionMs`、`sync()`、`reset()`、`markStale()`、`start()`、`stop()`
- Produces: `buildPlaybackSessionIdentity()`、`normalizeLyricLines()`、二分实现的 `resolveCurrentLyricLine()`

- [x] **Step 1: 写入播放时钟失败测试**

```typescript
const playback = (patch: Partial<MusicPlaybackState> = {}): MusicPlaybackState => ({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  sourceAppId: 'qqmusic',
  player: 'qqmusic',
  isPlaying: true,
  durationMs: 269_000,
  positionMs: 10_000,
  timelineUpdatedAtMs: 1_000,
  snapshotTakenAtMs: 1_000,
  ...patch,
});

it('补偿 SMTC 锚点到前端接收时刻的延迟', () => {
  const clock = createPlaybackTimelineClock();
  clock.sync(
    playback({ positionMs: 10_000, timelineUpdatedAtMs: 1_000, snapshotTakenAtMs: 1_250 }),
    { epochMs: 1_300, monotonicMs: 500 }
  );
  expect(clock.getPosition(1_500)).toBe(11_300);
});

it('暂停五秒后从相同位置恢复不会前跳', () => {
  const clock = createPlaybackTimelineClock();
  clock.sync(playback({ positionMs: 10_000, timelineUpdatedAtMs: 1_000 }), { epochMs: 1_000, monotonicMs: 100 });
  clock.sync(playback({ isPlaying: false, positionMs: 12_000, timelineUpdatedAtMs: 3_000 }), { epochMs: 3_000, monotonicMs: 2_100 });
  clock.sync(playback({ isPlaying: true, positionMs: 12_000, timelineUpdatedAtMs: 8_000 }), { epochMs: 8_000, monotonicMs: 7_100 });
  expect(clock.getPosition(7_100)).toBe(12_000);
});
```

同时增加静止锚点、前后跳播、缺失 `timelineUpdatedAtMs`、时长补全、陈旧冻结和系统墙钟跳变测试。

- [x] **Step 2: 运行时钟测试并确认 RED**

Run: `pnpm test -- src/modules/island/playbackTimeline.test.ts`

Expected: FAIL，原因是新时钟模块不存在。

- [x] **Step 3: 实现纯播放时钟**

```typescript
export interface PlaybackTimelineClock {
  sync(snapshot: MusicPlaybackState, receivedAt: TimelineReceivedAt): void;
  getPosition(monotonicMs: number): number | null;
  markStale(monotonicMs: number): void;
  reset(): void;
}

export const createPlaybackTimelineClock = (): PlaybackTimelineClock => {
  let anchorPositionMs: number | null = null;
  let anchorMonotonicMs = 0;
  let durationMs: number | undefined;
  let isPlaying = false;
  let lastSourcePositionMs: number | undefined;

  const clampPosition = (positionMs: number) =>
    durationMs === undefined
      ? Math.max(0, positionMs)
      : Math.min(Math.max(0, positionMs), durationMs);

  const getPosition = (monotonicMs: number) => {
    if (anchorPositionMs === null) return null;
    const elapsedMs = isPlaying ? Math.max(0, monotonicMs - anchorMonotonicMs) : 0;
    return clampPosition(anchorPositionMs + elapsedMs);
  };

  const sync = (snapshot: MusicPlaybackState, receivedAt: TimelineReceivedAt) => {
    durationMs = snapshot.durationMs;
    if (snapshot.positionMs === undefined) {
      const predicted = getPosition(receivedAt.monotonicMs);
      if (predicted !== null && isPlaying !== snapshot.isPlaying) {
        anchorPositionMs = predicted;
        anchorMonotonicMs = receivedAt.monotonicMs;
      }
      isPlaying = snapshot.isPlaying;
      return;
    }

    const repeatedFallback =
      snapshot.timelineUpdatedAtMs === undefined &&
      snapshot.isPlaying &&
      isPlaying &&
      lastSourcePositionMs === snapshot.positionMs;
    if (repeatedFallback) return;

    const sourceAtMs = snapshot.timelineUpdatedAtMs ?? snapshot.snapshotTakenAtMs;
    const sourceAgeMs = snapshot.isPlaying
      ? Math.max(0, receivedAt.epochMs - sourceAtMs)
      : 0;
    const reportedPositionMs = clampPosition(snapshot.positionMs + sourceAgeMs);
    const predictedPositionMs = getPosition(receivedAt.monotonicMs);
    const stateChanged = isPlaying !== snapshot.isPlaying;
    const residualMs =
      predictedPositionMs === null ? Number.POSITIVE_INFINITY : reportedPositionMs - predictedPositionMs;

    if (stateChanged || Math.abs(residualMs) >= 1_500 || predictedPositionMs === null) {
      anchorPositionMs = reportedPositionMs;
    } else {
      anchorPositionMs = clampPosition(predictedPositionMs + residualMs * 0.25);
    }
    anchorMonotonicMs = receivedAt.monotonicMs;
    isPlaying = snapshot.isPlaying;
    lastSourcePositionMs = snapshot.positionMs;
  };

  const markStale = (monotonicMs: number) => {
    anchorPositionMs = getPosition(monotonicMs);
    anchorMonotonicMs = monotonicMs;
    isPlaying = false;
  };

  const reset = () => {
    anchorPositionMs = null;
    anchorMonotonicMs = 0;
    durationMs = undefined;
    isPlaying = false;
    lastSourcePositionMs = undefined;
  };

  return { sync, getPosition, markStale, reset };
};
```

跳播阈值为 1,500ms；状态变化总是重新锚定；有 `timelineUpdatedAtMs` 时以源锚点计算报告位置，没有时对重复静止位置保持本地推进。

- [x] **Step 4: 写入歌词身份和二分匹配失败测试**

```typescript
const lyric = (index: number, startMs: number, endMs?: number): LyricLine => ({
  index,
  startMs,
  endMs,
  text: `第 ${index + 1} 句`,
});

it('专辑和时长补全不改变播放会话身份', () => {
  const initial = playback({ album: undefined, durationMs: undefined });
  const enriched = playback({ album: '叶惠美', durationMs: 269_000 });
  expect(buildPlaybackSessionIdentity(initial)).toBe(buildPlaybackSessionIdentity(enriched));
});

it('会排序歌词并在结束时间后清空当前句', () => {
  const lines = normalizeLyricLines([
    lyric(1, 5_000, 7_000),
    lyric(0, 1_000, 2_000),
  ]);
  expect(resolveCurrentLyricLine(lines, 3_000).currentLine).toBeNull();
});
```

- [x] **Step 5: 运行歌词纯逻辑测试并确认 RED**

Run: `pnpm test -- src/modules/island/lyrics.test.ts`

Expected: FAIL，原因是稳定会话身份、规范化和 `endMs` 语义尚未实现。

- [x] **Step 6: 实现歌词纯逻辑与响应式包装**

`usePlaybackTimeline` 每 100ms 刷新响应式位置，只调用纯时钟；`stop()` 必须清除 timer，`markStale()` 冻结当前位置。删除旧的 `estimatePlaybackPosition` 与 `createLyricTimelineClock`，避免第二套时间算法继续存在。

- [x] **Step 7: 运行 Task 2 测试并确认 GREEN**

Run: `pnpm test -- src/modules/island/playbackTimeline.test.ts src/composables/usePlaybackTimeline.test.ts src/modules/island/lyrics.test.ts`

Expected: PASS。

- [x] **Step 8: 提交播放时间线**

```powershell
git add src/modules/island src/composables
git commit -m "refactor: 重建音乐播放时间线" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: 强化歌词身份、匹配、解析和缓存

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lyrics/types.rs`
- Modify: `src-tauri/src/lyrics/matcher.rs`
- Modify: `src-tauri/src/lyrics/parser.rs`
- Modify: `src-tauri/src/lyrics/cache.rs`
- Modify: `src-tauri/src/lyrics/providers/netease.rs`
- Modify: `src-tauri/src/lyrics/providers/qq_music.rs`
- Modify: `src-tauri/src/lyrics/mod.rs`

**Interfaces:**
- Produces: `TrackIdentity { normalized_title, normalized_artist, normalized_album, duration_bucket_ms }`
- Produces: `build_track_identity()` 与 SHA-256 `build_track_key()`
- Produces: `parse_lrc() -> Result<Vec<LyricLine>, LyricsParseError>`
- Produces: `LyricsCacheRepository::read()`、`write()`

- [x] **Step 1: 写入匹配器失败测试**

```rust
#[test]
fn rejects_exact_title_and_duration_with_wrong_artist() {
    let candidate = LyricsCandidate {
        title: "晴天".into(),
        artist: "五月天".into(),
        album: None,
        duration_ms: Some(269_000),
        id: "wrong".into(),
    };
    assert!(!is_confident_match(&request(Some(269_000)), &candidate));
}

#[test]
fn preserves_character_order_in_title_similarity() {
    assert!(text_similarity("晴天", "天晴") < 0.8);
}
```

- [x] **Step 2: 写入解析器和缓存失败测试**

```rust
#[test]
fn applies_lrc_offset() {
    let lines = parse_lrc("[offset:+250]\n[00:01.00]第一句", None).unwrap();
    assert_eq!(lines[0].start_ms, Some(1_250));
}

#[test]
fn rejects_malformed_timestamp_without_panicking() {
    assert!(parse_lrc("[999999999999999999999:99.1x2]异常", None).is_err());
}

#[test]
fn cache_rejects_expired_or_mismatched_identity() {
    let cache_dir = unique_temp_dir("expired-cache");
    let repository = LyricsCacheRepository::new(cache_dir.clone(), Duration::from_secs(30 * 24 * 60 * 60));
    let original = build_track_identity(&request(Some(269_000)));
    let changed = build_track_identity(&LyricsTrackRequest {
        title: "夜曲".to_string(),
        ..request(Some(269_000))
    });
    let track_key = build_track_key(&original);
    let lyrics = ProviderLyrics {
        provider: "fake".to_string(),
        confidence: 1.0,
        raw_lrc: Some("[00:00.00]第一句".to_string()),
        lines: vec![LyricLine {
            index: 0,
            start_ms: Some(0),
            end_ms: None,
            text: "第一句".to_string(),
            translation: None,
        }],
    };
    repository.write_at(&original, &track_key, &lyrics, 1_000).unwrap();

    assert!(repository.read_at(&original, &track_key, 31 * 24 * 60 * 60 * 1_000).is_none());
    assert!(repository.read_at(&changed, &track_key, 2_000).is_none());
    let _ = std::fs::remove_dir_all(cache_dir);
}
```

- [x] **Step 3: 运行 Rust 核心测试并确认 RED**

Run: `cd src-tauri; cargo test lyrics::matcher lyrics::parser lyrics::cache --lib`

Expected: FAIL，原因是新身份、严格解析和缓存校验尚不存在。

- [x] **Step 4: 实现身份、顺序敏感匹配和严格解析**

```rust
pub struct TrackIdentity {
    pub normalized_title: String,
    pub normalized_artist: String,
    pub normalized_album: String,
    pub duration_bucket_ms: u64,
}

pub fn parse_lrc(raw_lrc: &str, translation_lrc: Option<&str>)
    -> Result<Vec<LyricLine>, LyricsParseError>;
```

时长按 5,000ms 分桶；标题相似度使用保留字符顺序的编辑距离；请求和候选都有歌手且歌手相似度低于 0.55 时直接拒绝。解析器支持正负 offset、100ms 翻译容差、检查算术、最多 2,000 行和单行最多 1,000 字符。

同时把两个现有 provider 调整为处理 `parse_lrc()` 的 `Result`。`cache.rs` 暂时保留 `read_cached_lyrics()` 与 `save_cached_lyrics()` 兼容包装，它们内部调用新仓库，直到 Task 4 将命令层迁移到 `LyricsService`。

- [x] **Step 5: 实现 schema 3 缓存仓库**

```rust
fn unique_temp_dir(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("nsd-lyrics-{label}-{nonce}"))
}

pub struct LyricsCacheRepository {
    cache_dir: PathBuf,
    ttl: Duration,
}

impl LyricsCacheRepository {
    pub fn read(&self, identity: &TrackIdentity, track_key: &str) -> Option<LyricsResponse>;
    pub fn write(&self, identity: &TrackIdentity, track_key: &str, lyrics: &ProviderLyrics)
        -> std::io::Result<()>;
}
```

缓存保存身份、`fetchedAtMs`、解析器版本和 provider；写入使用同目录临时文件后替换目标文件。添加 `sha2 = "0.10"` 直接依赖用于稳定键。

- [x] **Step 6: 运行 Rust 核心测试并确认 GREEN**

Run: `cd src-tauri; cargo test lyrics::matcher lyrics::parser lyrics::cache --lib`

Expected: PASS。

- [x] **Step 7: 提交歌词核心**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lyrics
git commit -m "refactor: 重建歌词解析匹配与缓存" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: 建立可测试的 LyricsService 与 provider 编排

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/lyrics/error.rs`
- Create: `src-tauri/src/lyrics/service.rs`
- Modify: `src-tauri/src/lyrics/providers.rs`
- Modify: `src-tauri/src/lyrics/providers/netease.rs`
- Modify: `src-tauri/src/lyrics/providers/qq_music.rs`
- Modify: `src-tauri/src/lyrics/types.rs`
- Modify: `src-tauri/src/lyrics/mod.rs`
- Modify: `src-tauri/src/commands/lyrics_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/ipc/contracts.ts`

**Interfaces:**
- Consumes: Task 3 的身份、解析器、匹配器和缓存仓库
- Produces: `LyricsProvider` trait
- Produces: `LyricsService::new(cache_dir)` 与 `get_lyrics(request)`
- Produces: `LyricsResponse.errorCode?: invalid_request | timeout | upstream | cache`
- Produces: `LyricsResponse.retryable: boolean`

- [x] **Step 1: 写入 provider 编排失败测试**

```rust
struct FakeProvider {
    name: &'static str,
    result: Mutex<Option<Result<Option<ProviderLyrics>, LyricsProviderError>>>,
}

#[async_trait::async_trait]
impl LyricsProvider for FakeProvider {
    fn name(&self) -> &'static str {
        self.name
    }

    async fn fetch(
        &self,
        _request: &LyricsTrackRequest,
    ) -> Result<Option<ProviderLyrics>, LyricsProviderError> {
        self.result.lock().unwrap().take().unwrap()
    }
}

fn fake_ok(result: Option<ProviderLyrics>) -> Arc<dyn LyricsProvider> {
    Arc::new(FakeProvider {
        name: "fake",
        result: Mutex::new(Some(Ok(result))),
    })
}

fn fake_error() -> Arc<dyn LyricsProvider> {
    Arc::new(FakeProvider {
        name: "fake",
        result: Mutex::new(Some(Err(LyricsProviderError::upstream("fake", "search")))),
    })
}

fn service_request() -> LyricsTrackRequest {
    LyricsTrackRequest {
        title: "晴天".to_string(),
        artist: "周杰伦".to_string(),
        album: Some("叶惠美".to_string()),
        duration_ms: Some(269_000),
        player: Some("qqmusic".to_string()),
    }
}

fn service_lyrics(confidence: f32) -> ProviderLyrics {
    ProviderLyrics {
        provider: "fake".to_string(),
        confidence,
        raw_lrc: Some("[00:00.00]第一句".to_string()),
        lines: vec![LyricLine {
            index: 0,
            start_ms: Some(0),
            end_ms: None,
            text: "第一句".to_string(),
            translation: None,
        }],
    }
}

fn service_with(providers: Vec<Arc<dyn LyricsProvider>>) -> LyricsService {
    LyricsService::with_providers(
        providers,
        LyricsCacheRepository::new(unique_temp_dir("service"), Duration::from_secs(60)),
        Duration::from_secs(8),
    )
}

#[tokio::test]
async fn returns_not_found_only_when_all_providers_miss() {
    let service = service_with(vec![fake_ok(None), fake_ok(None)]);
    assert_eq!(service.get_lyrics(service_request()).await.status, LyricsStatus::NotFound);
}

#[tokio::test]
async fn keeps_ready_result_when_another_provider_fails() {
    let service = service_with(vec![fake_error(), fake_ok(Some(service_lyrics(0.96)))]);
    assert_eq!(service.get_lyrics(service_request()).await.status, LyricsStatus::Ready);
}

#[tokio::test]
async fn returns_retryable_error_when_no_provider_hits_and_one_fails() {
    let service = service_with(vec![fake_error(), fake_ok(None)]);
    let response = service.get_lyrics(service_request()).await;
    assert_eq!(response.status, LyricsStatus::Error);
    assert!(response.retryable);
}
```

增加多个命中选择最高置信度、八秒总期限、空标题输入拒绝和相同服务复用 Client 的测试。

- [x] **Step 2: 运行服务测试并确认 RED**

Run: `cd src-tauri; cargo test lyrics::service --lib`

Expected: FAIL，原因是服务层和可注入 provider 尚不存在。

- [x] **Step 3: 实现错误类型、provider trait 和服务编排**

```rust
#[async_trait::async_trait]
pub trait LyricsProvider: Send + Sync {
    fn name(&self) -> &'static str;
    async fn fetch(&self, request: &LyricsTrackRequest)
        -> Result<Option<ProviderLyrics>, LyricsProviderError>;
}

pub struct LyricsService {
    providers: Vec<Arc<dyn LyricsProvider>>,
    cache: LyricsCacheRepository,
    deadline: Duration,
}
```

添加 `async-trait = "0.1"`。服务依次收集 provider 结果并选择最高置信度；整个收集过程包裹在 `tokio::time::timeout(Duration::from_secs(8), ...)` 中。

当 `request.player` 能映射到 QQ 音乐或网易云时，对应 provider 优先执行，但仍收集另一个 provider 的结果用于全局置信度比较。

- [x] **Step 4: 强化生产 provider HTTP 边界**

两个 provider 使用共享 Client；每个响应先 `error_for_status()`，再读取 bytes 并限制为 512 KiB，最后反序列化。Client 请求期限为三秒。解析错误、HTTP 状态和超大响应均返回带 provider 与阶段的 `LyricsProviderError`。

- [x] **Step 5: 将 Tauri 命令改为 State 适配器**

```rust
#[tauri::command]
pub async fn get_lyrics_for_track(
    service: State<'_, LyricsService>,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<u64>,
    player: Option<String>,
) -> Result<LyricsResponse, String> {
    Ok(service.get_lyrics(LyricsTrackRequest { title, artist, album, duration_ms, player }).await)
}
```

在 `setup` 中使用 `app_data_dir()/lyrics` 构造并 `app.manage(service)`，不再每次请求创建 Client。

同步更新 TypeScript `LyricsResponse`：`retryable` 为必填布尔值，`errorCode` 为可选的 `invalid_request | timeout | upstream | cache`。

- [x] **Step 6: 运行服务与歌词模块测试并确认 GREEN**

Run: `cd src-tauri; cargo test lyrics --lib`

Expected: PASS，且测试不访问真实网络。

- [x] **Step 7: 提交歌词服务**

```powershell
git add src-tauri
git commit -m "refactor: 建立统一歌词服务" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 5: 建立 useTrackLyrics 歌词状态机

**Files:**
- Create: `src/composables/useTrackLyrics.ts`
- Create: `src/composables/useTrackLyrics.test.ts`
- Modify: `src/composables/index.ts`
- Modify: `src/shared/ipc/contracts.ts`

**Interfaces:**
- Consumes: `buildPlaybackSessionIdentity()`、`normalizeLyricLines()`、`resolveCurrentLyricLine()`
- Consumes: `mediaCommands.getLyricsForTrack()` 和 Task 4 的 `retryable`
- Produces: `useTrackLyrics({ positionMs })`

- [x] **Step 1: 写入歌词状态机失败测试**

```typescript
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const ready = (text: string): LyricsResponse => ({
  status: 'ready',
  trackKey: text,
  provider: 'fake',
  source: 'online',
  confidence: 1,
  retryable: false,
  lines: [{ index: 0, startMs: 0, text }],
});

const playback = (patch: Partial<MusicPlaybackState> = {}): MusicPlaybackState => ({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  sourceAppId: 'qqmusic',
  player: 'qqmusic',
  isPlaying: true,
  durationMs: 269_000,
  positionMs: 10_000,
  timelineUpdatedAtMs: 1_000,
  snapshotTakenAtMs: 1_000,
  ...patch,
});

it('同一播放会话并发加载只发出一个请求', async () => {
  const request = deferred<LyricsResponse>();
  const getLyrics = vi.fn(() => request.promise);
  const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });
  void lyrics.load(playback());
  void lyrics.load(playback({ album: '稍后补全', durationMs: 269_000 }));
  expect(getLyrics).toHaveBeenCalledTimes(1);
});

it('切歌后丢弃上一首歌的迟到响应', async () => {
  const first = deferred<LyricsResponse>();
  const getLyrics = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValueOnce(ready('歌曲 B'));
  const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });
  void lyrics.load(playback({ title: '歌曲 A' }));
  await lyrics.load(playback({ title: '歌曲 B' }));
  first.resolve(ready('歌曲 A'));
  await Promise.resolve();
  expect(lyrics.currentLyricText.value).toBe('歌曲 B');
});

it('可重试错误按一秒和三秒退避后恢复', async () => {
  vi.useFakeTimers();
  const retryableError: LyricsResponse = {
    status: 'error',
    trackKey: 'a',
    provider: 'none',
    source: 'online',
    confidence: 0,
    retryable: true,
    errorCode: 'upstream',
    lines: [],
  };
  const getLyrics = vi
    .fn()
    .mockResolvedValueOnce(retryableError)
    .mockResolvedValueOnce(retryableError)
    .mockResolvedValueOnce(ready('已恢复'));
  const lyrics = useTrackLyrics({ positionMs: ref(0), getLyrics });
  void lyrics.load(playback());
  await vi.advanceTimersByTimeAsync(4_000);
  expect(getLyrics).toHaveBeenCalledTimes(3);
  expect(lyrics.currentLyricText.value).toBe('已恢复');
});
```

增加 `not_found` 五分钟负缓存、不可重试错误、卸载清理和位置后退重新匹配测试。

- [x] **Step 2: 运行状态机测试并确认 RED**

Run: `pnpm test -- src/composables/useTrackLyrics.test.ts`

Expected: FAIL，原因是组合式函数不存在。

- [x] **Step 3: 实现歌词状态机**

```typescript
export type TrackLyricsStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'retrying' | 'error';

export const useTrackLyrics = (options: UseTrackLyricsOptions) => ({
  status,
  lines,
  currentLyricText,
  nextLyricText,
  load,
  reset,
  dispose,
});
```

ready 内存缓存最多 50 首；`not_found` 负缓存五分钟；可重试错误最多重试两次，延迟为 1,000ms 和 3,000ms。内部 generation 在切歌、reset 和 dispose 时递增，所有 Promise 完成前校验 generation。

- [x] **Step 4: 运行歌词状态机及纯逻辑测试并确认 GREEN**

Run: `pnpm test -- src/composables/useTrackLyrics.test.ts src/modules/island/lyrics.test.ts`

Expected: PASS。

- [x] **Step 5: 提交歌词状态机**

```powershell
git add src/composables src/shared/ipc/contracts.ts
git commit -m "refactor: 重建前端歌词状态机" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 6: 建立 useMusicPlaybackSession 串行播放器会话

**Files:**
- Create: `src/composables/useMusicPlaybackSession.ts`
- Create: `src/composables/useMusicPlaybackSession.test.ts`
- Modify: `src/composables/index.ts`
- Modify: `src/shared/ipc/contracts.ts`

**Interfaces:**
- Consumes: Task 1 的 `mediaCommands`
- Consumes: Task 2 的 `usePlaybackTimeline()`
- Produces: `playback`、`status`、`start()`、`stop()`、`setTargetPlayer()`、`syncNow()`、`control()`

- [x] **Step 1: 写入会话失败测试**

```typescript
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const playback = (patch: Partial<MusicPlaybackState> = {}): MusicPlaybackState => ({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  sourceAppId: 'qqmusic',
  player: 'qqmusic',
  isPlaying: true,
  durationMs: 269_000,
  positionMs: 10_000,
  timelineUpdatedAtMs: 1_000,
  snapshotTakenAtMs: 1_000,
  ...patch,
});

const timeline = {
  positionMs: ref<number | null>(null),
  sync: vi.fn(),
  reset: vi.fn(),
  markStale: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

it('本次同步完成后才安排下一次轮询', async () => {
  vi.useFakeTimers();
  const first = deferred<MusicPlaybackState | null>();
  const getPlayback = vi.fn(() => first.promise);
  const session = useMusicPlaybackSession({ timeline, getPlayback });
  void session.start('qqmusic');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(getPlayback).toHaveBeenCalledTimes(1);
});

it('切换播放器后旧快照不能回写', async () => {
  const oldRequest = deferred<MusicPlaybackState | null>();
  const newSnapshot = playback({ player: 'netease', title: '新播放器歌曲' });
  const getPlayback = vi
    .fn()
    .mockImplementationOnce(() => oldRequest.promise)
    .mockResolvedValueOnce(newSnapshot);
  const session = useMusicPlaybackSession({ timeline, getPlayback });
  void session.start('qqmusic');
  await session.setTargetPlayer('netease');
  oldRequest.resolve(playback({ player: 'qqmusic', title: '旧播放器歌曲' }));
  await Promise.resolve();
  expect(session.playback.value?.title).toBe('新播放器歌曲');
});

it('连续三秒失败后冻结时间线为 stale', async () => {
  vi.useFakeTimers();
  const getPlayback = vi.fn().mockRejectedValue(new Error('SMTC 不可用'));
  const session = useMusicPlaybackSession({ timeline, getPlayback });
  void session.start('qqmusic');
  await vi.advanceTimersByTimeAsync(2_999);
  expect(timeline.markStale).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_001);
  expect(timeline.markStale).toHaveBeenCalledTimes(1);
  expect(session.status.value).toBe('stale');
});
```

增加播放控制成功后立即同步、控制失败不乐观翻转、stop 清 timer、重复 start 不创建双循环的测试。

- [x] **Step 2: 运行会话测试并确认 RED**

Run: `pnpm test -- src/composables/useMusicPlaybackSession.test.ts`

Expected: FAIL，原因是会话组合式函数不存在。

- [x] **Step 3: 实现串行播放器会话**

```typescript
export type MusicSessionStatus = 'idle' | 'ready' | 'stale' | 'error';

export const useMusicPlaybackSession = (options: UseMusicPlaybackSessionOptions) => ({
  playback,
  status,
  start,
  stop,
  setTargetPlayer,
  syncNow,
  control,
});
```

轮询周期 1,000ms；成功同步更新时间并调用 timeline.sync；连续失败超过 3,000ms 时调用 timeline.markStale；所有请求使用 generation，`stop()`、切换播放器和重新 start 都会使旧结果失效。

- [x] **Step 4: 运行会话与时间线测试并确认 GREEN**

Run: `pnpm test -- src/composables/useMusicPlaybackSession.test.ts src/composables/usePlaybackTimeline.test.ts src/modules/island/playbackTimeline.test.ts`

Expected: PASS。

- [x] **Step 5: 提交播放器会话**

```powershell
git add src/composables src/shared/ipc/contracts.ts
git commit -m "refactor: 重建音乐播放器会话" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 7: 集成 IslandView 并清理旧链路

**Files:**
- Modify: `src/components/island/IslandView.vue`
- Modify: `src/components/island/IslandDisplayController.vue`
- Modify: `src/components/island/IslandDisplayController.test.ts`
- Modify: `src/components/island/MusicContent.vue`
- Modify: `src/components/island/MusicContent.test.ts`
- Create: `src/components/island/MusicLyricsPanel.vue`
- Create: `src/components/island/MusicLyricsPanel.test.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: Tasks 2、5、6 的三个 composable
- Produces: 保持现有 `MusicContent` props 与事件行为

- [x] **Step 1: 写入集成回归测试**

```typescript
it('歌词重试状态显示正在重新连接', () => {
  const wrapper = mount(MusicContent, {
    props: { ...baseProps, lyricsStatus: 'retrying' },
  });
  expect(wrapper.find('.current-lyric').text()).toBe('歌词服务重连中…');
});

it('播放控制事件仍由内容分发器透传', async () => {
  const wrapper = mount(IslandDisplayController, { props: musicProps });
  await wrapper.find('[aria-label="播放或暂停"]').trigger('click');
  expect(wrapper.emitted('toggle-play')).toHaveLength(1);
});
```

- [x] **Step 2: 运行组件测试并确认 RED**

Run: `pnpm test -- src/components/island/MusicContent.test.ts src/components/island/IslandDisplayController.test.ts`

Expected: FAIL，原因是 `retrying` 展示状态尚未接入。

- [x] **Step 3: 用新 composable 替换 IslandView 旧状态**

```typescript
const playbackTimeline = usePlaybackTimeline();
const musicSession = useMusicPlaybackSession({ timeline: playbackTimeline });
const trackLyrics = useTrackLyrics({ positionMs: playbackTimeline.positionMs });

watch(musicSession.playback, (playback) => {
  if (playback) void trackLyrics.load(playback);
  else trackLyrics.reset();
});
```

删除 `musicTimer`、`lyricPositionTimer`、`isMusicSyncing`、`lyricsRequestId`、`createLyricTimelineClock`、`syncMusicStatus` 和 `loadLyricsForPlayback`。控制按钮改为调用 `musicSession.control()`。

- [x] **Step 4: 完成生命周期和封面竞态清理**

所有音乐相关 `listen()` 返回值加入 `UnlistenFn[]`；卸载时依次执行，随后调用 `musicSession.stop()`、`playbackTimeline.stop()`、`trackLyrics.dispose()`。异步 `onMounted` 使用 disposed 标志，组件已经卸载时不再注册后续监听器或 timer。封面请求增加 generation 与曲目身份校验，旧请求不得覆盖或清空新封面。歌词展示文案与样式移入 `MusicLyricsPanel.vue`，让 `MusicContent.vue` 回到 300 行以内。

删除 `src/types/index.ts` 中未使用且与 IPC 毫秒位置语义冲突的 `MusicState` / `MusicData` 重复结构；如果仍有调用则迁移到 `MusicPlaybackState`。

- [x] **Step 5: 运行音乐相关前端测试并确认 GREEN**

Run: `pnpm test -- src/modules/island/lyrics.test.ts src/modules/island/playbackTimeline.test.ts src/composables/usePlaybackTimeline.test.ts src/composables/useTrackLyrics.test.ts src/composables/useMusicPlaybackSession.test.ts src/components/island/MusicContent.test.ts src/components/island/IslandDisplayController.test.ts`

Expected: PASS。

- [x] **Step 6: 检查文件规模与中文注释**

Run: `Get-ChildItem src -Recurse -File -Include *.ts,*.vue | ForEach-Object { $count=(Get-Content -LiteralPath $_.FullName -Encoding UTF8).Count; if ($_.Extension -eq '.vue' -and $count -gt 300) { "$count $($_.FullName)" } }`

Expected: 新建或完成拆分的 composable 均不超过 200 行；本任务不向超过限制的组件继续堆积业务逻辑，音乐业务逻辑从 `IslandView.vue` 明显减少。

- [x] **Step 7: 提交集成变更**

```powershell
git add src
git commit -m "refactor: 接入全新歌词与播放进度链路" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 8: 全量验证与文档收尾

**Files:**
- Modify: `docs/plans/2026-07-13-music-lyrics-refactor-design.md`（仅在实现偏差需要记录时）
- Modify: `docs/superpowers/plans/2026-07-13-music-lyrics-refactor.md`（勾选实际完成项）

**Interfaces:**
- Consumes: Tasks 1–7 的全部实现
- Produces: 可复现的测试、构建、格式、lint、Clippy 与编码验证记录

- [x] **Step 1: 运行前端全量验证**

Run: `pnpm test`

Expected: 所有测试通过，0 个失败。

Run: `pnpm run typecheck`

Expected: exit 0。

Run: `pnpm run lint`

Expected: exit 0；不得新增错误或警告。

Run: `pnpm run build`

Expected: exit 0。

- [x] **Step 2: 运行 Rust 全量验证**

Run: `cd src-tauri; cargo test --lib`

Expected: 所有测试通过，0 个失败。

Run: `cd src-tauri; cargo fmt --check`

Expected: exit 0。

Run: `cd src-tauri; cargo clippy --all-targets --all-features -- -D warnings`

Expected: exit 0。

- [x] **Step 3: 检查 UTF-8 without BOM 与禁用锁文件**

```powershell
$textExtensions = @('.ts', '.vue', '.rs', '.toml', '.json', '.md', '.css', '.html')
Get-ChildItem -Recurse -File | Where-Object {
  $textExtensions -contains $_.Extension -and $_.FullName -notmatch '\\(node_modules|target|dist)\\'
} | ForEach-Object {
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw "检测到 UTF-8 BOM: $($_.FullName)"
  }
}
if (Test-Path package-lock.json) { throw '禁止存在 package-lock.json' }
if (Test-Path yarn.lock) { throw '禁止存在 yarn.lock' }
```

Expected: 无输出、无异常。

- [x] **Step 4: 复核需求清单和 git diff**

Run: `git diff --check; git status --short; git diff --stat $(git merge-base main HEAD)..HEAD`

Expected: 无空白错误；只包含设计、测试和音乐歌词重构相关文件。

- [x] **Step 5: 提交文档收尾**

```powershell
git add docs
git commit -m "docs: 完成音乐歌词重构记录" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### 验证记录（2026-07-13）

- 前端：`pnpm test` 通过，22 个测试文件共 186 个测试；`pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 均以 0 退出。
- Rust：`cargo test` 通过，库测试 58 个；`cargo clippy --all-targets --all-features -- -D warnings`、`cargo build`、`cargo check` 均通过。
- 格式：本分支变更的 24 个 Rust 文件均通过 Rustfmt；全仓 `cargo fmt --check` 仅因未修改的 `src-tauri/build.rs` 与 `src-tauri/src/main.rs` 既有换行风格退出非零，未在本任务中扩大改动范围。
- Lint：全仓为 0 错误、5386 条告警，低于主分支基线的 11538 条；新增前端文件定向检查为 0 错误、0 告警，本次新增的两条模板告警已修复。
- 静态审计：变更文件均为严格 UTF-8 without BOM，无 `package-lock.json` 或 `yarn.lock`，`git diff --check` 通过；新增文件规模、中文注释和本次新增监听器的清理符合项目约束。
