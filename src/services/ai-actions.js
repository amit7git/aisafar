/**
 * AI Safar — Strict client-side Action Dispatcher
 *
 * Bridges sanitized AI actions to the Radio Safar command layer.
 * AI output is treated strictly as DATA, never as code.
 *
 * SECURITY RULES:
 *  - Only six action types are recognized: play | pause | next | previous | shuffle | select_safar
 *  - Each type maps to a FIXED function reference via a switch statement —
 *    function names are never constructed dynamically, eval() is never used.
 *  - select_safar is accepted ONLY when `safar` is an exact, own-property key of MOOD_PLAYLISTS.
 *  - Anything malformed/unknown is rejected with a reason and never reaches the player.
 *  - dispatchAiActions never throws: every action is individually guarded.
 */

import {
    play as cmdPlay,
    pause as cmdPause,
    next as cmdNext,
    previous as cmdPrevious,
    toggleShuffle as cmdToggleShuffle
} from './radio-commands.js';

import { MOOD_PLAYLISTS } from '../config/playlists.js';

const ACTION_TYPES = new Set([
    'play',
    'pause',
    'next',
    'previous',
    'shuffle',
    'select_safar'
]);

let switchSafarHandler = null;
let uiSyncHandler = null;

/**
 * Register the callback the dispatcher will call for select_safar actions.
 * The callback must accept (moodKey: string) and return true if accepted,
 * false if rejected or silent (same mood, not ready, etc.).
 */
export function registerAiSwitchSafarHandler(handler) {
    if (typeof handler === 'function') switchSafarHandler = handler;
}

/**
 * Register a callback invoked once after every dispatched batch that contains
 * at least one executed action. Used by the controller to re-sync visual UI
 * state (shuffle indicator, mood button, playlist heading) from the existing
 * source-of-truth state getters — without duplicating any state inside AI Safar.
 */
export function registerAiUiSync(handler) {
    if (typeof handler === 'function') uiSyncHandler = handler;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidSafarKey(value) {
    return (
        typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(MOOD_PLAYLISTS, value) &&
        isPlainObject(MOOD_PLAYLISTS[value])
    );
}

/**
 * Execute a single validated action and return a result descriptor.
 * Never throws to the caller.
 */
function runAction(action) {
    const safeAction = isPlainObject(action) ? action : {};
    const type = safeAction.type;

    if (typeof type !== 'string' || !ACTION_TYPES.has(type)) {
        return { type: typeof type === 'string' ? type : '(invalid)', reason: 'UNKNOWN_TYPE' };
    }

    switch (type) {
        case 'play':
            try { cmdPlay(); } catch { return { type, reason: 'EXECUTION_FAILED' }; }
            return { type };

        case 'pause':
            try { cmdPause(); } catch { return { type, reason: 'EXECUTION_FAILED' }; }
            return { type };

        case 'next':
            try { cmdNext(); } catch { return { type, reason: 'EXECUTION_FAILED' }; }
            return { type };

        case 'previous':
            try { cmdPrevious(); } catch { return { type, reason: 'EXECUTION_FAILED' }; }
            return { type };

        case 'shuffle':
            try { cmdToggleShuffle(); } catch { return { type, reason: 'EXECUTION_FAILED' }; }
            return { type };

        case 'select_safar': {
            const safar = safeAction.safar;
            if (!isValidSafarKey(safar)) {
                return { type, reason: 'UNKNOWN_SAFAR' };
            }
            if (!switchSafarHandler) {
                return { type, safar, reason: 'NO_SWITCH_HANDLER' };
            }
            let accepted;
            try {
                accepted = switchSafarHandler(safar);
            } catch {
                return { type, safar, reason: 'EXECUTION_FAILED' };
            }
            if (accepted === false) {
                return { type, safar, reason: 'SWITCH_REJECTED' };
            }
            return { type, safar };
        }

        /* istanbul ignore next — default unreachable but keeps lint happy */
        default:
            return { type, reason: 'UNKNOWN_TYPE' };
    }
}

/**
 * Run a batch of AI actions through the strict dispatcher.
 * Returns { executed: [...], rejected: [...] }.
 */
export function dispatchAiActions(actions) {
    if (!Array.isArray(actions)) {
        return { executed: [], rejected: [{ type: '(invalid)', reason: 'MALFORMED_ACTIONS' }] };
    }

    const executed = [];
    const rejected = [];

    for (const action of actions) {
        const result = runAction(action);
        if (result.reason) {
            rejected.push(result);
        } else {
            executed.push(result);
        }
    }

    if (executed.length > 0) {
        try { uiSyncHandler?.(); } catch { /* best effort */ }
    }

    return { executed, rejected };
}