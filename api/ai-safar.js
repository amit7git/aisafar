/**
 * AI Safar — server-side Gemini endpoint (Vercel serverless function).
 *
 * Browser → POST /api/ai-safar → this function → Gemini → validated JSON → browser.
 *
 * SECURITY:
 *  - GEMINI_API_KEY is read from process.env only. It is never bundled, never
 *    prefixed VITE_, never returned to the client, and never written to logs.
 *  - The AI may only emit allowlisted action types. select_safar may only use
 *    an existing Safar key from the project's playlist configuration.
 *  - No arbitrary code, function names, or JavaScript is ever accepted/executed.
 *  - Raw Gemini errors are never forwarded to the client.
 *
 * COST CONTROL + ABUSE PROTECTION (stay on the Gemini free tier):
 *  - Request body capped (streamed) at MAX_BODY_BYTES + early 413 via
 *    Content-Length when present.
 *  - User message capped at MAX_MESSAGE_LENGTH; player context fields capped.
 *  - Gemini output capped at MAX_OUTPUT_TOKENS and the sanitized message capped
 *    again at MAX_RESPONSE_MESSAGE_LENGTH.
 *  - Gemini call aborts after GEMINI_TIMEOUT_MS so a slow/looping model cannot
 *    hold cost or run past the platform's execution limit.
 *  - A lightweight in-memory sliding-window limiter gates how many Gemini calls
 *    this instance accepts per window, plus a per-tab/per-session limiter keyed
 *    by the anonymous X-AI-SAFAR-SESSION header the client generates. Best
 *    effort only — in-memory, per instance, reset on cold start. No database,
 *    no accounts, no distributed rate limiting.
 *  - A tiny in-instance concurrency guard prevents a burst from stacking
 *    parallel Gemini calls.
 *  - 429/504 (rate limit / upstream timeout) and 403 (quota/auth denied) are
 *    mapped to friendly messages; AI unavailability NEVER affects playback —
 *    the failure path simply returns an empty actions list.
 *
 * The browser never sees the key; only the validated { message, actions } result.
 *
 * See docs/AI-SAFAR-PROTECTIONS.md for the full protection inventory.
 */

import { MOOD_PLAYLISTS } from '../src/config/playlists.js';
import { getSafarSemantics, findSemanticDrift } from '../src/config/safar-semantics.js';

const ALLOWED_ACTIONS = new Set([
    'play',
    'pause',
    'next',
    'previous',
    'shuffle',
    'select_safar'
]);

const SAFAR_KEYS = new Set(Object.keys(MOOD_PLAYLISTS));

const MAX_MESSAGE_LENGTH = 500;
const MAX_CONTEXT_FIELD = 200;
const MAX_RESPONSE_MESSAGE_LENGTH = 400;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ACTIONS = 4;
const MAX_OUTPUT_TOKENS = 512;
const GEMINI_TIMEOUT_MS = 9000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const RATE_WINDOW_MS = 60 * 1000;
const RATE_PER_INSTANCE = 20;
const RATE_PER_SESSION = 12;
const MAX_CONCURRENCY = 2;
const SESSION_HEADER = 'x-ai-safar-session';
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const STATUS_VALUES = new Set(['playing', 'paused', 'idle']);

/**
 * Sliding-window in-memory limiter. Tracks every attempt; in a window of at
 * most `max` accepted attempts. Cheap, synchronous, no timers (entries expire
 * lazily on access, so nothing keeps the process alive). `now` is injectable
 * for tests.
 */
export function createSlidingLimiter({ windowMs, max, now = () => Date.now() }) {
    const log = [];
    return function allow() {
        const t = now();
        while (log.length && log[0] <= t - windowMs) log.shift();
        if (log.length >= max) return false;
        log.push(t);
        return true;
    };
}

/**
 * Tiny in-instance concurrency guard — never lets a burst of requests run more
 * than `max` Gemini calls at the same time in this process. Released in a
 * finally block by the caller.
 */
export function createConcurrencyGuard(max) {
    let active = 0;
    return {
        acquire() {
            if (active >= max) return false;
            active++;
            return true;
        },
        release() {
            if (active > 0) active--;
        }
    };
}

/**
 * Read and validate the anonymous, per-tab session id the client generates.
 * Not an account, not a user identifier — just a random tag per open tab so we
 * can catch accidental rapid repeat taps. Invalid/absent ids fall back to the
 * instance-wide limiter only.
 */
export function readSessionId(req) {
    const raw = req?.headers?.[SESSION_HEADER];
    if (typeof raw !== 'string') return null;
    const id = raw.trim().slice(0, 64);
    return SESSION_ID_RE.test(id) ? id : null;
}

const instanceLimiter = createSlidingLimiter({ windowMs: RATE_WINDOW_MS, max: RATE_PER_INSTANCE });
const sessionLimiters = new Map();
const concurrencyGuard = createConcurrencyGuard(MAX_CONCURRENCY);

function allowAiCall(sessionId) {
    if (!instanceLimiter()) return false;
    if (!sessionId) return true;
    let limiter = sessionLimiters.get(sessionId);
    if (!limiter) {
        limiter = createSlidingLimiter({ windowMs: RATE_WINDOW_MS, max: RATE_PER_SESSION });
        sessionLimiters.set(sessionId, limiter);
    }
    return limiter();
}

/**
 * Sanitize the client-provided read-only player state snapshot.
 *
 * This payload is UNTRUSTED input that only tweets the LLM's perception of
 * current playback — it can never change the player. Only the whitelisted,
 * length-capped fields are kept, `safarKey` must be a real SAFAR_KEYS value,
 * and nothing is stored or logged. Privacy: no user IDs, no conversation or
 * listening history is persisted anywhere — this stays in-memory for the reply.
 */
export function sanitizeContext(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const str = value => (typeof value === 'string' ? value.trim().slice(0, MAX_CONTEXT_FIELD) : '');

    const safarKey = typeof raw.safarKey === 'string' && SAFAR_KEYS.has(raw.safarKey)
        ? raw.safarKey
        : null;

    const trackTitle = str(raw.trackTitle);
    const trackArtist = str(raw.trackArtist);

    const status = STATUS_VALUES.has(raw.status) ? raw.status : 'idle';
    const shuffle = raw.shuffle === true;

    const context = {
        safarKey,
        safarLabel: str(raw.safarLabel),
        trackTitle: trackTitle || null,
        trackArtist: trackArtist || null,
        status,
        shuffle
    };

    if (!context.safarKey && !context.trackTitle) return null;

    return context;
}

const FRIENDLY_ERRORS = {
    400: 'Woh baat pura samajh nahi aayi. Ek baar phir se boliye.',
    405: 'This endpoint only accepts POST requests.',
    413: 'Woh message thoda bada tha. Chhota karke boliye.',
    429: 'Safar Saathi abhi ek saans le raha hai. Thodi baat baad phir try kariye.',
    403: 'Safar Saathi sirf Radio Safar pe milta hai.',
    500: 'Safar Saathi ko roadblock laga. Ek min baad phir try kariye.',
    502: 'Safar Saathi tak baat nahi pahunchi. Ek min baad try kariye.',
    503: 'Safar Saathi abhi ghhar pe nahi hai. Kuch der baad aa jaayega.',
    504: 'Safar Saathi ko thoda samay lag raha hai. Phir se try kariye.'
};

function respond(res, status, obj) {
    const payload = typeof obj === 'string' ? { message: obj, actions: [] } : obj;
    res.status(status).json(payload);
}

function sendCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${SESSION_HEADER}`);
}

/**
 * The endpoint is same-origin only: the browser page and /api/ai-safar live on
 * the same host. Reject cross-origin browsers so a random third-party page
 * cannot trigger (rate-limited but real) Gemini calls against this deployment's
 * free-tier quota. Non-browser clients without an Origin header are unaffected.
 */
export function isAllowedOrigin(req) {
    const origin = req.headers?.['origin'];
    if (!origin) return true;
    let originHost;
    try {
        originHost = new URL(origin).host;
    } catch {
        return false;
    }
    const host = req.headers?.['host'] || '';
    return originHost === host;
}

function normalizeError(err) {
    if (err && typeof err.status === 'number') {
        // 429 = upstream rate limit / quota exhaustion; 504 = upstream timeout.
        if (err.status === 429 || err.status === 504) return err.status;
        // 403 = key/quota denied — the model is unreachable for this key.
        if (err.status === 403) return 503;
        return 502;
    }
    return 502;
}

async function parseBody(req) {
    if (req.body !== undefined) {
        return (req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : null;
    }
    return new Promise(resolve => {
        let raw = '';
        let done = false;
        req.setEncoding('utf8');
        req.on('data', chunk => {
            if (done) return;
            raw += chunk;
            if (raw.length > MAX_BODY_BYTES) {
                done = true;
                resolve(null);
            }
        });
        req.on('end', () => {
            if (done) return;
            try { resolve(JSON.parse(raw)); } catch { resolve(null); }
        });
        req.on('error', () => resolve(null));
    });
}

function validateMessage(body) {
    const message = body && body.message;
    if (typeof message !== 'string') {
        return { ok: false, status: 400, reason: 'message must be a string' };
    }
    const trimmed = message.trim();
    if (!trimmed) return { ok: false, status: 400, reason: 'message cannot be empty' };
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
        return { ok: false, status: 400, reason: `message is too long (max ${MAX_MESSAGE_LENGTH} chars)` };
    }
    return { ok: true, message: trimmed };
}

function buildSafarContextLines() {
    return Object.entries(MOOD_PLAYLISTS).map(([key, s]) => {
        const sem = getSafarSemantics(key);
        let line = `- "${key}" — ${s.label} (${s.description})`;
        if (sem) {
            const parts = [
                `mood: ${sem.mood.join(' / ')}`,
                `language: ${sem.language.join(' / ')}`,
                `era: ${sem.era.join(' / ')}`,
                `fits: ${sem.situation.join(', ')}`,
                `cues: ${sem.keywords.join(', ')}`
            ];
            line += `\n  ${parts.join(' | ')}`;
        }
        return line;
    }).join('\n');
}

function buildPlayerStateBlock(context) {
    if (!context) {
        return [
            'CURRENT PLAYER STATE: unavailable.',
            'If the user asks what is playing / which Safar is on / whether music is paused, say you do not have live playback details right now — NEVER guess.'
        ].join('\n');
    }

    const lines = [
        'CURRENT PLAYER STATE (read-only ground truth for ANY question about current playback):',
        context.safarKey ? `- Active Safar: "${context.safarKey}" labeled "${context.safarLabel || context.safarKey}"` : '- Active Safar: unavailable',
        context.trackTitle
            ? `- Currently playing track: "${context.trackTitle}"${context.trackArtist ? ` by ${context.trackArtist}` : ''}`
            : '- Currently playing track: no track information available',
        `- Playback status: ${context.status}`,
        `- Shuffle: ${context.shuffle ? 'on' : 'off'}`
    ];
    lines.push(
        'Rules for playback questions:',
        '- "What is playing?", "which Safar is on?", "is the music paused/playing?", "is shuffle on?" -> answer ONLY from the state above.',
        '- NEVER claim a song, artist, or Safar is playing unless it is listed above.',
        '- If a field is "unavailable", say so plainly and pivot to mood/decade talk.'
    );
    return lines.join('\n');
}

export function buildSystemPrompt(playerContext = null) {
    const safarLines = buildSafarContextLines();

    const actionGuide = [
        'ACTION INTENT GUIDE — decide the ACTIONS from the user words:',
        '- "play", "start", "bajao", "baja do", "gaana chalao", "play karo" -> "play"',
        '- "pause", "rok do", "stop", "ruko", "tham ja", "gaana rok do" -> "pause"',
        '- "next", "agar wala", "agla gaana", "agla", "next song" -> "next"',
        '- "previous", "pichhla gaana", "pichhla", "pehle wala", "peecha" -> "previous"',
        '- "shuffle", "random", "random gaana", "mix kar do" -> "shuffle"',
        '- A specific Safar/language/mood request -> "select_safar" with the exact matching key below.',
        '- "chalao" / "bajao" attached to a Safar name (e.g. "bhojpuri chalao", "Punjabi songs play")'
            + ' means BOTH: emit "select_safar" (with the correct Safar) AND "play".',
        '- A plain "chalao" / "play" with no Safar named -> "play" only.'
    ].join('\n');

    const safarGuide = [
        'SAFAR MAPPING — the ONLY Safars that exist are the exact keys above. Map language/music requests LITERALLY:',
        '- bhojpuri, bhojpuri song/songs, bhojpuri gaane, bhojpuri gaana, bhojpuri chalao, bhojpuri music, bhojpuri safar -> "Bhojpuri"',
        '- 90s, nineties, 90s songs, 90s gaane, 90 ke gaane, purane 90s ke gaane -> "90s"',
        '- purane gaane, purani yaadein, nostalgia, nostalgic, retro, old songs, golden oldies, old hindi songs -> "Purani Jeans"',
        '- radha krishna, krishna bhajan, kanha, bhagwan ki bhakti, krishna songs -> "RadhaKrishna"',
        '- hare krishna, iskcon, mahamantra -> "HareKrishna"',
        '- bhakti, bhajan, aarti, sukoon, shanti, shraddha, devotional, mandir -> "Bhakti"',
        '- punjabi, bhangra, punjabi songs, punjabi gaane -> "Punjabi"',
        '- haryanvi, hariyanvi, haryana, jaat -> "Hariyanvi"',
        '- bhojpuri bhakti, bhojpuri bhajan, desi bhajan, devi gaane -> "Bhojpuri Bhakti"',
        '- shaadi, wedding, vivaah, mehndi, sangeet, rasm -> "Vivaah Geet"',
        '- chhath, chhathi maiya, chhath puja -> "Chhath Geet"',
        '- hindi, bollywood, hindi songs -> "Hindi"',
        '- english, english songs, chill vibes -> "English"',
        '- kannada, karnataka -> "Kannada"',
        '- tamil, tamilnadu, kollywood -> "Tamil"',
        '- telugu, tollywood, andhra -> "Telugu"',
        '- ai ka safar, surprise, experiment -> "AI made"'
    ].join('\n');

    const loyaltyRule = [
        'LITERAL SAFAR LOYALTY (most important rule):',
        '- When the user names a language, era, or Safar (bhojpuri, punjabi, 90s, krishna, chhath…) you MUST return that exact Safar key.',
        '- NEVER silently substitute a different Safar — e.g. NEVER pick "90s" for a Bhojpuri request.',
        '- If the same request contains two grounded hints, prefer the most specific language/Safar (e.g. "bhojpuri" beats a general mood).',
        '- If you are genuinely unsure which Safar the user means, reply with a SHORT clarifying question and NO actions — never guess a wrong Safar.'
    ].join('\n');

    let playerStateBlock = buildPlayerStateBlock(playerContext);
    if (playerStateBlock) { playerStateBlock = ['', playerStateBlock, '']; }

    return [
        'You are सफ़र साथी (Safar Saathi), the warm, cheerful radio companion and RJ of Radio Safar — a nostalgic Indian highway radio that streams YouTube playlists of evergreen songs. You feel like a friendly co-driver on a desi highway truck radio, not a generic assistant.',
        '',
        'RESPONSE LANGUAGE RULE (MANDATORY — responds strictly in Latin/English script):',
        '- Understand English, Hindi, and Hinglish/Roman Hindi user input — including Hindi typed in Devanagari. Understand the request internally.',
        '- ALWAYS respond using Latin/English script only.',
        '- You may respond in English, Roman Hindi, or Roman Hinglish.',
        '- NEVER use Devanagari, Bengali, Tamil, Telugu, Kannada, Gurmukhi, or any other non-Latin script in your response.',
        '- Even if the user writes Hindi in Devanagari, understand the request internally but answer only in English or Roman Hinglish.',
        '',
        'Examples:',
        'User: भोजपुरी गाना चलाओ',
        'Assistant: {"message": "Bilkul! Bhojpuri Safar chalu karte hain.", "actions": [{"type": "select_safar", "safar": "Bhojpuri"}]}',
        'User: bhojpuri gaana chalao',
        'Assistant: {"message": "Bilkul! Bhojpuri Safar chalu kar raha hoon.", "actions": [{"type": "select_safar", "safar": "Bhojpuri"}, {"type": "play"}]}',
        'User: play something romantic',
        'Assistant: {"message": "Sure! Chalo ek romantic Safar shuru karte hain.", "actions": [{"type": "select_safar", "safar": "Purani Jeans"}, {"type": "play"}]}',
        '',
        'Radio Safar can ONLY play songs from these EXACT Safars (playlists), with their intent hints. These are the only playlists that exist:',
        safarLines,
        '',
        actionGuide,
        '',
        safarGuide,
        '',
        loyaltyRule,
        ''
    ].concat(playerStateBlock || [], [
        'Allowed action types (use ONLY these exact strings):',
        '- "play" — start or resume playback',
        '- "pause" — pause playback',
        '- "next" — skip to the next track',
        '- "previous" — go back to the previous track',
        '- "shuffle" — toggle shuffle mode',
        '- "select_safar" — switch to a different Safar playlist. MUST include a "safar" field set to one of the exact playlist keys listed above.',
        '',
        'Strict rules:',
        '- NEVER invent a Safar or playlist. select_safar may only reference an exact key from the list above.',
        '- Only emit the actions that clearly follow from the user request (for example a request to "start" or "play music" emits "play").',
        '- NEVER claim a specific artist or song is currently playing unless that exact title/artist is listed in the CURRENT PLAYER STATE section below (you normally have none — so speak about mood, decade, and language instead, never a made-up song).',
        '- Reply in Latin/English script ONLY (see RESPONSE LANGUAGE RULE above). Short and full of highway-trucker charm, at most 40 words.',
        '',
        'Style (very important):',
        '- Talk like a young Indian radio co-host / RJ on a desi highway truck radio — warm, playful, filmi charm.',
        '- Keep replies SHORT: usually 1-3 brief sentences.',
        '- Begin with a natural reaction when it fits, e.g. "Samajh gaya…", "Arre wahi baat hai!", "Pakad liya bhai!", "Haan haan, bilkul!", "Chalo, karte hain!"',
        '- NEVER use formal AI-sounding phrases like "Certainly!", "Based on your request, I have determined…", "Here are your options…"',
        '- If unsure, pick the closest actual Safar and keep it simple.',
        '- Respond with ONLY a JSON object of the form {"message": "...", "actions": [{"type": "...", "safar": "..."}]}. No markdown, no code fences, no extra text.'
    ]).join('\n');
}

// One-time integrity warning if the semantic layer and playlist config drift apart.
const SEMANTIC_DRIFT = findSemanticDrift();
if (SEMANTIC_DRIFT.missing.length || SEMANTIC_DRIFT.unknown.length || SEMANTIC_DRIFT.absent.length) {
    console.error('[ai-safar] semantic drift detected (keys will NOT be served, validation is untouched):', JSON.stringify(SEMANTIC_DRIFT));
}

async function callGemini(apiKey, message, playerContext) {
    const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`;
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: buildSystemPrompt(playerContext) }] },
                contents: [{ role: 'user', parts: [{ text: message }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: MAX_OUTPUT_TOKENS,
                    responseMimeType: 'application/json'
                }
            }),
            signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
        });
    } catch (err) {
        if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            const e = new Error('GEMINI_TIMEOUT');
            e.status = 504;
            throw e;
        }
        throw err;
    }

    if (!response.ok) {
        const err = new Error(`GEMINI_HTTP_${response.status}`);
        err.status = response.status;
        throw err;
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map(p => (typeof p.text === 'string' ? p.text : '')).join('\n').trim();
}

function extractJson(text) {
    if (!text) return null;
    const trimmed = text.trim();
    try { return JSON.parse(trimmed); } catch {}
    try {
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenced) return JSON.parse(fenced[1]);
    } catch {}
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) {
        try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {}
    }
    return null;
}

export function sanitizeResponse(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const message = typeof parsed.message === 'string'
        ? parsed.message.trim().slice(0, MAX_RESPONSE_MESSAGE_LENGTH)
        : '';

    const actions = [];
    let sawSafarSwitch = false;

    if (Array.isArray(parsed.actions)) {
        for (const raw of parsed.actions.slice(0, MAX_ACTIONS)) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const type = raw.type;
            if (typeof type !== 'string' || !ALLOWED_ACTIONS.has(type)) continue;

            if (type === 'select_safar') {
                if (sawSafarSwitch) continue;
                const safar = typeof raw.safar === 'string' ? raw.safar : '';
                if (!SAFAR_KEYS.has(safar)) continue;
                sawSafarSwitch = true;
                actions.push({ type, safar });
            } else {
                actions.push({ type });
            }
        }
    }

    if (!message && !actions.length) return null;

    return {
        message: message || 'Haan, ho jaata hai. 🛻',
        actions
    };
}

// Latin/English-script enforcement — triggers a single safe rewrite attempt,
// then a graceful Latin fallback. Only the visible message text is touched;
// the structured actions are never modified.
const INDIC_SCRIPT_RE = new RegExp(
    '[' +
    '\\u0900-\\u097F' + // Devanagari
    '\\u0980-\\u09FF' + // Bengali + Assamese
    '\\u0A00-\\u0A7F' + // Gurmukhi
    '\\u0A80-\\u0AFF' + // Gujarati
    '\\u0B00-\\u0B7F' + // Oriya
    '\\u0B80-\\u0BFF' + // Tamil
    '\\u0C00-\\u0C7F' + // Telugu
    '\\u0C80-\\u0CFF' + // Kannada
    '\\u0D00-\\u0D7F' + // Malayalam
    ']'
);

export function hasNonLatinIndic(text) {
    return typeof text === 'string' && INDIC_SCRIPT_RE.test(text);
}

const LATIN_FALLBACK_MESSAGE = 'Got it. Let me keep the journey in English script. What would you like to play?';

async function attemptLatinRewrite(apiKey, safe, playerContext) {
    const instruction =
        'Rewrite ONLY the assistant message below using Latin/English script (English, Roman Hindi, or Roman Hinglish). ' +
        'Keep the exact same meaning and RJ tone. Never use Devanagari or any other non-Latin script.\n' +
        'Return the same JSON structure with the message rewritten and the actions unchanged ' +
        '(see response language rules from the radio system prompt).\n\n' +
        'Original response JSON: ' + JSON.stringify(safe);
    try {
        const rawText = await callGemini(apiKey, instruction, playerContext);
        const parsed = extractJson(rawText);
        const resanitized = sanitizeResponse(parsed);
        return resanitized ? resanitized.message : null;
    } catch {
        return null;
    }
}

export default async function handler(req, res) {
    sendCors(res);

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (!isAllowedOrigin(req)) {
        respond(res, 403, FRIENDLY_ERRORS[403]);
        return;
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        respond(res, 405, FRIENDLY_ERRORS[405]);
        return;
    }

    const declaredLength = Number(req.headers?.['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        respond(res, 413, FRIENDLY_ERRORS[413]);
        return;
    }

    const body = await parseBody(req);
    if (!body) {
        respond(res, 400, FRIENDLY_ERRORS[400]);
        return;
    }

    const check = validateMessage(body);
    if (!check.ok) {
        respond(res, check.status, FRIENDLY_ERRORS[check.status]);
        return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('[ai-safar] GEMINI_API_KEY not configured on the server.');
        respond(res, 503, FRIENDLY_ERRORS[503]);
        return;
    }

    // Cheap inputs (405/400/413/503-above) never reached rate limiting or Gemini.
    // Only requests headed for a Gemini call are counted against the budget.
    const sessionId = readSessionId(req);
    if (!allowAiCall(sessionId)) {
        respond(res, 429, FRIENDLY_ERRORS[429]);
        return;
    }
    if (!concurrencyGuard.acquire()) {
        respond(res, 429, FRIENDLY_ERRORS[429]);
        return;
    }

    const playerContext = sanitizeContext(body && body.context);

    try {
        const rawText = await callGemini(apiKey, check.message, playerContext);
        const parsed = extractJson(rawText);
        const safe = sanitizeResponse(parsed);
        if (!safe) {
            console.error('[ai-safar] Gemini returned an invalid or unsupported response.');
            respond(res, 502, FRIENDLY_ERRORS[502]);
            return;
        }

        // Enforce Latin/English script on the visible message. Actions are
        // already validated and remain untouched (they may still execute).
        let message = safe.message;
        if (hasNonLatinIndic(message)) {
            const rewritten = await attemptLatinRewrite(apiKey, safe, playerContext);
            message = rewritten && !hasNonLatinIndic(rewritten)
                ? rewritten
                : LATIN_FALLBACK_MESSAGE;
        }
        respond(res, 200, { message, actions: safe.actions });
    } catch (err) {
        const status = normalizeError(err);
        console.error(`[ai-safar] request failed; status=${status}`);
        respond(res, status, FRIENDLY_ERRORS[status] || FRIENDLY_ERRORS[502]);
    } finally {
        concurrencyGuard.release();
    }
}