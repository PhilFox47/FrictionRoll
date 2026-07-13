// The winning outcome's prose is placed in SillyTavern's "Start Reply With" slot
// (power_user.user_prompt_bias), so it becomes the literal, visible opening of
// the reply and the model continues from it — not an instruction it can ignore.
//
// power_user.user_prompt_bias is read early in Generate (via getBiasStrings), so
// the value must be set BEFORE generation. state.js does this from the
// GENERATION_STARTED handler (early + awaited). We preserve and restore any
// static value the user had set in that field.

import { getST, getSettings } from './settings.js';
import { PREFILL_MAX_TOKENS } from './constants.js';
import { runSideCall } from './menu.js';

// --- Prose generation: turn the winning bullet into the reply's opening ------
// A dedicated creative call, so it is a real paragraph (not one of five rushed
// lines). The outcome is baked into these first sentences, so once it is the
// prefill the model has no way out — it must continue from an opening where the
// outcome is already happening.

export function buildPrefillSystemPrompt() {
    return [
        'You are a ghostwriter continuing a second-person interactive story.',
        'You are given the recent scene and ONE event that happens next. Write the OPENING of the next reply — the first two to four sentences, where that event is unmistakably underway.',
        'Match the voice, tense, and tone of the recent messages. Address the player as "you"; write other characters and the world in the story\'s normal style (dialogue is welcome — this is real prose).',
        'NEVER narrate the player\'s own actions, words, thoughts, or feelings — only what happens around and to them.',
        'The event must be clearly happening within these sentences, not merely hinted at. Output raw prose only: no preamble, no labels, no surrounding quotation marks, no commentary.',
    ].join(' ');
}

export function buildPrefillUserPrompt(contextText, outcome) {
    return [
        'RECENT SCENE:',
        contextText || '(no prior context)',
        '',
        'EVENT THAT HAPPENS NEXT (open the reply so this is unmistakably happening):',
        outcome,
        '',
        'Write only the opening paragraph of the reply (2-4 sentences), in the story\'s own voice. Raw prose only.',
    ].join('\n');
}

// Generate the opening paragraph for the selected outcome (creative temp).
export async function generatePrefill(contextText, outcome) {
    const settings = getSettings();
    const raw = await runSideCall(
        buildPrefillSystemPrompt(),
        buildPrefillUserPrompt(contextText, outcome),
        PREFILL_MAX_TOKENS,
        settings.prefillTemperature,
    );
    return sanitizePrefill(raw);
}

// Tidy the generated prose before it becomes the prefill: drop a leading
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

// Read the effective "Start Reply With" value. Prefer the live powerUserSettings
// reference from getContext(); fall back to the DOM field for builds where that
// isn't the live object.
function readBias() {
    const pu = getST()?.powerUserSettings;
    if (pu && typeof pu.user_prompt_bias === 'string') return pu.user_prompt_bias;
    try {
        const $ = globalThis.jQuery;
        const el = $ && $('#start_reply_with');
        if (el && el.length) return String(el.val() ?? '');
    } catch { /* field not present */ }
    return '';
}

// Write the "Start Reply With" value through BOTH paths, so it lands no matter
// how this ST build exposes state:
//   1. the live powerUserSettings reference (getBiasStrings reads power_user
//      directly), and
//   2. the #start_reply_with field WITH a dispatched 'input' event, which drives
//      ST's own handler (power_user.user_prompt_bias = field value) — the only
//      reliable path if getContext()'s powerUserSettings isn't the live object.
// Setting only the field value (no 'input' event) never updates power_user, which
// is why the generated opening wasn't being prefilled.
function writeBias(value) {
    const v = String(value ?? '');
    const pu = getST()?.powerUserSettings;
    if (pu) pu.user_prompt_bias = v;
    try {
        const $ = globalThis.jQuery;
        const el = $ && $('#start_reply_with');
        if (el && el.length) {
            el.val(v);
            const raw = el[0];
            if (raw && typeof raw.dispatchEvent === 'function') {
                raw.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    } catch { /* field not present */ }
}

export function setPrefill(text) {
    if (!overridden) {
        savedUserBias = readBias();
        overridden = true;
    }
    writeBias(text);
    // Diagnostic: confirm the value actually landed where generation reads it.
    const pu = getST()?.powerUserSettings;
    console.info(`[Outcome Roll] prefill set — powerUserSettings ${pu ? 'present' : 'MISSING'}, effective bias now: ${JSON.stringify(readBias()).slice(0, 120)}`);
}

// Restore the user's original "Start Reply With" value so nothing leaks into a
// later, unrelated reply.
export function clearPrefill() {
    if (!overridden) return;
    writeBias(savedUserBias);
    overridden = false;
    savedUserBias = '';
}
