/**
 * Radio Safar — Command Layer
 *
 * A thin, safe abstraction over the YouTube IFrame Player that exposes
 * only the actions the existing UI already supports. Both the current
 * HTML UI and any future interface (AI Safar, voice, etc.) should route
 * player commands through this module instead of calling youtube.js
 * exports directly.
 *
 * RULES:
 *  - No arbitrary code execution.
 *  - Only the six whitelisted action types are accepted.
 *  - Read-only state getters return plain data, never internal objects.
 */

import { MOOD_PLAYLISTS } from '../config/playlists.js';
import {
    player,
    ready,
    activeMood,
    requestedPlaylistId,
    playlistIds,
    currentIndex,
    shuffle,
    playlistSwitching,
    setShuffle,
    setActiveMood,
    setPlaylistSwitching,
    setPlayIntent,
    bootYouTubePlayer,
    loadMoodPlaylist,
    randomTrack,
    supportsFullPlaylist
} from './youtube.js';

/* ================================================================
   ACTIONS  — the only way to mutate player state from outside
   ================================================================ */

export function play() {
    if (!player) {
        setPlayIntent(true);
        bootYouTubePlayer();
        return;
    }
    if (!ready) return;
    player.playVideo();
}

export function pause() {
    if (!player || !ready) return;
    player.pauseVideo();
}

export function next() {
    if (!player || !ready || playlistSwitching) return;
    shuffle ? randomTrack() : player.nextVideo();
}

export function previous() {
    if (!player || !ready || playlistSwitching) return;
    shuffle ? randomTrack() : player.previousVideo();
}

export function toggleShuffle() {
    setShuffle(!shuffle);
    return shuffle;
}

/**
 * Switch to a different Safar (mood playlist).
 *
 * @param {string}  moodKey       Key inside MOOD_PLAYLISTS (e.g. "RadhaKrishna")
 * @param {object}  callbacks     Required callback pair
 * @param {Function} callbacks.onReady     Called after the new playlist is loaded and UI can render
 * @param {Function} callbacks.onStateChange  Forwarded to the YouTube player's onStateChange
 * @returns {boolean} true if the switch was initiated, false if rejected
 */
export function selectSafar(moodKey, callbacks) {
    if (!player || !ready) return false;
    if (moodKey === activeMood && !playlistSwitching) return false;

    setActiveMood(moodKey);
    setPlaylistSwitching(true);

    try { player.stopVideo(); } catch {}

    if (supportsFullPlaylist()) {
        loadMoodPlaylist(moodKey)
            .catch(err => console.error("Playlist loading failed:", err))
            .then(() => {
                setPlaylistSwitching(false);
                if (callbacks?.onReady) callbacks.onReady();
            });
    } else {
        try {
            player.loadPlaylist({
                listType: "playlist",
                list: requestedPlaylistId,
                index: 0
            });
        } catch (err) {
            console.error("Playlist loading failed:", err);
            setPlaylistSwitching(false);
            return false;
        }
        setTimeout(() => {
            setPlaylistSwitching(false);
            if (callbacks?.onReady) callbacks.onReady();
        }, 1200);
    }

    return true;
}

/* ================================================================
   STATE  — read-only accessors (safe for any caller)
   ================================================================ */

export function currentTrack() {
    if (!player || !ready) return null;
    try {
        const data = player.getVideoData() || {};
        return {
            id: data.video_id || null,
            title: data.title || null,
            artist: data.author || null
        };
    } catch {
        return null;
    }
}

export function currentPlaylist() {
    return playlistIds.slice();
}

export function getCurrentIndex() {
    if (!player || !ready) return -1;
    try {
        const idx = player.getPlaylistIndex();
        return Number.isInteger(idx) ? idx : currentIndex;
    } catch {
        return currentIndex;
    }
}

export function isShuffleOn() {
    return shuffle;
}

export function isReady() {
    return Boolean(player && ready);
}

export function getActiveSafar() {
    return activeMood;
}

/* YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued */
const YT_STATE_MAP = { 1: 'playing', 2: 'paused' };

export function statusFromStateCode(code) {
    return (Number.isInteger(code) && YT_STATE_MAP[code]) || 'idle';
}

/**
 * Live playback status read from the YouTube player itself — the single source
 * of truth. Read-only, never mutated here.
 */
export function getPlayerStatus() {
    if (!player || !ready) return 'idle';
    try {
        const code = player.getPlayerState();
        return statusFromStateCode(Number.isInteger(code) ? code : -1);
    } catch {
        return 'idle';
    }
}

/**
 * Minimal read-only snapshot for AI Safar. Returns ONLY the small set of fields
 * the companion needs; never player/playlist internals (no video ids, no
 * playlist ids/arrays). Fields that are not reliably available are null.
 */
export function getPlayerSnapshot() {
    const track = currentTrack();
    return {
        safarKey: activeMood,
        safarLabel: MOOD_PLAYLISTS[activeMood]?.label || null,
        trackTitle: track?.title || null,
        trackArtist: track?.artist || null,
        status: getPlayerStatus(),
        shuffle
    };
}
