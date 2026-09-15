import './styles/style.css';
import { MOOD_PLAYLISTS } from './config/playlists.js';
import { BUMPERS } from './config/bumpers.js';
import { buildBumperPool } from './config/bumper-library.js';
import { initClock } from './components/clock.js';
import { initAiSafar, isAiOpen } from './components/ai-safar.js';
import { initTicket, closeTicketModal } from './components/ticket.js';
import { registerAiSwitchSafarHandler, registerAiUiSync } from './services/ai-actions.js';
import { playBusHorn } from './services/horn.js';
import { initPresence } from './services/presence.js';
import {
    player,
    ready,
    activeMood,
    requestedPlaylistId,
    currentIndex,
    playlistIds,
    metadata,
    playlistSwitching,
    formatTime,
    setCurrentIndex,
    setSeekingState,
    resetPlaylistState,
    updateProgress,
    startProgress,
    stopProgress,
    updateMetadata,
    syncPlaylistFromPlayer,
    commitSeek,
    initYouTubePlayer,
    toggleMute
} from './services/youtube.js';
import {
    play,
    pause,
    next as cmdNext,
    previous as cmdPrevious,
    toggleShuffle,
    selectSafar,
    isShuffleOn
} from './services/radio-commands.js';
import {
    renderMoodList,
    updateMoodButton,
    renderPlaylist,
    updateActive,
    openPlaylistModal,
    closePlaylistModal,
    openMoodModal,
    closeMoodModal,
    openInfoModal,
    closeInfoModal
} from './components/modals.js';

(() => {
    "use strict";

    const SUPABASE_URL = "https://agkcqkmgjowbkonvlbmc.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FX5AllKL82ATvMh_mxpfTg_yG97xyjZ";

    const $ = id => document.getElementById(id);

    const ui = {
        online: $("onlineText"),
        console: $("console"),
        vuStrip: $("ledVuStrip"),
        bumper: $("bumperText"),
        title: $("trackTitle"),
        art: $("cdArt"),
        mood: $("moodBtn"),
        seek: $("seek"),
        current: $("timeCurrent"),
        total: $("timeTotal"),
        shuffle: $("shuffleBtn"),
        horn: $("hornBtn"),
        prev: $("prevBtn"),
        play: $("playBtn"),
        next: $("nextBtn"),
        playlistButton: $("playlistBtn"),
        minimizeButton: $("minimizeBtn"),
        infoButton: $("infoBtn"),
        infoModal: $("infoModal"),
        infoClose: $("closeInfo"),
        modal: $("playlistModal"),
        close: $("closePlaylist"),
        list: $("playlistList"),
        count: $("playlistCount"),
        moodModal: $("moodModal"),
        moodClose: $("closeMood"),
        moodList: $("moodList"),
        moodCount: $("moodCount"),
        rainBtn: $("rainBtn"),
        muteBtn: $("muteBtn"),
        ticketBtn: $("bookTicketBtn"),
        ticketModal: $("ticketModal"),
        ticketClose: $("closeTicket"),
        ticketForm: $("ticketForm"),
        ticket: $("ticket"),
        ticketEdit: $("ticketEdit"),
        ticketDownload: $("ticketDownload"),
        ticketShare: $("ticketShare"),
        ticketStatus: $("ticketStatus"),
        errName: $("errName"),
        errAge: $("errAge"),
        errDate: $("errDate"),
        errCities: $("errCities"),
    };

    let playerMinimized = false;
    let connecting = false;
    let rainOn = false;
    let rainAudio = null;

    // V3.1 — Live LED status state
    let isPlayingNow = false;
    let playbackStarted = false;
    let mutedNow = false;
    let ticketPlanOpen = false;
    let ledWelcomeOver = false;
    let safarChanging = false;
    let safarTimer = null;

    // 1. Digital Clock
    initClock();

    // 1b. AI Safar Companion (self-contained; read-only player context)
    initAiSafar();

    // 1c. Radio Safar Travels ticket experience (self-contained; read-only state)
    initTicket(ui);

    // V3.1 — watch the ticket drawer so the LED status can reflect its state
    if (ui.ticketModal && "MutationObserver" in window) {
        new MutationObserver(() => {
            const open = ui.ticketModal.classList.contains("open");
            if (open !== ticketPlanOpen) {
                ticketPlanOpen = open;
                refreshLedStatus(false);
            }
        }).observe(ui.ticketModal, { attributes: true, attributeFilter: ["class"] });
    }

    // 2. Context-aware Bumper Rotation (layered library, see bumper-library.js)
    function setBumperText(text) {
        ui.bumper.style.opacity = "0";
        ui.bumper.style.transform = "translateY(4px)";
        setTimeout(() => {
            ui.bumper.textContent = text;
            ui.bumper.style.opacity = "1";
            ui.bumper.style.transform = "translateY(0)";
        }, 200);
    }

    function flashBumperMessage(text) {
        if (ui.bumper) setBumperText(text);
    }

    function currentAtmosphere() {
        const hour = new Date().getHours();
        const atmosphere = [];
        if (hour >= 19 || hour < 6) atmosphere.push("night");
        if (rainOn) atmosphere.push("rain");
        return atmosphere;
    }

    function pickRandom(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    let lastBumperLine = null;
    function nextBumperLine() {
        const mood = MOOD_PLAYLISTS[activeMood];
        const pool = buildBumperPool({
            mood: activeMood,
            tags: mood?.tags || [],
            atmosphere: currentAtmosphere()
        });
        let line = pickRandom(pool);
        if (line === lastBumperLine && pool.length > 1) {
            line = pickRandom(pool.filter(candidate => candidate !== line));
        }
        lastBumperLine = line;
        return line;
    }

    setInterval(() => setBumperText(nextBumperLine()), 9000);

    // 3. Player Status (Animation & Play/Pause State)
    function setPlaying(playing) {
        ui.console.classList.toggle("playing", playing);
        ui.play.setAttribute("aria-label", playing ? "Pause" : "Play");
        ui.play.setAttribute("title", playing ? "Pause" : "Play");
        if (playing) {
            playbackStarted = true;
            safarChanging = false;
            clearTimeout(safarTimer);
            startProgress(ui);
        } else {
            stopProgress();
        }
        isPlayingNow = playing;
        refreshLedStatus(false);
    }

    // 3b. Lazy-loading connection state
    function setConnecting(on) {
        if (connecting === on) return;
        connecting = on;
        ui.console.classList.toggle("connecting", on);
        if (on) ui.title.textContent = "Connecting to the road…";
    }

    // 3c. V3.1 — Live LED Status Display (single deterministic source of truth)
    const LED_MSG = {
        welcome: "Welcome to Radio Safar ✨",
        default: "Radio Safar On Air 📻",
        playing: "Radio Safar is Playing 🎵",
        paused: "Music Paused ⏸️",
        muted: "Music Muted 🔇",
        rain: "Monsoon Highway Rain 🌧️",
        rainPlaying: "Rainy Safar in Progress 🌧️🎵",
        ticket: "Ticket Ready 🎫",
        loading: "New Safar Loading 🛣️"
    };

    const vuBadge = ui.vuStrip ? ui.vuStrip.querySelector(".vu-center-badge") : null;
    let ledPendingText = "";
    let ledWriteTimer = null;

    function computeLedStatus() {
        if (ticketPlanOpen) return LED_MSG.ticket;
        if (rainOn) return isPlayingNow ? LED_MSG.rainPlaying : LED_MSG.rain;
        if (safarChanging) return LED_MSG.loading;
        if (isPlayingNow) return mutedNow ? LED_MSG.muted : LED_MSG.playing;
        return playbackStarted ? LED_MSG.paused : LED_MSG.default;
    }

    function writeLedStatus(text) {
        if (vuBadge && vuBadge.textContent !== text) vuBadge.textContent = text;
        const live = !ledWelcomeOver || isPlayingNow;
        ui.console.classList.toggle("led-live", live);
    }

    function refreshLedStatus(immediate) {
        const text = ledWelcomeOver ? computeLedStatus() : LED_MSG.welcome;
        if (immediate) {
            clearTimeout(ledWriteTimer);
            ledPendingText = text;
            writeLedStatus(text);
            return;
        }
        if (ledPendingText === text) return;
        ledPendingText = text;
        clearTimeout(ledWriteTimer);
        ledWriteTimer = setTimeout(() => writeLedStatus(text), 220);
    }

    refreshLedStatus(true);
    setTimeout(() => {
        ledWelcomeOver = true;
        refreshLedStatus(true);
    }, 2800);

    // 4. Switch Mood Playlist
    function switchMood(key) {
        const mood = MOOD_PLAYLISTS[key];
        if (!mood || !player || !ready) return false;
        if (key === activeMood && !playlistSwitching) {
            closeMoodModal(ui);
            return false;
        }

        const newMood = selectSafar(key, {
            onReady() {
                if (activeMood !== key || requestedPlaylistId !== mood.id) return;
                syncPlaylistFromPlayer(ui, () => {
                    renderPlaylist(ui, playlistIds, currentIndex, metadata, onTrackSelect);
                    updateActive(ui, currentIndex);
                });
                updateMetadata(ui, () => updateActive(ui, currentIndex));
                updateProgress(ui);
            }
        });

        if (!newMood) return false;

        // V3.1 — transient "New Safar Loading" status until the new playlist plays
        safarChanging = true;
        clearTimeout(safarTimer);
        safarTimer = setTimeout(() => {
            safarChanging = false;
            if (player && ready && player.getPlayerState() === YT.PlayerState.PLAYING) {
                setPlaying(true);
            } else {
                refreshLedStatus(false);
            }
        }, 7000);
        refreshLedStatus(true);

        updateMoodButton(ui, activeMood);
        $("playlistHeading").textContent = mood.playlistTitle;
        resetPlaylistState(ui);
        renderMoodList(ui, activeMood, switchMood);
        closeMoodModal(ui);
        return true;
    }

    function onTrackSelect(index) {
        if (playlistSwitching) return;
        setCurrentIndex(index);
        player.playVideoAt(index);
        updateActive(ui, index);
        closePlaylistModal(ui);
    }

    // 5. Minimize Toggle (Fixed-Coordinates)
    function updateMinimizeButton() {
        if (!ui.minimizeButton) return;
        ui.minimizeButton.setAttribute("aria-pressed", String(playerMinimized));
        ui.minimizeButton.setAttribute("aria-label", playerMinimized ? "Expand player" : "Minimize player");
        ui.minimizeButton.setAttribute("aria-expanded", String(!playerMinimized));
        ui.minimizeButton.setAttribute("title", playerMinimized ? "Expand player" : "Minimize player");
    }

    function togglePlayerMinimized() {
        playerMinimized = !playerMinimized;
        ui.console.classList.toggle("player-minimized", playerMinimized);
        updateMinimizeButton();
    }

    // 6. Transport Controls & Listeners
    function togglePlay() {
        if (!player) {
            setConnecting(true);
        }
        if (player && ready && player.getPlayerState() === YT.PlayerState.PLAYING) {
            pause();
        } else {
            play();
        }
    }

    ui.play.addEventListener("click", togglePlay);

    ui.prev.addEventListener("click", () => cmdPrevious());

    ui.next.addEventListener("click", () => cmdNext());

    ui.shuffle.addEventListener("click", () => {
        const isNowShuffled = toggleShuffle();
        ui.shuffle.setAttribute("aria-pressed", String(isNowShuffled));
    });

    // AI Safar — sync visual UI from existing state getters after a dispatched action
    // (shuffle indicator, mood button, playlist heading). Never stores its own copy
    // of player state; reads only from the command layer / youtube.js.
    function syncAiUi() {
        ui.shuffle.setAttribute("aria-pressed", String(isShuffleOn()));
        updateMoodButton(ui, activeMood);
        $("playlistHeading").textContent = MOOD_PLAYLISTS[activeMood]?.playlistTitle || "";
    }
    registerAiSwitchSafarHandler(key => switchMood(key));
    registerAiUiSync(syncAiUi);

    ui.horn.addEventListener("click", () =>
        playBusHorn(
            () => ui.horn.classList.add("horn-active"),
            () => ui.horn.classList.remove("horn-active")
        ));

    function applyMuteState(muted) {
        mutedNow = muted === true;
        if (!ui.muteBtn) return;
        ui.muteBtn.classList.toggle("is-muted", muted === true);
        ui.muteBtn.setAttribute("aria-pressed", String(muted === true));
        ui.muteBtn.setAttribute("aria-label", muted === true ? "Unmute" : "Mute");
        ui.muteBtn.setAttribute("title", muted === true ? "Unmute" : "Mute");
        refreshLedStatus(false);
    }

    ui.muteBtn.addEventListener("click", () => {
        const nowMuted = toggleMute();
        if (nowMuted === null) return;
        applyMuteState(nowMuted);
    });

    ui.mood.addEventListener("click", () => openMoodModal(ui, () => renderMoodList(ui, activeMood, switchMood)));
    ui.moodClose.addEventListener("click", () => closeMoodModal(ui));
    ui.moodModal.addEventListener("click", event => {
        if (event.target === ui.moodModal) closeMoodModal(ui);
    });

    ui.playlistButton.addEventListener("click", () =>
        openPlaylistModal(ui, activeMood, () => renderPlaylist(ui, playlistIds, currentIndex, metadata, onTrackSelect)));
    ui.close.addEventListener("click", () => closePlaylistModal(ui));
    ui.modal.addEventListener("click", event => {
        if (event.target === ui.modal) closePlaylistModal(ui);
    });

    ui.infoButton.addEventListener("click", () => openInfoModal(ui));
    ui.infoClose.addEventListener("click", () => closeInfoModal(ui));
    ui.infoModal.addEventListener("click", event => {
        if (event.target === ui.infoModal) closeInfoModal(ui);
    });

    ui.minimizeButton.addEventListener("click", togglePlayerMinimized);

    // 7a. Rain Mode — "Monsoon Highway Rain".
//     A full-viewport <canvas> layer is rasterized by JS every frame: it is
//     guaranteed to render regardless of CSS animation quirks or the global
//     reduced-motion override (which collapses CSS keyframe animations).
//     Audio uses ONE shared Audio('/rain.mp3') element; OFF pauses it, ON again
//     resumes the same instance from where it stopped.
    const RAIN_AUDIO_SRC = "/rain.mp3";
    const RAIN_VOLUME = 0.18;

    function rainLabel() {
        const label = ui.rainBtn.querySelector(".rain-btn__label");
        if (label) label.textContent = rainOn ? "Rain ON" : "Rain";
        ui.rainBtn.setAttribute("aria-pressed", String(rainOn));
        ui.rainBtn.setAttribute("title", rainOn ? "Rain ON — tap to stop" : "Rain");
        ui.rainBtn.setAttribute("aria-label", rainOn ? "Turn rain mode off" : "Turn rain mode on");
    }

    function placeRainButton() {
        const btn = ui.rainBtn;
        if (!btn) return;
        const rect = ui.console.getBoundingClientRect();
        if (rect.left >= 96) {
            // Free space on both sides → keep the button pinned in the corner.
            btn.style.left = "";
            btn.style.bottom = "";
            btn.classList.remove("rain-btn--lifted");
        } else {
            // Player spans the width → float the button just above it.
            btn.style.left = "10px";
            btn.style.bottom = String(Math.max(10, window.innerHeight - rect.top + 10)) + "px";
            btn.classList.add("rain-btn--lifted");
        }
    }

    const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const rainState = {
        canvas: null,
        ctx: null,
        drops: [],
        running: false,
        raf: 0,
        last: 0
    };

    function rainDropCount() {
        const area = window.innerWidth * window.innerHeight;
        const n = Math.round(area / 12000);
        return Math.max(120, Math.min(250, n));
    }

    function spawnRainDrops(count) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const drops = [];
        for (let i = 0; i < count; i++) {
            const big = Math.random() < 0.06;
            drops.push({
                x: Math.random() * w,
                y: Math.random() * h,
                len: big ? 22 + Math.random() * 16 : 10 + Math.random() * 18,
                speed: (big ? 1.4 : 0.7) + Math.random() * 1.1,
                width: big ? 2 : Math.random() < 0.3 ? 1.5 : 1,
                opacity: big ? 0.5 + Math.random() * 0.28 : 0.2 + Math.random() * 0.38,
                wind: 0.06 + Math.random() * 0.16
            });
        }
        return drops;
    }

    function sizeRainCanvas() {
        if (!rainState.canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        rainState.canvas.width = Math.round(window.innerWidth * dpr);
        rainState.canvas.height = Math.round(window.innerHeight * dpr);
        rainState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function buildRainCanvas() {
        const canvas = document.createElement("canvas");
        canvas.className = "rain-canvas";
        canvas.setAttribute("aria-hidden", "true");
        document.body.append(canvas);
        rainState.canvas = canvas;
        rainState.ctx = canvas.getContext("2d");
        sizeRainCanvas();
        rainState.drops = spawnRainDrops(rainDropCount());
        window.addEventListener("resize", () => {
            sizeRainCanvas();
            if (rainState.running && reducedMotion && rainState.drops.length) {
                drawRainFrame();
            }
        });
    }

    function advanceRain(dt) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        for (const d of rainState.drops) {
            d.y += d.speed * 3.4 * dt;
            d.x += d.wind * d.speed * 3.4 * dt;
            if (d.y - d.len > h) {
                d.y = -d.len - Math.random() * 40;
                d.x = Math.random() * w;
            }
            if (d.x > w + 60) d.x = -60;
            if (d.x < -60) d.x = w + 60;
        }
    }

    function drawRainFrame() {
        const ctx = rainState.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        for (const d of rainState.drops) {
            const slant = d.wind * d.len * 0.6;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x + slant, d.y + d.len);
            ctx.strokeStyle = `rgba(202, 224, 242, ${d.opacity.toFixed(3)})`;
            ctx.lineWidth = d.width;
            ctx.lineCap = "round";
            ctx.stroke();
        }
    }

    function stepRain(timestamp) {
        if (!rainState.running) return;
        const dt = rainState.last ? Math.min((timestamp - rainState.last) / 16.667, 3) : 1;
        rainState.last = timestamp;
        advanceRain(dt);
        drawRainFrame();
        rainState.raf = requestAnimationFrame(stepRain);
    }

    function startRainVisuals() {
        if (rainState.canvas) return;
        buildRainCanvas();
        rainState.running = true;
        if (reducedMotion) {
            // Reduced motion: show a calm static drizzle — still clearly visible.
            rainState.last = 0;
            drawRainFrame();
        } else {
            rainState.last = 0;
            rainState.raf = requestAnimationFrame(stepRain);
        }
    }

    function stopRainVisuals() {
        rainState.running = false;
        if (rainState.raf) cancelAnimationFrame(rainState.raf);
        rainState.raf = 0;
        rainState.canvas?.remove();
        rainState.canvas = null;
        rainState.ctx = null;
        rainState.drops = [];
    }

    let rainAudioBroken = false;
    function startRainAudio() {
        if (!rainAudio) {
            rainAudio = new Audio(RAIN_AUDIO_SRC);
            rainAudio.loop = true;
            rainAudio.volume = RAIN_VOLUME;
            rainAudio.preload = "auto";
            rainAudio.addEventListener("error", () => {
                rainAudioBroken = true;
            });
        }
        if (rainAudioBroken) return;
        rainAudio.play().catch(() => {
            // play() may reject while the mp3 is still loading. Retry once as
            // soon as the asset can actually play, so audio is never silent.
            if (rainAudio.dataset.retried) return;
            rainAudio.dataset.retried = "1";
            rainAudio.addEventListener("canplay", () => {
                rainAudio.play().catch(() => { /* best effort */ });
            }, { once: true });
        });
    }

    function stopRainAudio() {
        if (rainAudio && !rainAudio.paused) {
            rainAudio.pause();
        }
    }

    function toggleRain() {
        rainOn = !rainOn;
        if (rainOn) {
            startRainVisuals();
            startRainAudio();
            flashBumperMessage("🌧️ बारिश शुरू… सफर जारी।");
        } else {
            stopRainVisuals();
            stopRainAudio();
            flashBumperMessage("☀️ बारिश रुकी… सफर जारी।");
        }
        rainLabel();
        refreshLedStatus(false);
    }

    ui.rainBtn.addEventListener("click", toggleRain);
    window.addEventListener("resize", placeRainButton);
    placeRainButton();
    rainLabel();

    // 7. Scrubber / Seekbar Listeners
  // Seekbar — debounced, fires only ONCE on release
    let seekCommitted = false;

    ui.seek.addEventListener("pointerdown", () => {
        setSeekingState(true);
        seekCommitted = false;
        ui.console.classList.add("seeking");     // ← pause animations while dragging
    });

    ui.seek.addEventListener("input", () => {
        setSeekingState(true);
        ui.current.textContent = formatTime(ui.seek.value);
    });

    ui.seek.addEventListener("pointerup", () => {
        ui.console.classList.remove("seeking");  // ← resume animations after seek
        if (!seekCommitted) {
            seekCommitted = true;
            commitSeek(ui);
        }
    });

    // Fallback for desktop mouse — only fires if pointerup didn't already handle it
    ui.seek.addEventListener("change", () => {
        if (!seekCommitted) {
            seekCommitted = true;
            commitSeek(ui);
        }
    });

    // 8. Keyboard Shortcuts
    document.addEventListener("keydown", event => {
        const target = event.target;
        if (event.code === "Space" &&
            !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target?.tagName) &&
            !isAiOpen() &&
            !ui.modal.classList.contains("open") &&
            !ui.moodModal.classList.contains("open") &&
            !ui.infoModal.classList.contains("open") &&
            !ui.ticketModal.classList.contains("open")) {
            event.preventDefault();
            togglePlay();
            return;
        }
        if (event.key === "Escape") {
            closePlaylistModal(ui);
            closeMoodModal(ui);
            closeInfoModal(ui);
            closeTicketModal(ui);
        }
    });

    // 9. Initialize YouTube Player
    initYouTubePlayer(ui, {
        onReady() {
            updateMoodButton(ui, activeMood);
            $("playlistHeading").textContent = MOOD_PLAYLISTS[activeMood].playlistTitle;
            syncPlaylistFromPlayer(ui, () => {
                renderPlaylist(ui, playlistIds, currentIndex, metadata, onTrackSelect);
                updateActive(ui, currentIndex);
            });
            updateMetadata(ui, () => updateActive(ui, currentIndex));
            updateProgress(ui);
        },
        onStateChange(event) {
            const state = event.data;
            if (playlistSwitching) {
                if (state === YT.PlayerState.PLAYING ||
                    state === YT.PlayerState.CUED ||
                    state === YT.PlayerState.BUFFERING) {
                    if (state === YT.PlayerState.PLAYING) {
                        safarChanging = false;
                        clearTimeout(safarTimer);
                    }
                    return;
                }
            }
            if (state === YT.PlayerState.PLAYING) {
                setConnecting(false);
                updateMetadata(ui, () => updateActive(ui, currentIndex));
                setPlaying(true);
            } else if (state === YT.PlayerState.PAUSED) {
                setPlaying(false);
            } else if (state === YT.PlayerState.CUED) {
                setConnecting(false);
                updateMetadata(ui, () => updateActive(ui, currentIndex));
            } else if (state === YT.PlayerState.ENDED) {
                setPlaying(false);
            }
        }
    });

    // 10. Live Presence (+555) — dynamic, presentation-only change
    window.addEventListener("load", () => {
        initPresence(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, count => {
            ui.online.textContent = `🟢 ${count} मुसाफ़िर`;
        });
    });

    updateMinimizeButton();
})();
