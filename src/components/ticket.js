/**
 * Mitthu Travels — Radio Safar PERSONALIZED journey e-ticket.
 *
 * Two-stage flow: (1) "Radio Safar Travels Limited" booking form → (2)
 * generated ticket preview with Edit / Download (PDF) / Share actions.
 *
 * Everything is fictional and stays 100% client-side:
 *   - no payment, no real booking, no seats, no database, no server calls
 *   - passenger details are never sent to Gemini, Supabase or any backend
 *   - the ticket lives in browser memory only and disappears on refresh
 *
 * The PDF download is built locally with zero dependencies: the ticket is
 * painted straight onto a canvas from the generated journey data (no clone
 * / SVG — Chromium taints canvases that rasterize SVG foreignObject), then
 * embedded as a JPEG into a minimal hand-written single-page PDF.
 */

import qrcode from 'qrcode-generator';
import { getPlayerSnapshot } from '../services/radio-commands.js';
import {
    CITIES,
    NATIONAL_HIGHWAYS,
    ROUTE_PAIRS,
    PLATFORMS,
    SEATS,
    randomOf,
    nhForPair
} from '../config/ticket-data.js';

const TXN_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let currentDetails = null;
let statusTimer = null;

function pad(n) {
    return String(n).padStart(2, "0");
}

function todayLocalISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateLabel(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return "—";
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${pad(d)} ${names[m - 1]} ${y}`;
}

/* ===== INDIAN CURRENCY NUMBER → WORDS ===== */

const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
    "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function twoWords(n) {
    if (n < 20) return ONES[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return TENS[t] + (o ? `-${ONES[o]}` : "");
}

function threeWords(n) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    let out = "";
    if (h) out += `${ONES[h]} HUNDRED`;
    if (rest) out += (out ? " " : "") + twoWords(rest);
    return out;
}

function numberToWordsIndian(num) {
    if (!Number.isFinite(num) || num < 0 || num > 9999999999) return "AMOUNT";
    if (num === 0) return "ZERO";
    const crore = Math.floor(num / 10000000);
    const lakh = Math.floor((num % 10000000) / 100000);
    const thousand = Math.floor((num % 100000) / 1000);
    const rest = num % 1000;
    const parts = [];
    if (crore) parts.push(crore === 1 ? "ONE CRORE" : `${twoWords(crore)} CRORES`);
    if (lakh) parts.push(lakh === 1 ? "ONE LAKH" : `${twoWords(lakh)} LAKHS`);
    if (thousand) parts.push(`${twoWords(thousand)} THOUSAND`);
    if (rest) parts.push(threeWords(rest));
    return parts.join(" ");
}

function fareInWords(fareText) {
    const num = Math.floor(Number(String(fareText || "").replace(/[^\d.]/g, "")) || 0);
    return `RUPEES ${numberToWordsIndian(num)} ONLY`;
}

/* ===== QR CODE (PNR fingerprint embeddable in ticket + PDF) ===== */

function qrPayload(d) {
    return [
        "RADIO SAFAR TRAVELS / RADIO SAFAR",
        `PNR: ${d.pnr}`,
        `TICKET ID: ${d.ticketId}`,
        `PASSENGER: ${d.name}`,
        `FROM: ${d.start}`,
        `TO: ${d.dest}`,
        `DATE: ${d.date}`,
        `FARE: ${d.fare}`
    ].join(" | ");
}

function qrDataUrl(payload) {
    const qr = qrcode(0, "M");
    qr.addData(payload);
    qr.make();
    return qr.createDataURL(6, 2);
}

function qrImageFor(details) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = qrDataUrl(qrPayload(details));
    });
}

/* ===== FORM VALIDATION ===== */

const NAME_CITY_RE = /^[A-Za-z][A-Za-z .'’-]*$/;
const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const TYPES = ["Adult", "Child"];

function normalizeField(raw) {
    return String(raw || "").trim().replace(/\s+/g, " ");
}

function alphaCount(value) {
    return (value.match(/[A-Za-z]/g) || []).length;
}

function isValidCalendar(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || m < 1 || m > 12) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/* ===== TIME HELPERS (24h "HH:MM", from <input type="time">) ===== */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTime(value) {
    return TIME_RE.test(value);
}

function timeToMinutes(value) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
}

function addMinutesToTime(value, minutes) {
    if (!isValidTime(value)) return "";
    const total = ((timeToMinutes(value) + minutes) % 1440 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* Ticket display label, matching the original DEPARTURE_TIMES formatting. */
function formatTimeLabel(value) {
    return isValidTime(value) ? `${value} Hrs.` : "";
}

function validateInputs(v) {
    const errors = {};

    const name = normalizeField(v.name);
    if (!name) {
        errors.name = "Please enter a valid name using letters only.";
    } else if (name.length > 60) {
        errors.name = "Name must be 60 characters or fewer.";
    } else if (!NAME_CITY_RE.test(name) || alphaCount(name) < 2) {
        errors.name = "Please enter a valid name using letters only.";
    }

    const ageRaw = normalizeField(v.age);
    if (!ageRaw) {
        errors.age = "Please enter a valid age between 1 and 99.";
    } else if (!/^\d+$/.test(ageRaw)) {
        errors.age = "Please enter a valid age between 1 and 99.";
    } else {
        const age = Number(ageRaw);
        if (age < 1 || age > 99) errors.age = "Please enter a valid age between 1 and 99.";
    }

    const dateInput = normalizeField(v.date);
    if (!dateInput) {
        errors.date = "Please select today or a future journey date.";
    } else if (!isValidCalendar(dateInput)) {
        errors.date = "Please select today or a future journey date.";
    } else {
        const [y, m, d] = dateInput.split("-").map(Number);
        const chosen = new Date(y, m - 1, d);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (chosen < todayStart) errors.date = "Please select today or a future journey date.";
    }

    const gender = normalizeField(v.gender);
    if (gender && !GENDERS.includes(gender)) {
        errors.gender = "Please choose a valid gender option.";
    }

    const type = normalizeField(v.type);
    if (type && !TYPES.includes(type)) {
        errors.type = "Please choose a valid passenger type.";
    }

    const start = normalizeField(v.start);
    const dest = normalizeField(v.dest);

    if (start && (start.length > 50 || !NAME_CITY_RE.test(start) || alphaCount(start) < 2)) {
        errors.start = "Please enter a valid city name using letters only.";
    }
    if (dest && (dest.length > 50 || !NAME_CITY_RE.test(dest) || alphaCount(dest) < 2)) {
        errors.dest = "Please enter a valid city name using letters only.";
    }
    if (start && dest && !errors.start && !errors.dest && start.toLowerCase() === dest.toLowerCase()) {
        errors.dest = "Starting and destination cities must be different.";
    }

    return errors;
}

function showErrors(ui, errors) {
    const fields = [
        ["name", "name"],
        ["age", "age"],
        ["date", "journeyDate"],
        ["gender", "gender"],
        ["type", "passengerType"],
        ["start", "startCity"],
        ["dest", "destCity"]
    ];
    fields.forEach(([key, ctrlName]) => {
        const errId = "err" + key.charAt(0).toUpperCase() + key.slice(1);
        const errEl = ui[key] || document.getElementById(errId);
        if (errEl) errEl.textContent = errors[key] || "";
        const ctrl = ui.ticketForm.elements.namedItem(ctrlName);
        const field = ctrl && ctrl.closest ? ctrl.closest(".tf-field") : null;
        const invalid = Boolean(errors[key]);
        if (field) field.classList.toggle("tf-field--invalid", invalid);
        if (ctrl && typeof ctrl.setAttribute === "function") {
            if (invalid) ctrl.setAttribute("aria-invalid", "true");
            else ctrl.removeAttribute("aria-invalid");
        }
    });
}

/* ===== JOURNEY GENERATION ===== */

function pickCityExcept(list, except) {
    const others = list.filter(c => c.toLowerCase() !== except.toLowerCase());
    return randomOf(others.length ? others : list);
}

function pickRoute(startInput, destInput) {
    const start = (startInput || "").trim();
    const dest = (destInput || "").trim();

    if (start && dest) {
        return { start, dest, nh: nhForPair(start, dest) || randomOf(NATIONAL_HIGHWAYS) };
    }
    if (start && !dest) {
        const partners = ROUTE_PAIRS.filter(p => p.start.toLowerCase() === start.toLowerCase()).map(p => p.end);
        const destPick = partners.length ? randomOf(partners) : pickCityExcept(CITIES, start);
        return { start, dest: destPick, nh: nhForPair(start, destPick) || randomOf(NATIONAL_HIGHWAYS) };
    }
    if (!start && dest) {
        const partners = ROUTE_PAIRS.filter(p => p.end.toLowerCase() === dest.toLowerCase()).map(p => p.start);
        const startPick = partners.length ? randomOf(partners) : pickCityExcept(CITIES, dest);
        return { start: startPick, dest, nh: nhForPair(startPick, dest) || randomOf(NATIONAL_HIGHWAYS) };
    }
    const pair = randomOf(ROUTE_PAIRS);
    return { start: pair.start, dest: pair.end, nh: pair.nh };
}

function safarCode(label, key) {
    const src = String(label || key || "");
    const tokens = src.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
    if (!tokens.length) return "RAD";
    let code = tokens.slice(0, 2).map(t => t.slice(0, 2)).join("").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length > 4) code = code.slice(0, 4);
    if (code.length < 3) code = (code + "RAD").slice(0, 4);
    return code;
}

function buildJourney(v, snap) {
    const route = pickRoute(v.start, v.dest);
    const now = new Date();

    /* Reporting time is taken from the current local journey-generation time;
       departure is always exactly 15 minutes later (military-time helpers handle
       the midnight rollover). No user input — the values are never entered. */
    const reportingTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const departureTime = addMinutesToTime(reportingTime, 15);

    const pnr = "RS" + Math.floor(10000000 + Math.random() * 90000000);
    const txn = "RS" + Array.from({ length: 8 }, () => TXN_CHARS[Math.floor(Math.random() * TXN_CHARS.length)]).join("");
    const ticketId = `RS-${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const tripCode = `RS-${safarCode(snap.safarLabel, snap.safarKey)}-${Math.floor(1000 + Math.random() * 9000)}`;

    const bay = randomOf(PLATFORMS);
    const fareValue = 450 + 99 + 50;
    const fare = `₹${fareValue.toFixed(2)}`;

    /* SINGLE SOURCE OF TRUTH — this exact canonical object feeds the screen
     * ticket, the PDF, the print view and the shared file. PNR, Trip Code,
     * Transaction ID and Ticket ID are generated here once and only here;
     * nothing is regenerated on download / print / share, so every surface
     * shows identical values. */
    return {
        name: v.name.trim(),
        age: v.age.trim(),
        gender: v.gender || "Prefer not to say",
        type: v.type,
        date: formatDateLabel(v.date),
        start: route.start,
        dest: route.dest,
        nh: route.nh,
        departure: formatTimeLabel(departureTime),
        bay,
        seat: randomOf(SEATS),
        busType: "Volvo 9600 Multi-Axle A/C Sleeper (Imaginary Edition)",
        regNo: "RJ-27-NO-BUS-404",
        boardingBay: `Bay ${bay} (Platform exists only when eyes are closed)`,
        reportingTime: formatTimeLabel(reportingTime),
        captain: "Captain Mitthu (Prefers playing 90s hits over using the horn)",
        luggage: "15kg of real baggage + Unlimited emotional baggage",
        fare,
        fareValue,
        fareWords: fareInWords(fare),
        fareBreakdown: [
            ["Base Fare", "₹450.00"],
            ["Nostalgia Surcharge", "₹99.00"],
            ["Chai Tax (GST)", "₹50.00"]
        ],
        pnr,
        tripCode,
        txn,
        ticketId,
        safar: snap.safarLabel || snap.safarKey || "Radio Safar",
        song: snap.trackTitle || "Nothing on the road yet",
        artist: snap.trackArtist || ""
    };
}

function populateTicket(ui, details) {
    ui.ticket.querySelectorAll("[data-fill]").forEach(el => {
        const key = el.getAttribute("data-fill");
        const value = details[key] ?? (key === "tripcode" ? details.tripCode : key === "ticketid" ? details.ticketId : undefined);
        if (!key || value === undefined) return;
        if (el.classList.contains("t-row--artist")) {
            const b = el.querySelector("b");
            if (b) b.textContent = details.artist || "—";
            return;
        }
        el.textContent = value;
    });
    const artistRow = ui.ticket.querySelector(".t-row--artist");
    if (artistRow) artistRow.setAttribute("data-hidden", details.artist ? "0" : "1");
    const qr = ui.ticket.querySelector(".ticket-qr");
    if (qr) {
        const img = new Image();
        img.decoding = "async";
        img.classList.add("ticket-qr__img");
        img.alt = `QR code for PNR ${details.pnr}`;
        img.onload = () => qr.replaceChildren(img);
        img.onerror = () => qr.replaceChildren();
        img.src = qrDataUrl(qrPayload(details));
    }
}

/* ===== STAGE SWITCHING ===== */

function setStage(ui, stage) {
    ui.ticketModal.classList.toggle("ticket-modal--result", stage === "result");
    const panel = ui.ticketModal.querySelector(".ticket-panel");
    if (panel) panel.scrollTop = 0;
}

function resetForm(ui) {
    ui.ticketForm.reset();
    ui.ticketForm.elements.journeyDate.value = todayLocalISO();
    ui.ticketForm.elements.journeyDate.min = todayLocalISO();
    ["errName", "errAge", "errDate", "errGender", "errType", "errStart", "errDest"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "";
    });
    ui.ticketForm.querySelectorAll(".tf-field--invalid").forEach(el => el.classList.remove("tf-field--invalid"));
    ui.ticketForm.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
    ui.ticketStatus.textContent = "";
    currentDetails = null;
}

/* ===== EXPORT: PDF (zero-dependency) ===== */

/**
 * Purpose-built, fixed-width bus e-ticket painted DIRECTLY from the generated
 * journey data (currentDetails). The on-screen ticket stays the responsive
 * DOM; the PDF never screenshots it — so the two-column journey grid,
 * wrapping, contrast and section spacing are fully controlled here.
 *
 * Why this version is readable and never clipped:
 *   - a single explicit logical ticket width (TICKET_W) — no viewport CSS
 *   - every value is measured and wrapped against its exact column width, so
 *     long city names grow their row height instead of invading neighbours
 *   - layout runs only after document fonts are ready, so measure-vs-paint
 *     metrics can never disagree and text can't overflow the canvas width
 *   - the PDF page is always a true A4 portrait (595 x 842 pt) and the
 *     rendered ticket is fit-and-centred inside it, so the complete ticket
 *     always fits one page with nothing cropped, scaled off the page or
 *     pushed to a second sheet
 * No SVG is used (Chromium taints canvases that rasterise SVG foreignObject).
 */

const PDF_C = {
    inner: 13,
    pad: 22,
    bgTop: "#fdf6e6",
    bgBottom: "#efe0bf",
    ink: "#2f2013",
    sub: "#8a6428",
    soft: "#54422c",
    amber: "#e9a825",
    amberDark: "#a86f14",
    red: "#b02418",
    redBg: "#f7ded6",
    dashed: "rgba(168,128,60,0.5)",
    panel: "#fdf3d6",
    boxBg: "#fdf3e4",
    fontDisplay: "'Orbitron','Segoe UI',sans-serif",
    fontSans: "'Plus Jakarta Sans','Segoe UI',system-ui,sans-serif",
    fontMono: "'JetBrains Mono','Consolas','Courier New',monospace"
};

/* Logical ticket width in px. Every element is measured against this. */
const TICKET_W = 600;
/* Width the ticket occupies on the PDF page (PostScript points). */
const PDF_EMBED_W_PT = 550;
/* Rendering height target in logical px so the ticket fits A4 with room
   for the page's small side margins (target H -> scaled height ~797pt). */
const PDF_EMBED_H_MAX = 870;
/* Page margin kept around the ticket in PostScript points. */
const PDF_MARGIN_PT = 22.5;
/* Raster multiplier — crisp text, fully decoupled from the PDF layout. */
const PDF_RENDER_SCALE = 3;

const PDF_CARRIER = "RADIO SAFAR TRAVELS LIMITED";

const FINE_PRINT = [
    "Luggage & Liability: Radio Safar Travels Limited is not responsible for lost items, lost time, or getting lost in 90s music nostalgia.",
    "Cancellation Policy: No cash refunds allowed. All refunds will be issued in the form of 3 additional romantic highway tracks.",
    "Passenger Protocol: Passengers engaging in dramatic window-staring must ensure their head-bobbing remains within their allocated berth space."
];

const PDF_RULES = [
    "This ticket is valid for one passenger and unlimited good vibes. Bad vibes must get off at the next imaginary stop.",
    "Window seats provide premium views of real roads, fake scenery, and roads that only exist in your imagination.",
    "When your favourite song starts playing, smiling is compulsory. Dramatic head-bobbing is highly recommended.",
    "Skipping a song is allowed. Skipping the entire Safar is strictly against Radio Safar law.",
    "Rain Mode may cause nostalgia, sudden chai cravings, highway memories, and staring dramatically out of imaginary windows.",
    "Spontaneous singing is guaranteed. Radio Safar is not liable for annoyed neighbors.",
    "Radio Safar Travels Limited is not responsible for passengers accidentally falling in love with a song.",
    "Chai breaks are imaginary but highly recommended. Please provide your own chai.",
    "Seat numbers are decorative and cannot be used to start a fight with another passenger.",
    "No actual bus, seat, reservation or payment is included with this ticket. Your journey is powered entirely by music and imagination."
];

let pdfLogoPromise = null;

function radioSafarLogo() {
    if (!pdfLogoPromise) {
        pdfLogoPromise = new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = "/radio-safar-icon-1024.png";
        });
    }
    return pdfLogoPromise;
}

function pdfFont(weight, size, family) {
    return `${weight} ${size}px ${family}`;
}

function pdfCtx() {
    return document.createElement("canvas").getContext("2d");
}

function roundPdfRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, w, h, radius);
        return;
    }
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function wrapIntoParts(ctx, word, maxWidth) {
    const parts = [];
    let rest = word;
    while (rest) {
        let len = rest.length;
        while (len > 1 && ctx.measureText(rest.slice(0, len)).width > maxWidth) len--;
        parts.push(rest.slice(0, len));
        rest = rest.slice(len);
    }
    return parts;
}

function wrapPdfLines(ctx, text, font, maxWidth) {
    ctx.font = font;
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const word of words) {
        if (ctx.measureText(word).width > maxWidth) {
            if (current) { lines.push(current); current = ""; }
            const parts = wrapIntoParts(ctx, word, maxWidth);
            for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
            current = parts[parts.length - 1];
            continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(candidate).width > maxWidth) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
}

/**
 * Lays out the full ticket and returns two paint lists:
 *   back   — backgrounds / panels (painted first)
 *   blocks — content (painted afterwards)
 * plus the total logical height. All measurements happen here with a
 * scratch context that uses the SAME fonts the paint pass uses — and because
 * document.fonts.ready is awaited before layout, measure-vs-paint metrics
 * always agree, so wrapped rows grow correctly and can never overflow into
 * a neighbouring column or past the right edge of the ticket.
 */
function makeTicketLayout(details, logo, qrImg) {
    const W = TICKET_W;
    const x = PDF_C.pad;
    const w = W - 2 * PDF_C.pad;
    const inner = PDF_C.inner;
    const innerW = w - 2 * inner;
    const xl = x + inner;
    const cx = W / 2;
    const back = [];
    const blocks = [];
    let y = 14;

    const addText = o => {
        const { text, size, weight, family, fill = PDF_C.ink, align = "left", ls = 0, maxWidth } = o;
        const font = pdfFont(weight, size, family);
        const ctx = pdfCtx();
        ctx.font = font;
        const lines = maxWidth ? wrapPdfLines(ctx, text, font, maxWidth) : [String(text)];
        const lineH = Math.round(size * 1.28);
        blocks.push(c => {
            c.font = font;
            c.fillStyle = fill;
            c.textAlign = align;
            const prev = c.letterSpacing;
            if (ls) c.letterSpacing = `${ls}px`;
            let yy = o.y + lineH;
            for (const line of lines) {
                c.fillText(line, o.x, yy);
                yy += lineH;
            }
            c.letterSpacing = prev;
        });
        return lines.length * lineH;
    };

    const dashedLine = (dx, dy, dw, color) => {
        blocks.push(c => {
            c.save();
            c.setLineDash([4, 4]);
            c.strokeStyle = color || PDF_C.dashed;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(dx, dy);
            c.lineTo(dx + dw, dy);
            c.stroke();
            c.restore();
        });
    };

    const addSectionHeader = (title, size = 9.5) => {
        const h = addText({ text: title, x: xl, y, size, weight: 800, family: PDF_C.fontDisplay, fill: PDF_C.sub, ls: 1.2 });
        dashedLine(xl, y + h + 4, innerW);
        return h + 8;
    };

    const addField = o => {
        const { label, value, ox, oy, colW, size = 10, mono = false, fill = PDF_C.ink } = o;
        const lFont = pdfFont(700, 7.5, PDF_C.fontSans);
        const vFont = pdfFont(800, size, mono ? PDF_C.fontMono : PDF_C.fontSans);
        const ctx = pdfCtx();
        ctx.font = vFont;
        const vLines = wrapPdfLines(ctx, value, vFont, colW);
        const lLineH = Math.round(7.5 * 1.55);
        const vLineH = Math.round(size * 1.28);
        blocks.push(c => {
            c.font = lFont;
            c.fillStyle = PDF_C.sub;
            c.textAlign = "left";
            const prev = c.letterSpacing;
            c.letterSpacing = "0.6px";
            c.fillText(label, ox, oy + lLineH);
            c.letterSpacing = prev;
            c.font = vFont;
            c.fillStyle = fill;
            let yy = oy + lLineH + vLineH;
            for (const line of vLines) {
                c.fillText(line, ox, yy);
                yy += vLineH;
            }
        });
        return lLineH + vLines.length * vLineH;
    };

    const addRouteCity = (city, label, ox, oy, colW, alignRender) => {
        const lFont = pdfFont(700, 8.5, PDF_C.fontSans);
        const vFont = pdfFont(900, 16, PDF_C.fontSans);
        const ctx = pdfCtx();
        ctx.font = vFont;
        const vLines = wrapPdfLines(ctx, city, vFont, colW);
        const lLineH = Math.round(8.5 * 1.55);
        const vLineH = Math.round(16 * 1.2);
        blocks.push(c => {
            c.font = lFont;
            c.fillStyle = PDF_C.sub;
            c.textAlign = alignRender;
            const prev = c.letterSpacing;
            c.letterSpacing = "1.2px";
            c.fillText(label, alignRender === "right" ? ox + colW : ox, oy + lLineH);
            c.letterSpacing = prev;
            c.font = vFont;
            c.fillStyle = PDF_C.ink;
            let yy = oy + lLineH + vLineH;
            for (const line of vLines) {
                c.fillText(line, alignRender === "right" ? ox + colW : ox, yy);
                yy += vLineH;
            }
        });
        return lLineH + vLines.length * vLineH;
    };

    const panel = (top, padBottom, fill) => {
        const p = { top, bottom: y + padBottom, fill };
        back.push(c => {
            roundPdfRect(c, x, p.top, w, p.bottom - p.top, 12);
            c.fillStyle = p.fill || PDF_C.boxBg;
            c.fill();
            c.lineWidth = 1;
            c.strokeStyle = PDF_C.dashed;
            c.stroke();
        });
        y = p.bottom;
    };

    /* ===== TOP BAND: brand + ticket metadata + QR ===== */
    const yBand = y;
    const logoSize = 40;
    blocks.push(c => {
        c.save();
        roundPdfRect(c, x, yBand, logoSize, logoSize, Math.round(logoSize * 0.26));
        c.clip();
        c.fillStyle = PDF_C.amber;
        c.fillRect(x, yBand, logoSize, logoSize);
        if (logo && logo.naturalWidth > 0) {
            const s = Math.min(logoSize / logo.naturalWidth, logoSize / logo.naturalHeight);
            const dw = logo.naturalWidth * s;
            const dh = logo.naturalHeight * s;
            c.imageSmoothingQuality = "high";
            c.drawImage(logo, x + (logoSize - dw) / 2, yBand + (logoSize - dh) / 2, dw, dh);
        } else {
            c.font = pdfFont(900, Math.round(logoSize * 0.42), PDF_C.fontDisplay);
            c.fillStyle = PDF_C.ink;
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText("RS", x + logoSize / 2, yBand + logoSize / 2 + 2);
        }
        c.restore();
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
    });
    const brandTextX = x + logoSize + 12;
    blocks.push(c => {
        c.font = pdfFont(900, 15, PDF_C.fontDisplay);
        c.fillStyle = PDF_C.red;
        c.textAlign = "left";
        c.fillText("RADIO SAFAR", brandTextX, yBand + 19);
    });
    blocks.push(c => {
        c.font = pdfFont(700, 8, PDF_C.fontDisplay);
        c.fillStyle = PDF_C.sub;
        c.textAlign = "left";
        const prev = c.letterSpacing;
        c.letterSpacing = "2px";
        c.fillText(PDF_CARRIER, brandTextX, yBand + 35);
        c.letterSpacing = prev;
    });
    blocks.push(c => {
        c.font = pdfFont(700, 7.5, PDF_C.fontSans);
        c.fillStyle = PDF_C.red;
        c.textAlign = "left";
        const prev = c.letterSpacing;
        c.letterSpacing = "1.5px";
        c.fillText("E-TICKET / RESERVATION VOUCHER", brandTextX, yBand + 50);
        c.letterSpacing = prev;
    });

    const qrSize = 86;
    if (qrImg && qrImg.naturalWidth > 0) {
        const qrX = W - PDF_C.pad - qrSize + 2;
        blocks.push(c => {
            roundPdfRect(c, qrX - 6, yBand - 3, qrSize + 12, qrSize + 10, 10);
            c.fillStyle = "#ffffff";
            c.fill();
        });
        blocks.push(c => {
            c.imageSmoothingQuality = "high";
            c.drawImage(qrImg, qrX, yBand, qrSize, qrSize);
        });
    }
    y = yBand + qrSize + 8;
    dashedLine(x, y, w);
    y += 6;

    /* ===== RADIO SAFAR JOURNEY ===== */
    const rpTop = y;
    y += 4;
    y += addText({ text: "RADIO SAFAR JOURNEY", x: cx, y, size: 9.5, weight: 800, family: PDF_C.fontDisplay, fill: PDF_C.sub, align: "center", ls: 1.5 });
    const arrowW = 34;
    const colW = (innerW - arrowW) / 2;
    const colL = xl;
    const colR = xl + colW + arrowW;
    const yRouteTop = y;
    const rlH = addRouteCity(details.start.toUpperCase(), "FROM", colL, yRouteTop, colW, "left");
    const rrH = addRouteCity(details.dest.toUpperCase(), "DESTINATION", colR, yRouteTop, colW, "right");
    const rH = Math.max(rlH, rrH);
    blocks.push(c => {
        c.font = pdfFont(800, 18, PDF_C.fontSans);
        c.fillStyle = PDF_C.amberDark;
        c.textAlign = "center";
        c.fillText("\u2192", colL + colW + arrowW / 2, yRouteTop + Math.min(rlH, rrH) / 2 + 8);
    });
    y = yRouteTop + rH;
    const meta = `DEPARTURE ${details.departure}  \u2022  BAY ${details.bay}  \u2022  VIA ${details.nh}  \u2022  ${details.date}`;
    y += 6;
    y += addText({ text: meta, x: cx, y, size: 8, weight: 800, family: PDF_C.fontMono, fill: PDF_C.amberDark, align: "center", maxWidth: innerW - 16 });
    y += 5;
    panel(rpTop, 5, PDF_C.panel);
    y += 1;

    /* ===== JOURNEY DETAILS ===== */
    const jdTop = y;
    y += 4;
    y += addSectionHeader("JOURNEY DETAILS");

    const jGap = 12;
    const jColW = (innerW - jGap) / 2;
    const journeyRows = [
        [
            ["Class of Service", "AC SLEEPER", false],
            ["Bus Type/Model", details.busType, false]
        ],
        [
            ["Vehicle Registration No.", details.regNo, true],
            ["Boarding Bay", details.boardingBay, false]
        ],
        [
            ["Reporting Time", details.reportingTime, false],
            ["Captain", details.captain, false]
        ],
        [
            ["Luggage Allowance", details.luggage, false],
            ["Seat No(s)", details.seat, false]
        ]
    ];
    for (const row of journeyRows) {
        let rowH = 0;
        for (let ci = 0; ci < 2; ci++) {
            const [lab, val, mono] = row[ci];
            rowH = Math.max(rowH, addField({ label: lab.toUpperCase(), value: val, mono, fill: mono ? PDF_C.amberDark : PDF_C.ink, ox: xl + ci * (jColW + jGap), oy: y, colW: jColW, size: 9 }));
        }
        y += rowH + 2;
    }
    y += 1;
    panel(jdTop, 2);
    y += 1;

    /* ===== PASSENGER INFORMATION ===== */
    const ppTop = y;
    y += 2;
    y += addSectionHeader("PASSENGER INFORMATION");
    const pCells = [
        ["Passenger Name", details.name, PDF_C.ink],
        ["Age", String(details.age), PDF_C.soft],
        ["Adult / Child", details.type, PDF_C.soft],
        ["Gender", details.gender, PDF_C.soft],
        ["Origin", details.start, PDF_C.soft],
        ["Destination", details.dest, PDF_C.soft]
    ];
    const pGap = 10;
    const pCellW = (innerW - (pCells.length - 1) * pGap) / pCells.length;
    let px = xl;
    let prowH = 0;
    for (const [lab, val, fill] of pCells) {
        prowH = Math.max(prowH, addField({ label: lab.toUpperCase(), value: val, ox: px, oy: y, colW: pCellW, size: 9, fill }));
        px += pCellW + pGap;
    }
    y += prowH + 2;
    panel(ppTop, 2);
    y += 1;

    /* ===== BOOKING REFERENCES ===== */
    const bkTop = y;
    y += 2;
    y += addSectionHeader("BOOKING REFERENCES");
    const refs = [
        ["PNR Number", details.pnr],
        ["Trip Code", details.tripCode],
        ["Transaction ID", details.txn],
        ["Ticket ID", details.ticketId]
    ];
    const bGap = 10;
    const bBoxW = (innerW - 3 * bGap) / 4;
    const yBox = y;
    const boxH = 30;
    refs.forEach(([lab, val], i) => {
        const boxX = xl + i * (bBoxW + bGap);
        blocks.push(c => { roundPdfRect(c, boxX, yBox, bBoxW, boxH, 7); c.fillStyle = PDF_C.boxBg; c.fill(); c.lineWidth = 1; c.strokeStyle = PDF_C.dashed; c.stroke(); });
        addField({ label: lab.toUpperCase(), value: val, ox: boxX + 8, oy: yBox + 2, colW: bBoxW - 16, size: 8.5, mono: true, fill: PDF_C.ink });
    });
    y += boxH;
    panel(bkTop, 2);
    y += 1;

    /* ===== CURRENT RADIO SAFAR ===== */
    const safarTop = y;
    y += 4;
    y += addSectionHeader("CURRENT RADIO SAFAR");
    const safarCols = [["Safar", details.safar, PDF_C.amberDark], ["Now Playing", details.song, PDF_C.ink]];
    if (details.artist) safarCols.push(["Artist", details.artist, PDF_C.soft]);
    const scGap = 20;
    const scW = (innerW - (safarCols.length - 1) * scGap) / safarCols.length;
    let sh = 0;
    safarCols.forEach(([lab, val, fill], i) => {
        sh = Math.max(sh, addField({ label: lab.toUpperCase(), value: val, ox: xl + i * (scW + scGap), oy: y, colW: scW, size: 10, fill }));
    });
    y += sh + 1;
    panel(safarTop, 4);
    y += 1;

    /* ===== FARE DETAILS ===== */
    const fareTop = y;
    y += 2;
    y += addSectionHeader("FARE DETAILS");
    y += 1;
    const fareCols = (details.fareBreakdown && details.fareBreakdown.length) ? details.fareBreakdown : [
        ["Base Fare", "₹450.00"],
        ["Nostalgia Surcharge", "₹99.00"],
        ["Chai Tax (GST)", "₹50.00"]
    ];
    const fGap = 12;
    const fColW = (innerW - 2 * fGap) / 3;
    let fh = 0;
    fareCols.forEach(([lab, val], i) => {
        fh = Math.max(fh, addField({ label: lab.toUpperCase(), value: val, ox: xl + i * (fColW + fGap), oy: y, colW: fColW, size: 10, fill: PDF_C.soft }));
    });
    y += fh + 3;
    dashedLine(xl + 10, y, innerW - 20);
    y += 7;
    addText({ text: "TOTAL FARE", x: xl, y, size: 8, weight: 800, family: PDF_C.fontSans, fill: PDF_C.sub, ls: 2 });
    addText({ text: details.fare, x: xl + innerW, y, size: 19, weight: 900, family: PDF_C.fontSans, fill: PDF_C.red, align: "right" });
    y += 24;
    const fareWordsLine = details.fareWords || fareInWords(details.fare);
    addText({ text: fareWordsLine, x: xl, y, size: 8.5, weight: 800, family: PDF_C.fontMono, fill: PDF_C.soft, maxWidth: innerW });
    y += 11;
    const banner = "EXPERIENCE TICKET — NO PAYMENT REQUIRED";
    const bannerFont = pdfFont(800, 8.5, PDF_C.fontSans);
    const bctx = pdfCtx();
    bctx.font = bannerFont;
    const bannerH = 17;
    const yBanner = y;
    blocks.push(c => { roundPdfRect(c, xl, yBanner, innerW, bannerH, 6); c.fillStyle = PDF_C.redBg; c.fill(); });
    blocks.push(c => {
        c.font = bannerFont;
        c.fillStyle = PDF_C.red;
        c.textAlign = "center";
        const prev = c.letterSpacing;
        c.letterSpacing = "1.2px";
        c.fillText(banner, xl + innerW / 2, yBanner + bannerH - 4);
        c.letterSpacing = prev;
    });
    y += bannerH + 2;
    panel(fareTop, 2);
    y += 1;

    /* ===== IMPORTANT PASSENGER TERMS ===== */
    y += addSectionHeader("IMPORTANT PASSENGER TERMS", 10.5);
    const termFont = pdfFont(500, 8, PDF_C.fontSans);
    const termCtx = pdfCtx();
    termCtx.font = termFont;
    const indent = 16;
    const termLineH = Math.round(8 * 1.18);

    const fineFont = pdfFont(700, 8, PDF_C.fontSans);
    const fineCtx = pdfCtx();
    fineCtx.font = termFont;
    FINE_PRINT.forEach(entry => {
        const yRule = y;
        const colon = entry.indexOf(":");
        const head = entry.slice(0, colon + 1).trimEnd() + " ";
        const lines = wrapPdfLines(termCtx, entry, termFont, innerW);
        const headW = fineCtx.measureText(head).width;
        blocks.push(c => {
            c.font = fineFont;
            c.fillStyle = PDF_C.red;
            c.textAlign = "left";
            c.fillText(head, xl, yRule + termLineH);
            c.font = termFont;
            c.fillStyle = PDF_C.soft;
            const firstBody = lines[0].slice(head.length);
            if (firstBody) c.fillText(firstBody, xl + headW, yRule + termLineH);
            for (let ln = 1; ln < lines.length; ln++) {
                c.fillText(lines[ln], xl, yRule + termLineH + ln * termLineH);
            }
        });
        y += Math.max(lines.length, 1) * termLineH + 3;
    });
    y += 4;
    dashedLine(xl + 10, y, innerW - 20);
    y += 5;
    PDF_RULES.forEach((rule, i) => {
        const yRule = y;
        const lines = wrapPdfLines(termCtx, `${i + 1}.  ${rule}`, termFont, innerW - indent);
        blocks.push(c => {
            c.font = termFont;
            c.fillStyle = PDF_C.soft;
            c.textAlign = "left";
            for (let ln = 0; ln < lines.length; ln++) {
                c.fillText(lines[ln], ln === 0 ? xl : xl + indent, yRule + termLineH + ln * termLineH);
            }
        });
        y += lines.length * termLineH;
    });
    y += 6;

    /* ===== FOOTER / DISCLAIMER ===== */
    dashedLine(x, y, w);
    y += 6;
    y += addText({ text: "PASSENGER COPY · FICTIONAL RADIO SAFAR EXPERIENCE TICKET", x: cx, y, size: 8, weight: 800, family: PDF_C.fontDisplay, fill: PDF_C.red, align: "center", ls: 1.5 });
    y += 8;
    y += addText({ text: `NO REAL BUS RESERVATION · NO PAYMENT REQUIRED · ${PDF_CARRIER}`, x: cx, y, size: 7.5, weight: 600, family: PDF_C.fontSans, fill: PDF_C.sub, align: "center", ls: 1 });
    y += 8;
    y += addText({ text: "RADIO SAFAR  •  https://radiosafar.vercel.app/", x: cx, y, size: 7.5, weight: 700, family: PDF_C.fontSans, fill: PDF_C.sub, align: "center", ls: 0.5 });
    y += 10;

    return { back, blocks, height: y };
}

function paintTicketCard(c, W, H) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PDF_C.bgTop);
    g.addColorStop(1, PDF_C.bgBottom);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    const roundPath = (x, y, w, h, r) => {
        const radius = Math.max(0, Math.min(r, w / 2, h / 2));
        c.beginPath();
        if (typeof c.roundRect === "function") {
            c.roundRect(x, y, w, h, radius);
        } else {
            c.moveTo(x + radius, y);
            c.arcTo(x + w, y, x + w, y + h, radius);
            c.arcTo(x + w, y + h, x, y + h, radius);
            c.arcTo(x, y + h, x, y, radius);
            c.arcTo(x, y, x + w, y, radius);
            c.closePath();
        }
    };

    /* crisp ticket edge — professional border, no glow/shadow outside it */
    roundPath(1, 1, W - 2, H - 2, 14);
    c.lineWidth = 1.6;
    c.strokeStyle = "rgba(122,88,46,0.8)";
    c.stroke();

    /* side tear-off perforation lines with punched notches */
    const top = 120;
    const bottom = Math.max(top, H - 120);
    const step = Math.max(40, Math.round((bottom - top) / 6));
    const notchYs = [];
    for (let yy = top; yy <= bottom; yy += step) notchYs.push(yy);

    [14, W - 14].forEach(px => {
        c.save();
        c.setLineDash([4, 5]);
        c.strokeStyle = "rgba(122,88,46,0.45)";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px, top);
        c.lineTo(px, bottom);
        c.stroke();
        c.restore();
        notchYs.forEach(yy => {
            c.save();
            c.setLineDash([2, 3]);
            c.strokeStyle = "rgba(122,88,46,0.55)";
            c.lineWidth = 1;
            c.beginPath();
            c.arc(px, yy, 7.5, 0, Math.PI * 2);
            c.stroke();
            c.restore();
            c.save();
            c.fillStyle = "#fbf2da";
            c.beginPath();
            c.arc(px, yy, 5, 0, Math.PI * 2);
            c.fill();
            c.restore();
        });
    });
}

async function renderTicketPdfCanvas(details, scale = PDF_RENDER_SCALE) {
    const [logo, qrImg] = await Promise.all([radioSafarLogo(), qrImageFor(details)]);
    if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (err) { /* best-effort font wait */ }
    }
    const { back, blocks, height } = makeTicketLayout(details, logo, qrImg);
    const W = TICKET_W;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(W * scale);
    canvas.height = Math.ceil(height * scale);
    const c = canvas.getContext("2d");
    c.scale(scale, scale);
    c.textBaseline = "alphabetic";
    paintTicketCard(c, W, height);
    for (const paint of back) paint(c);
    for (const paint of blocks) paint(c);
    return canvas;
}

async function renderTicketJpegDataUrl(details) {
    const canvas = await renderTicketPdfCanvas(details);
    return {
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        width: canvas.width,
        height: canvas.height
    };
}

function decodeDataUrlBytes(dataUrl) {
    const comma = dataUrl.indexOf(",");
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function latinBytesToString(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

/**
 * Single-page A4 portrait PDF (595 x 842 pt). The rendered ticket JPEG is
 * scaled to PDF_EMBED_W_PT logical points wide and its height derived from
 * the image's true aspect ratio; the fit is then verified against the A4
 * content height and, if the ticket is a touch taller than the intended
 * fill height, it is scaled down (fit-and-centre) so the complete ticket
 * always fits one A4 page with nothing cropped and nothing spilled to a
 * second sheet. Pure string assembly — no external writer needed.
 */
function buildTicketPdf(jpegDataUrl, imgWpx, imgHpx) {
    if (!jpegDataUrl || typeof jpegDataUrl !== "string" || !jpegDataUrl.startsWith("data:image/jpeg")) {
        throw new Error("Ticket render produced an unusable image.");
    }
    if (!Number.isFinite(imgWpx) || !Number.isFinite(imgHpx) || imgWpx <= 0 || imgHpx <= 0) {
        throw new Error("Ticket render produced invalid dimensions.");
    }
    const bytes = decodeDataUrlBytes(jpegDataUrl);
    if (!bytes.length) throw new Error("Ticket image is empty.");

    /* fixed A4 portrait page in PostScript points */
    const A4_W = 595;
    const A4_H = 842;
    const m = PDF_MARGIN_PT;
    const availableW = A4_W - 2 * m;
    const availableH = A4_H - 2 * m;
    const wantedW = PDF_EMBED_W_PT;
    const wantedH = PDF_EMBED_H_MAX;
    const fit = Math.min(1, wantedW / (wantedH * imgWpx / imgHpx), availableW / imgWpx, availableH / imgHpx);

    const imgW = imgWpx * fit;
    const imgH = imgHpx * fit;
    if (imgW > availableW + 0.01 || imgH > availableH + 0.01) {
        throw new Error("Ticket does not fit on a single A4 page.");
    }
    const xm = (A4_W - imgW) / 2;
    const ym = (A4_H - imgH) / 2;

    const content = `q ${imgW.toFixed(2)} 0 0 ${imgH.toFixed(2)} ${xm.toFixed(2)} ${ym.toFixed(2)} cm /Im1 Do Q`;

    let pdf = "%PDF-1.4\n";
    const off = [];
    off.push(pdf.length);
    pdf += "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
    off.push(pdf.length);
    pdf += "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
    off.push(pdf.length);
    pdf += `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W.toFixed(2)} ${A4_H.toFixed(2)}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`;
    off.push(pdf.length);
    pdf += `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWpx} /Height ${imgHpx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`;
    pdf += latinBytesToString(bytes);
    pdf += "\nendstream\nendobj\n";
    off.push(pdf.length);
    pdf += `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
    off.push(pdf.length);
    pdf += `xref\n0 6\n0000000000 65535 f \n`;
    for (let i = 0; i < 5; i++) {
        pdf += String(off[i]).padStart(10, "0") + " 00000 n \n";
    }
    pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${off[5]}\n%%EOF`;

    if (pdf.length === 0) throw new Error("PDF assembly produced an empty document.");
    if (!pdf.startsWith("%PDF-")) throw new Error("PDF assembly failed: missing %PDF- header.");
    if (!pdf.endsWith("%%EOF")) throw new Error("PDF assembly failed: missing %%EOF footer.");

    const pdfBytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) pdfBytes[i] = pdf.charCodeAt(i);
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    if (blob.size !== pdfBytes.length) throw new Error("PDF blob size mismatch.");
    return blob;
}

function assertValidPdfBlob(blob) {
    if (!(blob instanceof Blob)) throw new Error("PDF generation did not return a Blob");
    if (blob.type !== "application/pdf") throw new Error(`Generated file is not a PDF (got "${blob.type}")`);
    if (!blob.size || blob.size <= 0) throw new Error("Generated PDF is empty (0 bytes)");
    return true;
}

function downloadBlob(blob, filename) {
    if (!(blob instanceof Blob) || !blob.size || blob.size <= 0) {
        throw new Error("Refusing to download an empty file");
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function showStatus(ui, message) {
    ui.ticketStatus.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { ui.ticketStatus.textContent = ""; }, 2800);
}

function ticketPdfFilename(details) {
    return `Radio-Safar-Travels-Ticket-${details.ticketId}.pdf`;
}

async function downloadTicket(ui) {
    if (!currentDetails) return;
    showStatus(ui, "Preparing ticket…");
    try {
        const jpeg = await renderTicketJpegDataUrl(currentDetails);
        const blob = buildTicketPdf(jpeg.dataUrl, jpeg.width, jpeg.height);
        assertValidPdfBlob(blob);
        downloadBlob(blob, ticketPdfFilename(currentDetails));
        showStatus(ui, "Ticket downloaded.");
    } catch (err) {
        console.error("Ticket PDF export failed:", err);
        showStatus(ui, "Unable to create the PDF. Please try again.");
    }
}

async function copyTicketDetails(ui) {
    const fill = key => ui.ticket.querySelector(`[data-fill="${key}"]`)?.textContent || "";
    const text = [
        "My Radio Safar Travels journey! 🎫",
        `${fill("name")} · Age ${fill("age")} · ${fill("type")}`,
        `${fill("start")} → ${fill("dest")} · ${fill("nh")}`,
        `Date: ${fill("date")} · ${fill("departure")}`,
        `Seat: ${fill("seat")} · Bay ${fill("bay")}`,
        `PNR: ${fill("pnr")} · Trip: ${fill("tripcode")} · Txn: ${fill("txn")}`,
        `Safar: ${fill("safar")} · Now Playing: ${fill("song")}`,
        "A fictional Radio Safar experience ticket — not a real reservation."
    ].join("\n");
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        /* clipboard unavailable — nothing else to do */
    }
}

async function shareTicket(ui) {
    if (!currentDetails) return;
    try {
        const jpeg = await renderTicketJpegDataUrl(currentDetails);
        const pdfBlob = buildTicketPdf(jpeg.dataUrl, jpeg.width, jpeg.height);
        assertValidPdfBlob(pdfBlob);
        const file = new File([pdfBlob], ticketPdfFilename(currentDetails), { type: "application/pdf" });
        if (!(file.size > 0)) throw new Error("Share file is empty");
        const base = {
            title: "My Radio Safar Ticket",
            text: "My Radio Safar Travels journey is ready! 🎫"
        };

        if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], ...base });
                return;
            } catch (err) {
                if (err && err.name === "AbortError") return;
            }
        }
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ ...base, url: location.href });
                return;
            } catch (err) {
                if (err && err.name === "AbortError") return;
            }
        }
        await copyTicketDetails(ui);
        showStatus(ui, "Ticket details copied.");
    } catch (err) {
        console.error("Ticket share failed:", err);
        await copyTicketDetails(ui);
        showStatus(ui, "Ticket details copied.");
    }
}



/* ===== PUBLIC API ===== */

export function openTicket(ui) {
    resetForm(ui);
    setStage(ui, "form");
    ui.ticketModal.classList.add("open");
    ui.ticketModal.setAttribute("aria-hidden", "false");
    const nameEl = ui.ticketForm.elements.name;
    if (nameEl) nameEl.focus();
}

export function closeTicketModal(ui) {
    if (!ui.ticketModal.classList.contains("open")) return;
    ui.ticketModal.classList.remove("open");
    ui.ticketModal.setAttribute("aria-hidden", "true");
    ui.ticketBtn?.focus();
}

export function initTicket(ui) {
    if (!ui.ticketBtn || !ui.ticketModal || !ui.ticketForm) return;

    ui.ticketBtn.addEventListener("click", () => openTicket(ui));
    ui.ticketClose.addEventListener("click", () => closeTicketModal(ui));
    ui.ticketModal.addEventListener("click", event => {
        if (event.target === ui.ticketModal) closeTicketModal(ui);
    });

    ui.ticketForm.addEventListener("submit", event => {
        event.preventDefault();
        const value = key => {
            const ctrl = ui.ticketForm.elements.namedItem(key);
            return ctrl && ctrl.value !== undefined ? ctrl.value : "";
        };
        const rawValues = {
            name: value("name"),
            age: value("age"),
            gender: value("gender"),
            type: value("passengerType"),
            date: value("journeyDate"),
            start: value("startCity"),
            dest: value("destCity")
        };
        const clean = {
            name: normalizeField(rawValues.name),
            age: normalizeField(rawValues.age),
            gender: normalizeField(rawValues.gender),
            type: normalizeField(rawValues.type),
            date: normalizeField(rawValues.date),
            start: normalizeField(rawValues.start),
            dest: normalizeField(rawValues.dest)
        };
        const errors = validateInputs(clean);
        showErrors(ui, errors);
        if (Object.keys(errors).length) return;

        currentDetails = buildJourney(clean, getPlayerSnapshot());
        populateTicket(ui, currentDetails);
        setStage(ui, "result");
    });

    ui.ticketEdit.addEventListener("click", () => {
        if (!currentDetails) return;
        setStage(ui, "form");
        ui.ticketForm.elements.name.focus();
    });

    ui.ticketDownload.addEventListener("click", () => downloadTicket(ui));
    ui.ticketShare.addEventListener("click", () => shareTicket(ui));
}

/* Testable internals — used by the ticket QA harness to render and inspect
 * the exact JPEG + PDF produced for a given journey (not public UI API). */
export { makeTicketLayout, renderTicketPdfCanvas, renderTicketJpegDataUrl, buildTicketPdf, buildJourney, TICKET_W, PDF_RULES, FINE_PRINT, PDF_CARRIER, PDF_EMBED_H_MAX, validateInputs, normalizeField, fareInWords, qrDataUrl, qrPayload, numberToWordsIndian, isValidTime, addMinutesToTime, formatTimeLabel };