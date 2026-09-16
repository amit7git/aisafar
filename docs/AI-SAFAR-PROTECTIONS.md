# AI Safar — Cost Control & Abuse Protection

Goal: AI Safar works on the **Gemini free tier** with **zero paid services**,
**no accounts/authentication**, and **no database**. These protections are
deliberately lightweight and local — no distributed rate limiting.

Scope: `POST /api/ai-safar` (server), plus the client-side send path
(`src/services/ai-api.js`, `src/components/ai-safar.js`).

---

## 1. Request body size

| What | Value | Where |
| --- | --- | --- |
| Max body | 16 KB | `MAX_BODY_BYTES`, `api/ai-safar.js` |
| Early reject | `413` when `Content-Length` exceeds the cap | `handler()` |
| Streaming reject | body is truncated+nulled mid-stream if it grows past the cap → `400` | `parseBody()` |

A valid request is tiny (`message` ≤ 500 chars + a few context fields), so the
cap protects the budget without touching legitimate traffic.

## 2. Message length

| What | Value | Where |
| --- | --- | --- |
| User message | max 500 chars, trimmed, JSON string only | `MAX_MESSAGE_LENGTH`, `validateMessage()` → `400` |
| Player-context fields | max 200 chars each; whitelist of 6 fields only | `MAX_CONTEXT_FIELD`, `sanitizeContext()` |
| Context safety | `safarKey` must be a real playlist key; invalid/arrays/non-objects are ignored | `sanitizeContext()` |

## 3. Output length

| What | Value | Where |
| --- | --- | --- |
| Gemini output cap | 512 tokens (`maxOutputTokens`) | `MAX_OUTPUT_TOKENS`, `callGemini()` |
| Model reply re-slice | max 400 chars | `MAX_RESPONSE_MESSAGE_LENGTH`, `sanitizeResponse()` |
| Action cap | max 4 actions, max 1 `select_safar`, allowlist only | `MAX_ACTIONS`, `sanitizeResponse()` |

Inputs and outputs are small by design (short RJ-style replies + a few actions),
so the cap comfortably fits the free-tier token quota.

## 4. Timeouts

| What | Value | Where |
| --- | --- | --- |
| Gemini call | aborted after 9 s | `GEMINI_TIMEOUT_MS` via `AbortSignal.timeout` |
| Platform fit | 9 s < Vercel free (Hobby) 10 s execution limit — avoids platform kills | `callGemini()` |
| Client watchdog | request aborts after 12 s with a friendly message | `CLIENT_TIMEOUT_MS`, `src/services/ai-api.js` |
| No retries | a failed or timed-out Gemini call is never auto-refired (avoid double-spend) | `ai-api.js`, `handler()` |

The timeout keeps a hanging/looping model from burning cost or holding a serverless slot.

## 5. Malformed request rejection

- Non-`POST` → `405` with `Allow: POST`.
- Preflight `OPTIONS` → `204` (cheap, no call).
- Unparseable / non-object JSON body → `400` (including an explicit `null` body, e.g. from a client sending `null`).
- Missing / non-string / empty / over-long `message` → `400`.
- Oversized `Content-Length` → `413`.
- These paths return before any limiter or Gemini call.

## 6. Rapid-repeat / abuse protection (no auth, no DB)

Two lightweight, in-memory, **best-effort** gates. Both reset on a cold start
and only affect a single serverless instance — that is a deliberate, documented
limitation of staying free and simple.

| Gate | Limit | Where |
| --- | --- | --- |
| Per-instance | 20 Gemini calls per 60 s window | `RATE_PER_INSTANCE`, `createSlidingLimiter()` |
| Per-session | 6 Gemini calls per 60 s window, keyed by anonymous tab id | `RATE_PER_SESSION`, header `X-AI-SAFAR-SESSION` |

- The client generates a **random, in-memory, per-tab** session id
  (`crypto.randomUUID()`; never persisted, never sent elsewhere, not an account).
- Rate limiting runs **only** for requests that are about to spend Gemini budget
  (malformed/400 cases are not counted).
- Requests over the limit get a friendly `429`.
- Sliding windows expire lazily (no timers, nothing keeps the process alive).

## Same-origin gate

`POST /api/ai-safar` is same-origin by design (the page and the function share a
host). The handler rejects requests whose `Origin` header does not match the
request `Host` with a friendly `403` — so a random third-party webpage cannot
inject Gemini calls against this deployment's free-tier quota from visitors'
browsers. Non-browser clients (no `Origin` header) are unaffected. Local dev
works because the Vite proxy preserves the browser origin in `Host`.

## 7. Concurrent requests

| What | Value | Where |
| --- | --- | --- |
| Server concurrency | max 2 in-flight Gemini calls per instance; extra → `429` | `MAX_CONCURRENCY`, `createConcurrencyGuard()` |
| Same-UI concurrency | `busy` flag disables input/send while a request is in flight; starter chips go through the same guard | `ai-safar.js` |
| Same-UI double-tap | minimum 2.5 s between submits | `SUBMIT_MIN_INTERVAL_MS`, `submit()` |
| Cancellation | closing the panel aborts the in-flight request (`AbortController`) | `closeAi()` |

## 8. Gemini rate limits (429)

`normalizeError()` preserves upstream `429` → client gets the friendly
"AI Safar is a little busy right now. Try again shortly." message. No retry.

## 9. Gemini quota exhaustion / denied key

- Upstream `429` (RESOURCE_EXHAUSTED) → friendly `429`.
- Upstream `403` (key/quota denied) → `503` "AI Safar is not available right
  now. Come back in a bit."
- `504` (upstream timeout) and other upstream failures → friendly `502`/`504`.

## 10. Friendly fallback + music continuity

- Every failure path responds with `{ message: <friendly>, actions: [] }` — a
  functional "no-op" the client can render as an error bubble.
- The client only ever dispatches actions through the strict whitelist
  (`ai-actions.js`); an error path dispatches nothing.
- **AI unavailability never touches the player**: the player, the Supabase
  presence counter, and the rest of Radio Safar are completely independent of
  `/api/ai-safar`. If Gemini is down, music keeps playing and the radio works
  exactly as before — the AI panel just shows a friendly message.
- The YouTube player and Supabase are untouched by this pass.

---

## What is deliberately NOT implemented

- No distributed/global/IP rate limiter.
- No authentication or user accounts.
- No database / cache / key-value store.
- No paid infrastructure.
- No conversation or listening history is stored anywhere.

## Config summary

| Constant | File | Value |
| --- | --- | --- |
| `MAX_BODY_BYTES` | `api/ai-safar.js` | 16 KB |
| `MAX_MESSAGE_LENGTH` | `api/ai-safar.js` | 500 |
| `MAX_CONTEXT_FIELD` | `api/ai-safar.js` | 200 |
| `MAX_RESPONSE_MESSAGE_LENGTH` | `api/ai-safar.js` | 400 |
| `MAX_OUTPUT_TOKENS` | `api/ai-safar.js` | 512 |
| `GEMINI_TIMEOUT_MS` | `api/ai-safar.js` | 9000 |
| `RATE_WINDOW_MS` | `api/ai-safar.js` | 60000 |
| `RATE_PER_INSTANCE` | `api/ai-safar.js` | 20 |
| `RATE_PER_SESSION` | `api/ai-safar.js` | 6 |
| `MAX_CONCURRENCY` | `api/ai-safar.js` | 2 |
| `CLIENT_TIMEOUT_MS` | `src/services/ai-api.js` | 12000 |
| `SUBMIT_MIN_INTERVAL_MS` | `src/components/ai-safar.js` | 2500 |