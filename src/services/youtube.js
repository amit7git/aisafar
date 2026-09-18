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
// Task-7 B — seek-epoch guards: trackVersion bumps on every track change so
// any still-settling seek (paint target or 700ms resume timer) knows it is
// stale and must not touch the NEWLY cued track. seekVersion is the epoch
// snapshot taken when the last seek was committed.
let trackVersion = 0;
let seekVersion = 0;
let progressTimer;
let booted = false;
let playIntent = false;
let playerCallbacks = null;
let seekRestoreTimer = null;

const YT_STATE = (typeof YT !== "undefined" && YT.PlayerState) || {
    UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5
};

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

/* Task-7 B — invalidate any still-settling seek when the track changes.
   MUST be called before switching tracks (NEXT / PREVIOUS / random /
   playlist load / error-advance) so a stale pendingSeek can never paint
   the old target time on the new video and a stale resume timer can never
   playVideo() into it. Idempotent — safe to call repeatedly. */
export function invalidateSeekState() {
    trackVersion += 1;
    if (seekRestoreTimer) {
        clearTimeout(seekRestoreTimer);
        seekRestoreTimer = null;
    }
    pendingSeek = null;
    pendingSeekAt = 0;
    isSeeking = false;
}

export function resetPlaylistState(ui) {
    playlistIds = [];
    currentIndex = -1;
    metadata = new Map();
    ui.list.replaceChildren();
    ui.seek.max = "0";
    ui.seek.value = "0";
    ui.seek.style.setProperty("--progress", "0%");
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
    if (pendingSeek !== null && !isSeeking) {
        ui.seek.value = String(pendingSeek);
        ui.current.textContent = formatTime(pendingSeek);
        if (pendingSeekSettled(current)) {
            pendingSeek = null;
        }
        syncSeekFill(ui);
        return;
    }
    if (!isSeeking) {
        ui.seek.value = String(Math.min(current, duration));
        ui.current.textContent = formatTime(current);
    }
    syncSeekFill(ui);
}

/* UI-only: keep the scrubber's played/remaining split (--progress) in sync
   with the existing seek value; no seek logic is touched. */
function syncSeekFill(ui) {
    const total = Number(ui.seek.max) || 0;
    const at = Number(ui.seek.value) || 0;
    const pct = total > 0 ? Math.min(100, Math.max(0, (at / total) * 100)) : 0;
    ui.seek.style.setProperty("--progress", `${pct}%`);
}

/* Keep showing the committed target position until the player has actually
   reached it. On slow / unstable connections the embed can take a while to
   buffer the new position, so the classic short timeout made the thumb snap
   back and the song appear "stuck". While the player is still buffering we
   allow a much longer grace period; once it has definitely given up we return
   the thumb to the real position so the UI never lies. */
function pendingSeekSettled(current) {
    if (seekVersion !== trackVersion) return true;
    if (Math.abs(current - pendingSeek) < 1.5) return true;
    let buffering = false;
    try {
        buffering = player.getPlayerState() === YT_STATE.BUFFERING;
    } catch {}
    const age = Date.now() - pendingSeekAt;
    return age > (buffering ? 15000 : 6000);
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
    // Rapid successive seeks are allowed: a newer gesture always supersedes any
    // still-settling previous seek (main.js deduplicates pointerup/change pairs,
    // so each user gesture commits exactly once here).
    pendingSeek = Number(ui.seek.value);
    if (!Number.isFinite(pendingSeek) || pendingSeek < 0) pendingSeek = 0;
    pendingSeekAt = Date.now();
    seekVersion = trackVersion;
    isSeeking = false;
    const wasPlaying = (() => {
        try { return player.getPlayerState() === YT_STATE.PLAYING; } catch { return false; }
    })();
    try {
        player.seekTo(pendingSeek, true);
    } catch {}
    // On flaky connections a seek can drop an actively playing embed into a
    // paused/idle state that never resumes on its own. If we were playing
    // before the gesture, make ONE gentle resume attempt shortly after the
    // seek so the song never gets stuck paused. Never interrupts a healthy
    // buffering/playing flow, and never fires during a playlist switch.
    if (wasPlaying) scheduleSeekResume(trackVersion);
}

function scheduleSeekResume(versionAtSeek) {
    if (seekRestoreTimer) {
        clearTimeout(seekRestoreTimer);
        seekRestoreTimer = null;
    }
    seekRestoreTimer = setTimeout(() => {
        seekRestoreTimer = null;
        if (!ready || !player || playlistSwitching) return;
        // Track changed since the seek was committed — never resume into the
        // newly cued song.
        if (versionAtSeek !== trackVersion) return;
        let state;
        try { state = player.getPlayerState(); } catch { return; }
        if (state === YT_STATE.PAUSED || state === YT_STATE.CUED || state === YT_STATE.UNSTARTED) {
            try { player.playVideo(); } catch {}
        }
    }, 700);
}

export function randomTrack(onPlay) {
    invalidateSeekState();
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
    invalidateSeekState();
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
                            invalidateSeekState();
                            player.nextVideo();
                        }
                    }, 500);
                }
            }
        });
    }

    window.onYouTubeIframeAPIReady = createPlayer;
}
