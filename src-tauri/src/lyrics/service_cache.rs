use std::io;
use std::sync::Arc;

use super::cache::LyricsCacheRepository;
use super::types::{LyricsResponse, ProviderLyrics, TrackIdentity};

pub(crate) trait LyricsCache: Send + Sync {
    fn read(&self, identity: &TrackIdentity, track_key: &str)
        -> io::Result<Option<LyricsResponse>>;

    fn write(
        &self,
        identity: &TrackIdentity,
        track_key: &str,
        lyrics: &ProviderLyrics,
    ) -> io::Result<()>;
}

impl LyricsCache for LyricsCacheRepository {
    fn read(
        &self,
        identity: &TrackIdentity,
        track_key: &str,
    ) -> io::Result<Option<LyricsResponse>> {
        LyricsCacheRepository::try_read(self, identity, track_key)
    }

    fn write(
        &self,
        identity: &TrackIdentity,
        track_key: &str,
        lyrics: &ProviderLyrics,
    ) -> io::Result<()> {
        LyricsCacheRepository::write(self, identity, track_key, lyrics)
    }
}

pub(crate) async fn read_cache(
    cache: Arc<dyn LyricsCache>,
    identity: TrackIdentity,
    track_key: String,
) -> Result<Option<LyricsResponse>, String> {
    tokio::task::spawn_blocking(move || cache.read(&identity, &track_key))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

pub(crate) fn write_cache_in_background(
    cache: Arc<dyn LyricsCache>,
    identity: TrackIdentity,
    track_key: String,
    lyrics: ProviderLyrics,
) {
    tokio::task::spawn_blocking(move || {
        if let Err(error) = cache.write(&identity, &track_key, &lyrics) {
            eprintln!("[NSD] 保存歌词缓存失败: {error}");
        }
    });
}
