// The rolled outcome now enters the reply as a PREFILL: a short opening written
// in the story's own voice and placed in SillyTavern's "Start Reply With" slot
// (power_user.user_prompt_bias), so the outcome is already on the page when the
// main generation begins — not an instruction the model can quietly ignore.
//
// power_user.user_prompt_bias is read early in Generate (via getBiasStrings),
// so the value must be set BEFORE generation — see state.js, which does this in
// the GENERATION_STARTED handler (early + awaited), not the late interceptor.

import { getST, getSettings } from './settings.js';
import { runSideCall } from './menu.js';

// --- Prefill generation (a CREATIVE side-call, not a structured one) --------

export function buildPrefillSystemPrompt() {
    return [
        'You are a ghostwriter continuing a second-person interactive story.',
        'You are given the recent scene and ONE event that happens next. Write ONLY the opening of the next reply — the concrete moment where that event visibly begins to happen.',
        'Match the voice, tense, and tone of the recent messages. Address the player as "you"; write other characters and the world in the story\'s normal style (dialogue is fine here — this is real prose, not an instruction).',
        'NEVER narrate the player\'s own actions, words, thoughts, or feelings — only what happens around and to them.',
        'Keep it to one or two sentences. Output raw prose only: no preamble, no labels, no surrounding quotation marks, no commentary.',
    ].join(' ');
}

export function buildPrefillUserPrompt(contextText, outcome) {
    return [
        'RECENT SCENE:',
        contextText || '(no prior context)',
        '',
        'EVENT THAT HAPPENS NEXT (begin the reply so this is what is happening):',
        outcome,
        '',
        'Write only the first one or two sentences of the reply, in the story\'s own voice. Raw prose only.',
    ].join('\n');
}

// Trim obvious wrappers the model adds around the prose. Internal dialogue
// quotes are preserved — only whole-string wrapping quotes/labels are removed.
export function sanitizePrefill(raw) {
    let t = String(raw ?? '').replace(/\r/g, '').trim();
    // Drop a leading label like "Opening:" / "Reply:" / "Prose:".
    t = t.replace(/^(opening|prefill|reply|response|prose|continuation)\s*[:\-–]\s*/i, '');
    // Strip a single pair of quotes wrapping the ENTIRE string.
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”')) ||
        (t.startsWith('\'') && t.endsWith('\''))) {
        t = t.slice(1, -1).trim();
    }
    // Collapse to a tight opening: keep it to the first paragraph.
    t = t.split(/\n\s*\n/)[0].replace(/\s+\n/g, '\n').trim();
    return t;
}

// Generate the opening prose for the selected outcome. Uses a creative
// temperature (near the main RP generation), not the low structured temp.
export async function generatePrefill(contextText, outcome) {
    const settings = getSettings();
    const raw = await runSideCall(
        buildPrefillSystemPrompt(),
        buildPrefillUserPrompt(contextText, outcome),
        settings.prefillMaxTokens,
        settings.prefillTemperature,
    );
    return sanitizePrefill(raw);
}

// --- The "Start Reply With" slot (power_user.user_prompt_bias) ---------------
// We preserve and restore any static value the user had set there.

let overridden = false;
let savedUserBias = '';

export function setPrefill(text) {
    const ctx = getST();
    const pu = ctx?.powerUserSettings;
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
    const ctx = getST();
    const pu = ctx?.powerUserSettings;
    if (pu) {
        pu.user_prompt_bias = savedUserBias;
        syncField(pu.user_prompt_bias);
    }
    overridden = false;
    savedUserBias = '';
}

// Keep the visible field in step with the backing value (cosmetic; the value is
// what generation actually reads). Element type varies, so set defensively.
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
