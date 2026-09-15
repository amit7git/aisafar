import { MOOD_PLAYLISTS } from '../config/playlists.js';
import { hasYouTubeApiKey, fetchAllPlaylistItems } from './playlist-api.js';

export let player = null;
export let ready = false;
// Default to the FIRST playlist in MOOD_PLAYLISTS (index 0). No persisted state
// overrides this: localStorage is only used for song metadata caching.
export const DEFAULT_MOOD = Object.keys(MOOD_PLAYLISTS)[0];
export let activeMood = DEFAULT_MOOD;
export let requestedPlaylistId = MOOD_PLAYLISTS[activeMood].id;
export let currentIndex = -1;
export let shuffle = false;
export let playlistIds = [];
export let metadata = new Map();
export let playlistSwitching = false;
export let isSeeking = false;
export let pendingSeek = null;
export let pendingSeekAt = 0;
let progressTimer;
let booted = false;
let playIntent = false;
let playerCallbacks = null;

export const formatTime = seconds => {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function setShuffle(val) {
    shuffle = val;
}

export function toggleMute() {
    if (!player || !ready) return null;
    try {
        if (player.isMuted()) {
            player.unMute();
            return false;
        }
        player.mute();
        return true;
    } catch (err) {
        return null;
    }
}

export function setActiveMood(mood) {
    activeMood = mood;
    requestedPlaylistId = MOOD_PLAYLISTS[mood].id;
}

export function setPlaylistSwitching(val) {
    playlistSwitching = val;
}

export function setCurrentIndex(idx) {
    currentIndex = idx;
}

export function setSeekingState(seeking) {
    isSeeking = seeking;
}

export function resetPlaylistState(ui) {
    playlistIds = [];
    currentIndex = -1;
    metadata = new Map();
    ui.list.replaceChildren();
    ui.seek.max = "0";
    ui.seek.value = "0";
    ui.current.textContent = "0:00";
    ui.total.textContent = "0:00";
    ui.title.textContent = "Loading the road…";
    ui.art.style.backgroundImage = "";
    ui.count.textContent = `${MOOD_PLAYLISTS[activeMood]?.label || activeMood} • LOADING TRACKS…`;
}

export function updateProgress(ui) {
    if (!ready) return;
    const duration = player.getDuration() || 0;
    const current = player.getCurrentTime() || 0;
    ui.seek.max = String(Math.floor(duration));
    ui.total.textContent = formatTime(duration);
    if (pendingSeek !== null) {
        ui.seek.value = String(pendingSeek);
        ui.current.textContent = formatTime(pendingSeek);
        if (Math.abs(current - pendingSeek) < 1.5 || Date.now() - pendingSeekAt > 5000) {
            pendingSeek = null;
        }
        return;
    }
    if (!isSeeking) {
        ui.seek.value = String(Math.min(current, duration));
        ui.current.textContent = formatTime(current);
    }
}

export function startProgress(ui) {
    stopProgress();
    progressTimer = setInterval(() => updateProgress(ui), 1000);
}

export function stopProgress() {
    clearInterval(progressTimer);
    progressTimer = undefined;
}

export function updateMetadata(ui, onIndexChange) {
    if (!ready) return;
    try {
        const data = player.getVideoData() || {};
        ui.title.textContent = data.title || "Unknown track";
        if (data.video_id) {
            ui.art.style.backgroundImage =
                `url("https://i.ytimg.com/vi/${encodeURIComponent(data.video_id)}/mqdefault.jpg")`;
        }
        const index = player.getPlaylistIndex();
        if (Number.isInteger(index) && index >= 0) {
            currentIndex = index;
            if (onIndexChange) onIndexChange();
        }
    } catch {}
}

const META_CACHE_KEY = "radio-safar:songmeta:v1";
const META_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

const ensureMetaCache = () => {
    if (!globalThis.__radioSafarMetaCache) {
        try {
            const raw = localStorage.getItem(META_CACHE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            globalThis.__radioSafarMetaCache = parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            globalThis.__radioSafarMetaCache = {};
        }
    }
    return globalThis.__radioSafarMetaCache;
};

const persistMetaCache = () => {
    try {
        const cache = globalThis.__radioSafarMetaCache;
        const now = Date.now();
        for (const key of Object.keys(cache)) {
            if (now - (cache[key]?.ts || 0) > META_CACHE_TTL) delete cache[key];
        }
        localStorage.setItem(META_CACHE_KEY, JSON.stringify(cache));
    } catch {}
};

export async function getVideoMetadata(id) {
    if (metadata.has(id)) return metadata.get(id);
    const cache = ensureMetaCache();
    const hit = cache[id];
    if (hit && Date.now() - (hit.ts || 0) < META_CACHE_TTL) {
        const value = { title: hit.title, artist: hit.artist };
        metadata.set(id, value);
        return value;
    }
    const fallback = {
        title: `Track ${playlistIds.indexOf(id) + 1}`,
        artist: MOOD_PLAYLISTS[activeMood]?.description || activeMood
    };
    try {
        const url =
            `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("oEmbed failed");
        const data = await response.json();
        const value = { title: data.title || fallback.title, artist: data.author_name || fallback.artist };
        metadata.set(id, value);
        cache[id] = { title: value.title, artist: value.artist, ts: Date.now() };
        persistMetaCache();
        return value;
    } catch {
        metadata.set(id, fallback);
        return fallback;
    }
}

async function mapWithConcurrency(values, limit, mapper) {
    const result = [];
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, values.length) }, async () => {
            while (next < values.length) {
                const index = next++;
                result[index] = await mapper(values[index]);
            }
        })
    );
    return result;
}

export async function loadPlaylistMetadata(ui, onRender) {
    const moodAtStart = activeMood;
    const playlistAtStart = requestedPlaylistId;
    if (!playlistIds.length) return;
    ui.count.textContent = `${playlistIds.length} TRACKS • LOADING NAMES…`;
    await mapWithConcurrency(playlistIds, 4, getVideoMetadata);
    if (moodAtStart !== activeMood || playlistAtStart !== requestedPlaylistId) return;
    if (onRender) onRender();
    ui.count.textContent = `${playlistIds.length} TRACKS • ${MOOD_PLAYLISTS[activeMood]?.label || activeMood}`;
}

export function syncPlaylistFromPlayer(ui, onSyncDone) {
    if (!player || !ready) return;
    if (playlistSwitching) return;
    const ids = (player.getPlaylist() || []).slice();
    if (!ids.length) return;
    playlistIds = ids;
    const index = player.getPlaylistIndex();
    currentIndex = Number.isInteger(index) ? index : 0;
    if (onSyncDone) onSyncDone();
    loadPlaylistMetadata(ui, onSyncDone);
}

export function commitSeek(ui) {
    if (!ready) return;
    // Guard: ignore if a seek is already pending
    if (pendingSeek !== null) return;
    pendingSeek = Number(ui.seek.value);
    pendingSeekAt = Date.now();
    isSeeking = false;
    player.seekTo(pendingSeek, true);
}

export function randomTrack(onPlay) {
    const ids = player.getPlaylist() || [];
    if (ids.length < 2) { player.nextVideo(); return; }
    let index;
    do {
        index = Math.floor(Math.random() * ids.length);
    } while (index === currentIndex);
    currentIndex = index;
    player.playVideoAt(index);
    if (onPlay) onPlay();
}

export function setPlayIntent(value) {
    playIntent = Boolean(value);
}

/**
 * True when a YouTube Data API v3 key is configured. When enabled, playlists are
 * fetched with full pagination (no 200-video cap) and loaded into the player as a
 * video-ID array. When disabled, the IFrame player's built-in playlist loading is
 * used (limited to ~200 videos by the YouTube player API itself).
 */
export function supportsFullPlaylist() {
    return hasYouTubeApiKey();
}

/**
 * Load a mood playlist into the IFrame player.
 * - With an API key: fetch every item via paginated Data API calls, then load the
 *   resulting video-ID array (bypasses the 200-video player cap).
 * - Without a key, or if the fetch fails: fall back to the player's native
 *   listType:"playlist" loading so playback still works.
 */
export async function loadMoodPlaylist(moodKey) {
    const listId = MOOD_PLAYLISTS[moodKey]?.id || requestedPlaylistId;

    let ids = null;
    if (hasYouTubeApiKey()) {
        try {
            ids = await fetchAllPlaylistItems(listId);
        } catch (error) {
            console.error("Full playlist fetch failed, falling back to built-in playlist:", error);
        }
    }

    if (ids && ids.length) {
        playlistIds = ids;
        currentIndex = 0;
        player.loadPlaylist({ playlist: ids, index: 0 });
        return;
    }
    player.loadPlaylist({ listType: "playlist", list: listId, index: 0 });
}

export function bootYouTubePlayer() {
    if (booted || player) return;
    booted = true;
    const yt = document.createElement("script");
    yt.src = "https://www.youtube.com/iframe_api";
    yt.async = true;
    document.head.append(yt);
}

export function initYouTubePlayer(ui, callbacks) {
    playerCallbacks = callbacks;

    function createPlayer() {
        if (player) return;
        const playerVars = {
            playsinline: 1,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            autoplay: 0
        };
        if (!supportsFullPlaylist()) {
            playerVars.listType = "playlist";
            playerVars.list = MOOD_PLAYLISTS[activeMood].id;
        }
        player = new YT.Player("youtubeAudio", {
            host: "https://www.youtube-nocookie.com",
            playerVars,
            events: {
                onReady() {
                    ready = true;
                    requestedPlaylistId = MOOD_PLAYLISTS[activeMood].id;
                    if (supportsFullPlaylist()) {
                        loadMoodPlaylist(activeMood)
                            .catch(error => console.error("Playlist loading failed:", error))
                            .then(() => playerCallbacks.onReady())
                            .then(() => {
                                if (playIntent) {
                                    playIntent = false;
                                    try { player.playVideo(); } catch {}
                                }
                            });
                        return;
                    }
                    playerCallbacks.onReady();
                    if (playIntent) {
                        playIntent = false;
                        try { player.playVideo(); } catch {}
                    }
                },
                onStateChange(event) {
                    playerCallbacks.onStateChange(event);
                },
                onError() {
                    setTimeout(() => {
                        if (player && !playlistSwitching) {
                            player.nextVideo();
                        }
                    }, 500);
                }
            }
        });
    }

    window.onYouTubeIframeAPIReady = createPlayer;
}
