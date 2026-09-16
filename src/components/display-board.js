/* Radio Safar — Display Board (top-centre premium coach LED board)
 *   Restyled to read like a luxury intercity bus / airport LED information
 *   panel. One rotating main status line; a clean CURRENT → NEXT route row
 *   (CURRENT in cool cyan, NEXT in warm amber); and a bottom telemetry
 *   row (speed left, live listener count right). No player status was kept.
 *
 *   - A main rotating line: calm JOURNEY / MUSIC / TICKET messages at a calm
 *     ~8s cadence (welcome shows first for ~8s).
 *   - A persistent route row: CURRENT → NEXT. The SIMULATED journey is picked
 *     at random ONCE per session and loops on the same route (the site has no
 *     geolocation source; this never claims to be real GPS).
 *   - Telemetry (LAST row, always visible): simulated speed (left) + green
 *     blinking LIVE listener count (right). The count is the single existing
 *     Supabase presence value fed in by main.js via setOnline — this module
 *     never opens its own channel. The LIVE dot is the board's only animated
 *     accent.
 *
 *   Speed is tied to whether the music is actually playing: main.js feeds
 *   PLAYING / NOT PLAYING via setPlaying. While music plays, the speed does a
 *   smooth random walk 62–84 km/h; the moment playback stops (paused, ended,
 *   or never started) the speed reads 0 KM/H — no stale number on screen.
 *
 *   One route is chosen randomly on page load and the journey stays on it
 *   for the whole session, looping back to the start of the same route when
 *   it ends (no random mid-session jumps, no route switching).
 *
 *   City pairs advance only every ~2–3 minutes (120–180s with jitter). Speeds
 *   can change more often (every ~2.4s) but only while playing. Timers are
 *   cheap and pause while the document is hidden. No requestAnimationFrame;
 *   reduced-motion is handled by the global CSS rule.
 */

const ROUTES = [
    { name: "KARNATAKA", cities: ["BENGALURU", "TUMAKURU", "CHITRADURGA", "DAVANAGERE", "HUBBALLI", "DHARWAD", "BELAGAVI"] },
    { name: "KARNATAKA SOUTH", cities: ["BENGALURU", "RAMANAGARA", "MANDYA", "MYSURU"] },
    { name: "KARNATAKA COAST", cities: ["MANGALURU", "UDUPI", "KUNDAPURA", "BHATKAL", "KARWAR"] },
    { name: "KARNATAKA → GOA", cities: ["BELAGAVI", "KHANAPUR", "GOA"] },
    { name: "KARNATAKA → TELANGANA", cities: ["BENGALURU", "ANANTAPUR", "KURNOOL", "HYDERABAD"] },
    { name: "MAHARASHTRA", cities: ["MUMBAI", "THANE", "NASHIK", "DHULE", "AURANGABAD"] },
    { name: "NORTH INDIA", cities: ["DELHI", "MATHURA", "AGRA", "GWALIOR", "JHANSI"] },
    { name: "WEST INDIA", cities: ["AHMEDABAD", "VADODARA", "SURAT", "VAPI", "MUMBAI"] },
    { name: "EAST INDIA", cities: ["KOLKATA", "DURGAPUR", "ASANSOL", "DHANBAD", "RANCHI"] },
    { name: "TAMIL NADU", cities: ["CHENNAI", "PONDICHERRY", "VILLUPURAM", "TRICHY", "MADURAI"] },
    { name: "KERALA", cities: ["KOCHI", "ALAPPUZHA", "KOLLAM", "THIRUVANANTHAPURAM"] },
    { name: "ANDHRA / TELANGANA", cities: ["HYDERABAD", "VIJAYAWADA", "GUNTUR", "NELLORE", "CHENNAI"] }
];

const SPEED_MIN = 62;
const SPEED_MAX = 84;
const SPEED_TICK_MS = 2400;

/* Safar Mile / Journey Status library — calm roadside notes that rotate
   naturally in the main line. They never replace telemetry or the route. */
const SAFAR_MILE_MESSAGES = [
    "ENJOY THE OPEN ROAD",
    "MUSIC FOR EVERY MILE",
    "RADIO SAFAR LIVE",
    "KEEP YOUR TICKET READY",
    "NEXT STOP APPROACHING",
    "ENJOY THE JOURNEY",
    "EVERY ROAD HAS A STORY",
    "KEEP LISTENING",
    "RADIO ON • JOURNEY ON",
    "TRAVEL • LISTEN • REPEAT",
    "HAPPY SAFAR • MUSAFIR",
    "RADIO SAFAR • LIVE ON AIR"
];

const WELCOME_MESSAGES = [
    "WELCOME TO RADIO SAFAR",
    "YOUR JOURNEY STARTS HERE",
    "MUSICAL JOURNEY STARTS"
];

const MUSIC_MESSAGES = [
    "MUSIC ON THE MOVE",
    "MUSIC FOR EVERY MILE",
    "TUNE IN • SIT BACK",
    "YOUR JOURNEY • YOUR MUSIC",
    "TRAVEL • MUSIC • MEMORIES",
    "ENJOY YOUR SAFAR",
    "LIVE ON THE ROAD",
    "MUSIC ON • WORRIES OFF",
    "RIDE • LISTEN • REPEAT",
    "THE ROAD IS LONG"
];

const JOURNEY_MESSAGES = [
    "JOURNEY IN PROGRESS",
    "SIT BACK • RELAX",
    "EVERY ROAD HAS A STORY",
    "TRAVEL FAR • LISTEN MORE",
    "ENJOY THE RIDE",
    "ONE JOURNEY • MANY MOODS",
    "KEEP MOVING • LISTEN ON",
    "EN ROUTE"
];

const RADIO_MESSAGES = [
    "RADIO SAFAR LIVE",
    "RADIO ON • JOURNEY ON",
    "GOOD VIBES ON AIR"
];

const MUSAFIR_MESSAGES = [
    "MUSAFIR MODE • ON",
    "YOUR SAFAR • YOUR MUSIC",
    "ENJOY THE RIDE",
    "STAY TUNED",
    "MUSAFIR ABOARD",
    "ALL WELCOME • STAY TUNED"
];

const TICKET_MESSAGES = [
    "BOOK YOUR TICKET",
    "YOUR SEAT IS WAITING",
    "THANK YOU • RADIO SAFAR"
];

const PLAYING_MESSAGES = [
    "YOUR SAFAR SETLIST IS ON",
    "TUNED TO YOUR PLAYLIST",
    "A SAFAR FOR EVERY MOOD"
];

const MOOD_MESSAGES = [
    "EVERY MOOD HAS A JOURNEY",
    "PLAY YOUR MOOD",
    "FIND YOUR VIBE",
    "DISCOVER NEW SOUNDS",
    "A NEW CITY • A NEW MOOD"
];

const SAFAR_MESSAGES = [
    "STAY TUNED",
    "NEXT STOP • NEW MEMORIES",
    "FROM ROAD TO PLAYLIST",
    "PRESS PLAY • START SAFAR",
    "YOUR DIGITAL JOURNEY"
];

/* Calm rotation of pure journey/mood/music notes — no player state flows
   onto the board anymore. Telemetry stays in its own always-visible last row. */
const MODES = ["music", "journey", "safar-mile", "ticket", "music", "radio", "journey", "safar-mile", "musafir", "music", "playing", "journey", "safar-mile", "music", "mood", "safar", "journey", "music"];

const WELCOME_MS = 8000;
const MODE_MS = 8000;
const CITY_MS_MIN = 120000;
const CITY_MS_MAX = 180000;

export function initDisplayBoard() {
    const board = document.getElementById("displayBoard");
    const statusEl = document.getElementById("dbLine1");
    const onlineEl = document.getElementById("dbOnline");
    const speedEl = document.getElementById("dbSpeed");
    const cityCur = document.getElementById("dbCityCur");
    const cityNext = document.getElementById("dbCityNext");

    if (!board || !statusEl || !onlineEl || !speedEl || !cityCur || !cityNext) {
        return { setOnline() {}, setPlaying() {} };
    }

    const routeIdx = Math.floor(Math.random() * ROUTES.length);
    let cityIndex = 0;
    let speed = 68 + Math.floor(Math.random() * 8);
    let onlineCount = parseInt(onlineEl.textContent, 10) || 0;
    let modeIndex = 0;
    let welcomeIndex = 0;
    let musicIndex = 0;
    let journeyIndex = 0;
    let radioIndex = 0;
    let musafirIndex = 0;
    let ticketIndex = 0;
    let playingIndex = 0;
    let moodIndex = 0;
    let safarIndex = 0;
    let safarMileIndex = 0;
    let welcomeDone = false;
    let running = true;
    let musicOn = false;
    let welcomeTimer = null;
    let speedTimer = null;
    let modeTimer = null;
    let cityTimer = null;

    const route = () => ROUTES[routeIdx];

    function renderRoute() {
        const cities = route().cities;
        cityCur.textContent = cities[cityIndex];
        cityNext.textContent = cities[(cityIndex + 1) % cities.length];
    }

    function renderTelemetry() {
        speedEl.textContent = musicOn ? String(speed) : "0";
        onlineEl.textContent = `${String(onlineCount)} Online`;
    }

    function renderMessage(text) {
        statusEl.textContent = text;
    }

    function renderMode() {
        if (!running) return;
        const mode = MODES[modeIndex % MODES.length];
        modeIndex += 1;
        switch (mode) {
        case "safar-mile":
            renderMessage(SAFAR_MILE_MESSAGES[safarMileIndex % SAFAR_MILE_MESSAGES.length]);
            safarMileIndex += 1;
            break;
        case "welcome":
            renderMessage(WELCOME_MESSAGES[welcomeIndex % WELCOME_MESSAGES.length]);
            welcomeIndex += 1;
            break;
        case "ticket":
            renderMessage(TICKET_MESSAGES[ticketIndex % TICKET_MESSAGES.length]);
            ticketIndex += 1;
            break;
        case "radio":
            renderMessage(RADIO_MESSAGES[radioIndex % RADIO_MESSAGES.length]);
            radioIndex += 1;
            break;
        case "musafir":
            renderMessage(MUSAFIR_MESSAGES[musafirIndex % MUSAFIR_MESSAGES.length]);
            musafirIndex += 1;
            break;
        case "playing":
            renderMessage(PLAYING_MESSAGES[playingIndex % PLAYING_MESSAGES.length]);
            playingIndex += 1;
            break;
        case "journey":
            renderMessage(JOURNEY_MESSAGES[journeyIndex % JOURNEY_MESSAGES.length]);
            journeyIndex += 1;
            break;
        case "mood":
            renderMessage(MOOD_MESSAGES[moodIndex % MOOD_MESSAGES.length]);
            moodIndex += 1;
            break;
        case "safar":
            renderMessage(SAFAR_MESSAGES[safarIndex % SAFAR_MESSAGES.length]);
            safarIndex += 1;
            break;
        case "music":
        default:
            renderMessage(MUSIC_MESSAGES[musicIndex % MUSIC_MESSAGES.length]);
            musicIndex += 1;
            break;
        }
        modeTimer = setTimeout(renderMode, MODE_MS);
    }

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
        renderTelemetry();
    }

    function cityDelay() {
        return CITY_MS_MIN + Math.random() * (CITY_MS_MAX - CITY_MS_MIN);
    }

    function advanceCity() {
        const cities = route().cities;
        cityIndex = (cityIndex + 1) % cities.length;
        renderRoute();
        cityTimer = setTimeout(advanceCity, cityDelay());
    }

    function stopTimers() {
        clearTimeout(welcomeTimer);
        clearInterval(speedTimer);
        clearTimeout(modeTimer);
        clearTimeout(cityTimer);
        welcomeTimer = speedTimer = modeTimer = cityTimer = null;
    }

    function startTimers() {
        stopTimers();
        if (musicOn) {
            speedTimer = setInterval(stepSpeed, SPEED_TICK_MS);
        }
        cityTimer = setTimeout(advanceCity, cityDelay());
        renderRoute();
        renderTelemetry();

        if (!welcomeDone) {
            welcomeDone = true;
            statusEl.textContent = "WELCOME TO RADIO SAFAR";
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
        /* Single live value the board renders: the existing Supabase presence
           count passed in by main.js. This module never opens its own channel. */
        setOnline(count) {
            onlineCount = count;
            renderTelemetry();
        },

        /* PLAYING / NOT PLAYING feed from main.js. The speed walk only runs
           while music is actually playing; otherwise the board reads 0 KM/H. */
        setPlaying(playing) {
            musicOn = playing === true;
            if (musicOn && running && !speedTimer) {
                speedTimer = setInterval(stepSpeed, SPEED_TICK_MS);
            } else if (!musicOn) {
                clearInterval(speedTimer);
                speedTimer = null;
            }
            renderTelemetry();
        }
    };
}