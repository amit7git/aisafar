import { MOOD_PLAYLISTS } from '../config/playlists.js';

let restoreFocus = null;
let restoreMoodFocus = null;
let trackSelectHandler = null;
let playlistListBound = null;
let trappedPanel = null;

export function renderMoodList(ui, activeMood, onSwitchMood) {
    const fragment = document.createDocumentFragment();
    Object.entries(MOOD_PLAYLISTS).forEach(([key, mood]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `playlist-item${key === activeMood ? " active" : ""}`;
        button.innerHTML =
            `<span class="number">${key === activeMood ? "●" : "○"}</span>` +
            `<span class="song-info"><span class="song"></span><span class="song-artist"></span></span>`;
        button.querySelector(".song").textContent = mood.label;
        button.querySelector(".song-artist").textContent = mood.description;
        button.setAttribute("aria-label", `Switch to ${mood.label} playlist`);
        button.addEventListener("click", () => onSwitchMood(key));
        fragment.append(button);
    });
    ui.moodList.replaceChildren(fragment);
    ui.moodCount.textContent = `${Object.keys(MOOD_PLAYLISTS).length} SAFAR PLAYLISTS AVAILABLE`;
}

export function updateMoodButton(ui, activeMood) {
    const mood = MOOD_PLAYLISTS[activeMood];
    const currentMood = mood?.label || activeMood;
    const moodCurrent = document.getElementById("moodCurrent");
    if (moodCurrent) moodCurrent.textContent = currentMood;
    ui.mood.setAttribute("aria-label", `Open mood selector. Current mood: ${currentMood}`);
}

export function renderPlaylist(ui, playlistIds, currentIndex, metadata, onTrackSelect) {
    if (!playlistListBound) {
        playlistListBound = true;
        trackSelectHandler = onTrackSelect;
        ui.list.addEventListener("click", event => {
            const item = event.target.closest(".playlist-item");
            if (!item) return;
            const index = Number(item.dataset.index);
            if (Number.isInteger(index) && trackSelectHandler) {
                trackSelectHandler(index);
            }
        });
    } else {
        trackSelectHandler = onTrackSelect;
    }

    const fragment = document.createDocumentFragment();
    playlistIds.forEach((id, index) => {
        const info = metadata.get(id) || { title: `Loading track ${index + 1}…`, artist: "Loading artist…" };
        const button = document.createElement("button");
        button.type = "button";
        button.className = `playlist-item${index === currentIndex ? " active" : ""}`;
        button.dataset.index = String(index);
        button.innerHTML =
            `<span class="number">${String(index + 1).padStart(2, "0")}</span>` +
            `<span class="song-info"><span class="song"></span><span class="song-artist"></span></span>`;
        button.querySelector(".song").textContent = info.title;
        button.querySelector(".song-artist").textContent = info.artist;
        fragment.append(button);
    });
    ui.list.replaceChildren(fragment);
}

export function updateActive(ui, currentIndex) {
    ui.list.querySelectorAll(".playlist-item").forEach((item, index) => {
        item.classList.toggle("active", index === currentIndex);
    });
}

/* ===== Focus management: trap + inert background ===== */
function setBackdropInert(inert) {
    document.querySelectorAll("main.player, header.header").forEach(el => {
        if (inert) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
    });
}

function trapKeydown(event) {
    if (event.key !== "Tab" || !trappedPanel) return;
    const focusables = Array.from(
        trappedPanel.querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])")
    ).filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
        if (active === first || !trappedPanel.contains(active)) {
            event.preventDefault();
            last.focus();
        }
    } else if (active === last || !trappedPanel.contains(active)) {
        event.preventDefault();
        first.focus();
    }
}

function trapFocus(panel) {
    if (trappedPanel) return;
    trappedPanel = panel;
    document.addEventListener("keydown", trapKeydown, true);
}

function releaseTrap() {
    if (!trappedPanel) return;
    document.removeEventListener("keydown", trapKeydown, true);
    trappedPanel = null;
}

export function openPlaylistModal(ui, activeMood, onRender) {
    document.getElementById("playlistHeading").textContent =
        MOOD_PLAYLISTS[activeMood]?.playlistTitle || "RADIO SAFAR PLAYLIST";
    restoreFocus = document.activeElement;
    ui.modal.classList.add("open");
    ui.modal.setAttribute("aria-hidden", "false");
    setBackdropInert(true);
    trapFocus(ui.modal);
    if (onRender) onRender();
    ui.close.focus();
}

export function closePlaylistModal(ui) {
    if (!ui.modal.classList.contains("open")) return;
    ui.modal.classList.remove("open");
    ui.modal.setAttribute("aria-hidden", "true");
    releaseTrap();
    setBackdropInert(false);
    restoreFocus?.focus();
}

export function openMoodModal(ui, onRender) {
    restoreMoodFocus = document.activeElement;
    if (onRender) onRender();
    ui.moodModal.classList.add("open");
    ui.moodModal.setAttribute("aria-hidden", "false");
    setBackdropInert(true);
    trapFocus(ui.moodModal);
    ui.moodClose.focus();
}

export function closeMoodModal(ui) {
    if (!ui.moodModal.classList.contains("open")) return;
    ui.moodModal.classList.remove("open");
    ui.moodModal.setAttribute("aria-hidden", "true");
    releaseTrap();
    setBackdropInert(false);
    restoreMoodFocus?.focus();
}

export function openInfoModal(ui) {
    ui.infoModal.classList.add("open");
    ui.infoModal.setAttribute("aria-hidden", "false");
    setBackdropInert(true);
    trapFocus(ui.infoModal);
    ui.infoClose.focus();
}

export function closeInfoModal(ui) {
    if (!ui.infoModal.classList.contains("open")) return;
    ui.infoModal.classList.remove("open");
    ui.infoModal.setAttribute("aria-hidden", "true");
    releaseTrap();
    setBackdropInert(false);
}