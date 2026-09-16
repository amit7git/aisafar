/**
 * सफ़र साथी — Radio Safar floating radio companion (RJ) UI.
 *
 * Music is the hero; सफ़र साथी is a compact floating companion. This module is
 * self-contained: it owns its launcher + chat panel DOM, follows the existing
 * warm/amber Radio Safar visual language and never touches the player directly.
 * AI actions are validated, dispatched through a strict client-side whitelist,
 * and routed to the command layer.
 */

import { requestAiSafar } from '../services/ai-api.js';
import { dispatchAiActions } from '../services/ai-actions.js';
import { getPlayerSnapshot } from '../services/radio-commands.js';

const STARTERS = [
    "Play a 90s Safar",
    "Play Bhojpuri songs",
    "Play something romantic",
    "Play a random Safar",
    "Skip this song",
    "Pause the music"
];

const GREETING =
    "Namaste Musafir! 👋\n" +
    "Main hoon Safar Saathi — aapka radio companion.\n" +
    "Bolo, aaj kis safar pe chalein? 🛻";

// Last line of defense: if the server somehow returns an Indic-script message,
// show a Latin-friendly fallback instead so the chat always stays in English/
// Roman Hinglish. Structured actions are untouched — they still execute.
const INDIC_SCRIPT_RE = new RegExp(
    '[' +
    '\\u0900-\\u097F' + '\\u0980-\\u09FF' +
    '\\u0A00-\\u0A7F' + '\\u0A80-\\u0AFF' +
    '\\u0B00-\\u0B7F' + '\\u0B80-\\u0BFF' +
    '\\u0C00-\\u0C7F' + '\\u0C80-\\u0CFF' +
    '\\u0D00-\\u0D7F' +
    ']'
);

function hasIndicScript(text) {
    return typeof text === "string" && INDIC_SCRIPT_RE.test(text);
}

function latinSafe(text, fallback) {
    return hasIndicScript(text) ? fallback : text;
}

const CLIENT_LATIN_FALLBACK = "Got it. Let me keep the journey in English script. What would you like to play?";

let module = { open: false };
let refs = null;
let busy = false;
let controller = null;
let hasExchanged = false;

const SUBMIT_MIN_INTERVAL_MS = 2500;
let lastSubmitAt = 0;

function $(id) {
    return document.getElementById(id);
}

function setBusyUi() {
    if (!refs) return;
    refs.input.disabled = busy;
    refs.send.disabled = busy;
    refs.send.setAttribute("aria-busy", String(busy));
}

function appendMessage(text, kind) {
    if (!refs) return;
    const wrap = document.createElement("div");
    wrap.className = `ai-msg ai-msg--${kind}`;
    const p = document.createElement("p");
    p.textContent = text;
    wrap.append(p);
    refs.thread.append(wrap);
    refs.thread.scrollTop = refs.thread.scrollHeight;
}

function appendTyping() {
    if (!refs) return;
    const wrap = document.createElement("div");
    wrap.className = "ai-msg ai-msg--ai ai-msg--typing";
    wrap.innerHTML =
        `<div class="sound-wave"><span></span><span></span><span></span></div>`;
    refs.thread.append(wrap);
    refs.thread.scrollTop = refs.thread.scrollHeight;
}

function removeTyping() {
    if (!refs) return;
    const typing = refs.thread.querySelector(".ai-msg--typing");
    if (typing) typing.remove();
}

function renderStarters() {
    if (!refs) return;
    refs.starters.replaceChildren();
    STARTERS.forEach(text => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "ai-chip";
        chip.textContent = text;
        chip.addEventListener("click", () => submit(text));
        refs.starters.append(chip);
    });
}

function showStarters() {
    if (refs) refs.starters.classList.remove("ai-starters--hidden");
}

function hideStarters() {
    if (refs) refs.starters.classList.add("ai-starters--hidden");
}

async function submit(message) {
    const text = String(message || "").trim();
    if (!text || busy || !refs) return;

    const now = Date.now();
    if (now - lastSubmitAt < SUBMIT_MIN_INTERVAL_MS) return;
    lastSubmitAt = now;

    if (!hasExchanged) {
        hasExchanged = true;
        hideStarters();
    }

    const userBubble = document.createElement("div");
    userBubble.className = "ai-msg ai-msg--user";
    const p = document.createElement("p");
    p.textContent = text;
    userBubble.append(p);
    refs.thread.append(userBubble);
    refs.thread.scrollTop = refs.thread.scrollHeight;

    refs.input.value = "";
    busy = true;
    setBusyUi();
    appendTyping();

    controller = new AbortController();

    try {
        const result = await requestAiSafar(text, controller.signal, getPlayerSnapshot());
        const dispatch = dispatchAiActions(result.actions);
        console.log("[SAFAR SAATHI] dispatched:", JSON.stringify(dispatch));
        removeTyping();
        appendMessage(
            latinSafe(result.message, CLIENT_LATIN_FALLBACK) || "Ho gaya bhai, safar shuru! 🎵",
            "ai"
        );
        if (dispatch.rejected.length) {
            appendMessage(
                "P.S. Ek-do command safar pe nahi lag paye — bas wahi bataya jo radio samajh sakta hai. 🎙️",
                "ai"
            );
        }
    } catch (error) {
        if (error && error.name === "AbortError") {
            removeTyping();
            return;
        }
        removeTyping();
        appendMessage(error.message || "Kuch alag ho gaya. Phir se try kariye, musafir!", "error");
    } finally {
        busy = false;
        setBusyUi();
        controller = null;
        if (refs) refs.input.focus();
    }
}

export function isAiOpen() {
    return module.open && refs && refs.modal.classList.contains("open");
}

export function openAi() {
    if (!refs || isAiOpen()) return;
    module.open = true;
    refs.modal.classList.add("open");
    refs.modal.setAttribute("aria-hidden", "false");
    refs.button.classList.add("saathi-launcher--active");
    refs.button.setAttribute("aria-expanded", "true");
    if (!refs.thread.children.length) {
        appendMessage(GREETING, "ai");
        renderStarters();
        showStarters();
    }
    refs.input.focus();
}

export function closeAi() {
    if (!refs || !module.open) return;
    if (controller) {
        controller.abort();
        controller = null;
    }
    module.open = false;
    refs.modal.classList.remove("open");
    refs.modal.setAttribute("aria-hidden", "true");
    refs.button.classList.remove("saathi-launcher--active");
    refs.button.setAttribute("aria-expanded", "false");
    refs.button.focus();
}

export function initAiSafar() {
    refs = {
        button: $("aiBtn"),
        modal: $("aiModal"),
        thread: $("aiThread"),
        starters: $("aiStarters"),
        input: $("aiInput"),
        send: $("aiSend"),
        close: $("closeAi")
    };
    if (!refs.button || !refs.modal) return;

    refs.button.setAttribute("aria-expanded", "false");
    refs.button.addEventListener("click", () => {
        isAiOpen() ? closeAi() : openAi();
    });
    refs.close.addEventListener("click", closeAi);
    refs.send.addEventListener("click", event => {
        event.preventDefault();
        submit(refs.input.value);
    });
    refs.input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            submit(refs.input.value);
        }
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && isAiOpen()) {
            event.stopPropagation();
            closeAi();
        }
    });
}