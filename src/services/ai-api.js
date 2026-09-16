/**
 * AI Safar — API client.
 *
 * Talks to the server-side endpoint `POST /api/ai-safar` and returns the
 * already-sanitized { message, actions } payload. Never exposes credentials.
 *
 * PROTECTIONS (see docs/AI-SAFAR-PROTECTIONS.md):
 *  - Sends an anonymous per-tab session id header so the server can catch
 *    accidental rapid repeat taps. It is random, in-memory, never persisted,
 *    and is not a user identifier or account.
 *  - A client-side watchdog aborts a request that stalls past CLIENT_TIMEOUT_MS
 *    and surfaces a friendly timeout message (distinct from a user-initiated
 *    close, which still surfaces as an AbortError).
 *  - No automatic retries: a failed/costly Gemini call is never re-fired here.
 */

const CLIENT_TIMEOUT_MS = 12000;

function createSessionId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const rand = Math.random().toString(36).slice(2, 12);
    return `ai-${Date.now().toString(36)}-${rand}`;
}

const sessionId = createSessionId();

function abortError() {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
}

export function getAiSessionId() {
    return sessionId;
}

export async function requestAiSafar(message, signal, context) {
    const body = {
        message,
        context: context || null
    };

    const internal = new AbortController();
    let timedOut = false;
    let watchdog = null;

    const onUserAbort = () => internal.abort();
    if (signal) {
        if (signal.aborted) return Promise.reject(abortError());
        signal.addEventListener('abort', onUserAbort);
    }

    let response;
    try {
        watchdog = setTimeout(() => {
            timedOut = true;
            internal.abort();
        }, CLIENT_TIMEOUT_MS);

        response = await fetch("/api/ai-safar", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-ai-safar-session": sessionId
            },
            body: JSON.stringify(body),
            signal: internal.signal
        });
    } catch (error) {
        if (timedOut) {
            throw new Error("Safar Saathi ko thoda samay lag raha hai. Thodi der baad boliye.");
        }
        if (error && error.name === "AbortError") throw error;
        throw new Error("Safar Saathi ka roadblock hua tha. Ek min ruk kar phir boliye.");
    } finally {
        clearTimeout(watchdog);
        if (signal) signal.removeEventListener('abort', onUserAbort);
    }

    let data = null;
    try {
        data = await response.json();
    } catch {}

    if (!response.ok) {
        const friendly = (data && typeof data.message === "string" && data.message.trim())
            ? data.message
            : "Safar Saathi abhi jawab nahi de paya. Thodi der baad boliye.";
        const error = new Error(friendly);
        error.status = response.status;
        throw error;
    }

    return {
        message: (data && typeof data.message === "string") ? data.message : "",
        actions: Array.isArray(data && data.actions) ? data.actions : []
    };
}