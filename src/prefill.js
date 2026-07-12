// The winning outcome's prose is placed in SillyTavern's "Start Reply With" slot
// (power_user.user_prompt_bias), so it becomes the literal, visible opening of
// the reply and the model continues from it — not an instruction it can ignore.
//
// power_user.user_prompt_bias is read early in Generate (via getBiasStrings), so
// the value must be set BEFORE generation. state.js does this from the
// GENERATION_STARTED handler (early + awaited). We preserve and restore any
// static value the user had set in that field.

import { getST } from './settings.js';

// Tidy the winning outcome text before it becomes the prefill: drop a leading
// label and a single pair of quotes wrapping the WHOLE line. Internal dialogue
// quotes are preserved, and multi-paragraph text is collapsed to its first
// paragraph (outcomes are single-line, so this is usually a no-op).
export function sanitizePrefill(raw) {
    let t = String(raw ?? '').replace(/\r/g, '').trim();
    t = t.replace(/^(opening|prefill|reply|response|prose|continuation)\s*[:\-–]\s*/i, '');
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”')) ||
        (t.startsWith('\'') && t.endsWith('\''))) {
        t = t.slice(1, -1).trim();
    }
    t = t.split(/\n\s*\n/)[0].replace(/\s+\n/g, '\n').trim();
    return t;
}

let overridden = false;
let savedUserBias = '';

export function setPrefill(text) {
    const pu = getST()?.powerUserSettings;
    if (!pu) return;
    if (!overridden) {
        savedUserBias = pu.user_prompt_bias ?? '';
        overridden = true;
    }
    pu.user_prompt_bias = String(text ?? '');
    syncField(pu.user_prompt_bias);
}

// Restore the user's original "Start Reply With" value so nothing leaks into a
// later, unrelated reply.
export function clearPrefill() {
    if (!overridden) return;
    const pu = getST()?.powerUserSettings;
    if (pu) {
        pu.user_prompt_bias = savedUserBias;
        syncField(pu.user_prompt_bias);
    }
    overridden = false;
    savedUserBias = '';
}

// Keep the visible field in step with the backing value (cosmetic; generation
// reads the value, not the field). Element type varies, so set defensively.
function syncField(value) {
    try {
        const $ = globalThis.jQuery;
        const el = $ && $('#start_reply_with');
        if (el && el.length) {
            if (el.is('textarea, input')) el.val(value);
            else el.text(value);
        }
    } catch { /* field not present */ }
}
