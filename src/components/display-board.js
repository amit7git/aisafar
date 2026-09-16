/* Radio Safar — Display Board (top-centre compact journey board)
 *
 * A lightweight, presentation-only digital journey display. It shows a
 * simulated highway/radio display with:
 *   - a rotating slate of NEON digital messages (welcome, music, ticket,
 *     radio-safar announcements)
 *   - simulated journey telemetry: speed + current/next city (SIMULATED —
 *     not real GPS; the site has no geolocation source and this never claims
 *     to be one)
 *   - live listener count (single source: the existing Supabase presence
 *     callback, fed in by main.js — this module never opens its own channel)
 *
 * Sequence:
 *   1. WELCOME (WELCOME TO RADIO SAFAR / AMIT) — shown once on load, held
 *      ~8s so it is noticed, then the journey/music rotation begins.
 *   2. Journey/telemetry and short announcements alternate calmly (~8s each).
 * City pairs advance only every ~2.5–3 minutes with jitter; speed can change
 * more often (every ~2.4s). Timers are cheap and pause while the document is
 * hidden. No requestAnimationFrame; reduced-motion is handled in CSS.
 */

const ROUTE = [
    { from: "BENGALURU", to: "TUMAKURU" },
    { from: "TUMAKURU", to: "CHITRADURGA" },
    { from: "CHITRADURGA", to: "DAVANAGERE" },
    { from: "DAVANAGERE", to: "HUBBALLI" },
    { from: "HUBBALLI", to: "DHARWAD" },
    { from: "DHARWAD", to: "BELAGAVI" },
    { from: "BELAGAVI", to: "BENGALURU" }
];

const SPEED_MIN = 62;
const SPEED_MAX = 84;
const SPEED_TICK_MS = 2400;

/* Announcement pools (drawn in rotation). " • "/" — " split a message onto
   the board's two lines; single-line messages keep the route on line 2. */
const MUSIC_MESSAGES = [
    "YOUR MUSICAL JOURNEY STARTS HERE",
    "ENJOY THE RIDE • ENJOY THE MUSIC",
    "MUSIC FOR EVERY MILE",
    "TUNE IN • SIT BACK • ENJOY",
    "YOUR JOURNEY • YOUR MUSIC",
    "TRAVEL • MUSIC • MEMORIES",
    "ENJOY YOUR SAFAR 🎵",
    "LIVE ON THE ROAD • LIVE WITH MUSIC",
    "DISCOVER YOUR NEXT MUSICAL MILE",
    "NOW PLAYING • RADIO SAFAR",
    "KEEP YOUR SEAT • KEEP THE MUSIC ON"
];

const TICKET_MESSAGE = "PLEASE BOOK YOUR TICKET 🎫";

const RADIO_MESSAGES = [
    "RADIO SAFAR • EVERY MOOD HAS A JOURNEY",
    "EVERY MOOD HAS A JOURNEY"
];

/* Journey returns every other slot so speed + position stay prominent. */
const MODES = ["journey", "music", "journey", "ticket", "journey", "radio"];

const WELCOME_MS = 8000;
const MODE_MS = 8000;
const CITY_MS_MIN = 150000; /* ~2.5 min */
const CITY_MS_MAX = 180000; /* ~3 min */

export function initDisplayBoard() {
    const board = document.getElementById("displayBoard");
    const line1 = document.getElementById("dbLine1");
    const line2 = document.getElementById("dbLine2");
    const onlineEl = document.getElementById("dbOnline");

    if (!board || !line1 || !line2 || !onlineEl) {
        return { setOnline() {} };
    }

    let onlineCount = parseInt(onlineEl.textContent, 10) || 0;
    let routeIndex = 0;
    let speed = 68 + Math.floor(Math.random() * 8);
    let modeIndex = 0;
    let musicIndex = 0;
    let radioIndex = 0;
    let currentMode = "welcome";
    let welcomeDone = false;
    let running = true;
    let welcomeTimer = null;
    let speedTimer = null;
    let modeTimer = null;
    let cityTimer = null;

    function renderJourney() {
        currentMode = "journey";
        const leg = ROUTE[routeIndex % ROUTE.length];
        line1.textContent = leg.from + " → " + leg.to;
        line2.textContent =
            String(speed).padStart(2, "0") + " KM/H  •  ● LIVE " + onlineCount;
    }

    function splitMessage(text) {
        const sepIdx = text.indexOf(" • ");
        const globalIdx = sepIdx === -1 ? text.indexOf(" — ") : -1;
        const idx = sepIdx !== -1 ? sepIdx : globalIdx;
        if (idx !== -1) {
            return [text.slice(0, idx), text.slice(idx + 3)];
        }
        return [text, ""];
    }

    function renderMessage(text) {
        currentMode = "message";
        const parts = splitMessage(text);
        line1.textContent = parts[0];
        line2.textContent = parts[1];
        if (!parts[1]) {
            const leg = ROUTE[routeIndex % ROUTE.length];
            line2.textContent = leg.from + " → " + leg.to;
        }
    }

    function renderMode() {
        if (!running) return;
        const mode = MODES[modeIndex % MODES.length];
        modeIndex += 1;
        switch (mode) {
            case "journey":
                renderJourney();
                break;
            case "music":
                renderMessage(MUSIC_MESSAGES[musicIndex % MUSIC_MESSAGES.length]);
                musicIndex += 1;
                break;
            case "ticket":
                renderMessage(TICKET_MESSAGE);
                break;
            case "radio":
                renderMessage(RADIO_MESSAGES[radioIndex % RADIO_MESSAGES.length]);
                radioIndex += 1;
                break;
        }
        modeTimer = setTimeout(renderMode, MODE_MS);
    }

    /* Smooth random-walk speed — an easy, believable cruise, never abrupt. */
    function stepSpeed() {
        const roll = Math.random();
        let step = 0;
        if (roll < 0.45) {
            step = 0;
        } else if (roll < 0.8) {
            step = Math.random() < 0.5 ? -1 : 1;
        } else {
            step = (Math.random() < 0.5 ? -1 : 1) * 2;
        }
        speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed + step));
    }

    function cityDelay() {
        return CITY_MS_MIN + Math.random() * (CITY_MS_MAX - CITY_MS_MIN);
    }

    function advanceCity() {
        routeIndex = (routeIndex + 1) % ROUTE.length;
        cityTimer = setTimeout(advanceCity, cityDelay());
    }

    /* The welcome frame is paused on every resume until its WELCOME_MS is up */
    function stopTimers() {
        clearTimeout(welcomeTimer);
        clearInterval(speedTimer);
        clearTimeout(modeTimer);
        clearTimeout(cityTimer);
        welcomeTimer = speedTimer = modeTimer = cityTimer = null;
    }

    function startTimers() {
        stopTimers();
        speedTimer = setInterval(stepSpeed, SPEED_TICK_MS);
        cityTimer = setTimeout(advanceCity, cityDelay());

        if (!welcomeDone) {
            welcomeDone = true;
            line1.textContent = "WELCOME TO RADIO SAFAR";
            line2.textContent = "AMIT";
            welcomeTimer = setTimeout(() => {
                welcomeTimer = null;
                modeIndex = 0;
                renderMode();
            }, WELCOME_MS);
        } else {
            renderMode();
        }
    }

    function pause() {
        if (!running) return;
        running = false;
        stopTimers();
    }

    function resume() {
        if (running) return;
        running = true;
        startTimers();
    }

    function onVisibility() {
        if (document.hidden) {
            pause();
        } else {
            resume();
        }
    }

    document.addEventListener("visibilitychange", onVisibility);

    startTimers();

    return {
        /* Mirrors the single existing presence counter (main.js owns the real
           Supabase channel); this only writes the digits on the board. */
        setOnline(count) {
            onlineCount = count;
            onlineEl.textContent = String(count);
            if (currentMode === "journey") renderJourney();
        }
    };
}