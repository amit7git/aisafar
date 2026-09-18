/* Radio Safar — Display Board (top-centre premium coach LED board)
 *   Restyled to read like a luxury intercity bus / airport LED information
 *   panel with EXACTLY three rows:
 *
 *   - Row 1 (telemetry + welcome, always visible): simulated speed (left),
 *     the static text "❤️ Welcome to Radio Safar ❤️" (centre, never
 *     animated), and a green "● live online" count (right). Exactly ONE
 *     speed element and ONE online element; both are inside the board only.
 *   - Row 2 (promo only): a slow-scrolling CSS-only promo ticker. The 20
 *     messages below are rendered twice into the track with bullet
 *     separators and the track is translated -50% for a seamless loop.
 *     Under reduced motion the track is hidden and a single static message
 *     is shown instead. No <marquee> tag is ever used.
 *   - Row 3 (route): CURRENT → NEXT → UPCOMING, a clean three-stop journey
 *     row (CURRENT in cool cyan, NEXT + UPCOMING in warm amber, two longer
 *     neon-green arrows between them that blink ALTERNATELY).
 *
 *   The SIMULATED journey is picked at random ONCE per session and loops on
 *   the same route. Current = cities[i], NEXT = cities[i+1], UPCOMING =
 *   cities[i+2] (mod length). Cities advance every ~2–3 minutes (120–180s
 *   with jitter), so the route rolls smoothly.
 *
 *   ROUTES ARE NOT REAL-TIME: the route list is a local dataset covering
 *   cities of all 28 Indian states. One route is picked at random per
 *   session and the board rotates through its cities. There is no GPS,
 *   live-traffic or external routing API; nothing here is presented as live
 *   traffic or live location data.
 *
 *   Speed is tied to whether the music is actually playing: main.js feeds
 *   PLAYING / NOT PLAYING via setPlaying. While music plays, the speed does a
 *   smooth random walk 62–84 km/h; the moment playback stops (paused, ended,
 *   or never started) the speed reads 0 KM/H — no stale number on screen.
 *
 *   Timers are cheap and pause while the document is hidden. No
 *   requestAnimationFrame; reduced-motion is handled by the global CSS rule
 *   (promo track + arrows + LIVE dot animations are all CSS keyframes).
 */

/* The 20 promotional messages for the Row-2 promo ticker. */
const PROMO_MESSAGES = [
    "Radio Safar — Music That Travels With You",
    "Now Playing: Your Favourite Hits",
    "19 Cities Covered Across 28 States",
    "Pehli Baar, Radio Ki Speed",
    "Driving Music For Every Mile",
    "Safar Hoti Nahi, Radio Ke Saath Hoti Hai",
    "Your Road Trip Companion, 24/7",
    "Live From The Highway, Right To Your City",
    "Tune In, Drive On",
    "Every Highway Has A Vibe",
    "Safara Bina Music Ke Adhoora Hai",
    "Ghar Se Daur, Jahan Bhi Ho",
    "Radio Safar — Every Mood Has A Journey",
    "New Songs, New Cities, Every Day",
    "Music, News And Your Co-passengers",
    "Kar Bhi Le, Radio Safar Ke Saath",
    "Stay Tuned, Stay Ahead",
    "Routes Change, Hits Stay",
    "Journey Short, Music Long",
    "Radio Safar — Let The Road Sing"
];

const ROUTES = [
    /* ---- All 28 Indian states, one route each (real city pairs) ---- */
    { name: "KARNATAKA", cities: ["BENGALURU", "TUMKUR", "CHITRADURGA", "DAVANAGERE", "HUBBALLI", "BELAGAVI"] },
    { name: "KARNATAKA SOUTH", cities: ["BENGALURU", "RAMANAGARA", "MANDYA", "MYSURU"] },
    { name: "KARNATAKA COAST", cities: ["MANGALURU", "UDUPI", "KUNDAPURA", "BHATKAL", "KARWAR"] },
    { name: "ANDHRA PRADESH", cities: ["VISAKHAPATNAM", "RAJAHMUNDRY", "VIJAYAWADA", "GUNTUR", "NELLORE"] },
    { name: "TELANGANA", cities: ["HYDERABAD", "WARANGAL", "KARIMNAGAR"] },
    { name: "MAHARASHTRA", cities: ["MUMBAI", "PUNE", "AHMEDNAGAR", "AURANGABAD", "NAGPUR"] },
    { name: "GOA", cities: ["PANAJI", "MARGAO", "MAPUSA"] },
    { name: "GUJARAT", cities: ["AHMEDABAD", "VADODARA", "SURAT", "RAJKOT", "JAMNAGAR"] },
    { name: "RAJASTHAN", cities: ["JAIPUR", "AJMER", "UDAIPUR", "JODHPUR", "BIKANER"] },
    { name: "PUNJAB", cities: ["AMRITSAR", "LUDHIANA", "PATIALA", "JALANDHAR"] },
    { name: "HARYANA", cities: ["GURUGRAM", "ROHTAK", "KARNAL", "KURUKSHETRA"] },
    { name: "UTTAR PRADESH", cities: ["LUCKNOW", "KANPUR", "PRAYAGRAJ", "VARANASI"] },
    { name: "UTTARAKHAND", cities: ["DEHRADUN", "HARIDWAR", "RISHIKESH", "NAINITAL"] },
    { name: "HIMACHAL PRADESH", cities: ["SHIMLA", "SOLAN", "KULLU", "MANALI", "DHARAMSHALA"] },
    { name: "MADHYA PRADESH", cities: ["BHOPAL", "INDORE", "UJJAIN", "GWALIOR"] },
    { name: "CHHATTISGARH", cities: ["RAIPUR", "BHILAI", "BILASPUR", "JAGDALPUR"] },
    { name: "JHARKHAND", cities: ["RANCHI", "JAMSHEDPUR", "BOKARO", "DHANBAD"] },
    { name: "BIHAR", cities: ["PATNA", "GAYA", "MUZAFFARPUR", "BHAGALPUR"] },
    { name: "WEST BENGAL", cities: ["KOLKATA", "HOWRAH", "DURGAPUR", "ASANSOL", "SILIGURI"] },
    { name: "ODISHA", cities: ["BHUBANESWAR", "CUTTACK", "PURI", "SAMBALPUR"] },
    { name: "ASSAM", cities: ["GUWAHATI", "JORHAT", "DIBRUGARH", "SILCHAR"] },
    { name: "ARUNACHAL PRADESH", cities: ["NAHARLAGUN", "ITANAGAR", "PASIGHAT"] },
    { name: "MEGHALAYA", cities: ["SHILLONG", "NONGPOH", "TURA"] },
    { name: "NAGALAND", cities: ["DIMAPUR", "KOHIMA", "MOKOKCHUNG"] },
    { name: "MANIPUR", cities: ["IMPHAL", "THOUBAL", "BISHNUPUR"] },
    { name: "MIZORAM", cities: ["AIZAWL", "CHAMPHAI", "LUNGLEI"] },
    { name: "TRIPURA", cities: ["AGARTALA", "DHARMANAGAR", "KAILASHAHAR"] },
    { name: "SIKKIM", cities: ["GANGTOK", "SINGTAM", "NAMCHI"] },
    { name: "TAMIL NADU", cities: ["CHENNAI", "VELLORE", "TRICHY", "MADURAI", "KANYAKUMARI"] },
    { name: "KERALA", cities: ["KOCHI", "THRISSUR", "KOZHIKODE", "KANNUR", "KASARAGOD"] },

    /* ---- Inter-state corridors (DELHI appears only as a transit stop in a
       corridor; it is never used to represent a missing state) ---- */
    { name: "KARNATAKA → TELANGANA", cities: ["BENGALURU", "ANANTAPUR", "KURNOOL", "HYDERABAD"] },
    { name: "KARNATAKA → GOA", cities: ["BELAGAVI", "KHANAPUR", "PANAJI"] },
    { name: "NORTH INDIA CORRIDOR", cities: ["DELHI", "MATHURA", "AGRA", "GWALIOR", "JHANSI"] },
    { name: "EAST INDIA CORRIDOR", cities: ["KOLKATA", "DHANBAD", "RANCHI"] },
    { name: "TAMIL NADU → KERALA", cities: ["CHENNAI", "SALEM", "COIMBATORE", "PALAKKAD", "KOCHI"] },
    { name: "MAHARASHTRA COAST → GOA", cities: ["MUMBAI", "PANVEL", "CHIPLUN", "RATNAGIRI", "PANAJI"] }
];

const SPEED_MIN = 62;
const SPEED_MAX = 84;
const SPEED_TICK_MS = 2400;

/* City pairs advance every ~2–3 minutes (with jitter). This is a simulated
   journey rotation over the local dataset — never live traffic/location. */
const CITY_MS_MIN = 120000;
const CITY_MS_MAX = 180000;

export function initDisplayBoard() {
    const board = document.getElementById("displayBoard");
    const onlineEl = document.getElementById("dbOnline");
    const speedEl = document.getElementById("dbSpeed");
    const cityCur = document.getElementById("dbCityCur");
    const cityNxt = document.getElementById("dbCityNxt");
    const cityUpc = document.getElementById("dbCityUpc");
    const promoTrack = document.getElementById("dbPromoTrack");

    if (!board || !onlineEl || !speedEl || !cityCur || !cityNxt || !cityUpc) {
        return { setOnline() {}, setPlaying() {} };
    }

    /* Row 2 promo ticker: every message appears twice (two identical copies)
       so the CSS -50% translate makes a seamless infinite loop. A green "•"
       separator keeps the bullets in sync with the two copies without extra
       markup classes. */
    if (promoTrack) {
        for (let copy = 0; copy < 2; copy += 1) {
            PROMO_MESSAGES.forEach((message) => {
                const sep = document.createElement("span");
                sep.className = "db-promo__sep";
                sep.textContent = "•";
                sep.setAttribute("aria-hidden", "true");
                const item = document.createElement("span");
                item.className = "db-promo__item";
                item.textContent = message;
                promoTrack.appendChild(sep);
                promoTrack.appendChild(item);
            });
        }
    }

    const routeIdx = Math.floor(Math.random() * ROUTES.length);
    let cityIndex = 0;
    let speed = 68 + Math.floor(Math.random() * 8);
    let onlineCount = null; // null = real presence count not received yet
    let running = true;
    let musicOn = false;
    let speedTimer = null;
    let cityTimer = null;

    const route = () => ROUTES[routeIdx];

    /* Row 3: CURRENT → NEXT → UPCOMING. All routes have at least 3 cities, so
       current/i, next/i+1 and upcoming/i+2 (mod length) are always distinct. */
    function renderRoute() {
        const cities = route().cities;
        cityCur.textContent = cities[cityIndex];
        cityNxt.textContent = cities[(cityIndex + 1) % cities.length];
        cityUpc.textContent = cities[(cityIndex + 2) % cities.length];
    }

    function renderTelemetry() {
        speedEl.textContent = musicOn ? String(speed) : "0";
        onlineEl.textContent = onlineCount === null ? "Connecting…" : `${String(onlineCount)} Online`;
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
        clearInterval(speedTimer);
        clearTimeout(cityTimer);
        speedTimer = cityTimer = null;
    }

    function startTimers() {
        stopTimers();
        if (musicOn) {
            speedTimer = setInterval(stepSpeed, SPEED_TICK_MS);
        }
        cityTimer = setTimeout(advanceCity, cityDelay());
        renderRoute();
        renderTelemetry();
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