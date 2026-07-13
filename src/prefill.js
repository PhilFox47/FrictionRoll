// The winning outcome's prose becomes the literal opening of the reply. It is
// delivered by manipulating the OUTGOING reply prompt directly (not the "Start
// Reply With" slot, which SillyTavern reads before your sent message is even
// rendered — so using it always delays the send):
//
//   1. injectPrefillIntoPrompt() appends the paragraph as the model's own
//      opening — an assistant prefix for chat completion, or appended text for
//      text completion — so the model continues FROM it and can't route around
//      it. This runs at the prompt-ready event, which fires AFTER your message
//      is already on screen, so the send is never delayed.
//   2. The model's continuation comes back without the prefix (it was seeded as
//      already-said), so prependParagraphToMessage() prepends the paragraph to
//      the finished reply and re-renders it — making the opening visible.

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
        'You are given the recent scene and exactly ONE event that happens next. Write the OPENING of the next reply — two to four sentences — that shows THAT event actually happening.',
        'Follow these rules exactly:',
        '- Open ON the event. Your FIRST sentence must depict the event itself beginning. Do NOT lead with mood, scenery, or a line of dialogue that is not part of the event.',
        '- Show it happening in the moment. Do NOT skip ahead to the aftermath or the result, and do NOT resolve, soften, or undo it. If the event has several beats, take them in order, starting from the first — e.g. if a distraction happens and then someone acts on it, show the distraction FIRST, then the action.',
        '- Stay strictly on this event. Include every concrete element it names, and invent NOTHING that is not in the event or the recent scene — no new characters, no extra developments, and no dialogue that the event does not call for.',
        '- Match the voice, tense, and tone of the recent messages, addressing the player as "you". Write other characters and the world in the story\'s normal style; dialogue is fine only when it is part of this event.',
        '- NEVER narrate the player\'s own actions, words, thoughts, or feelings — only what happens around and to them.',
        'Output raw prose only: no preamble, no labels, no surrounding quotation marks, no commentary.',
    ].join(' ');
}

export function buildPrefillUserPrompt(contextText, outcome) {
    return [
        'RECENT SCENE (for voice and continuity only — do not carry over any thread from it that would replace or contradict the event below):',
        contextText || '(no prior context)',
        '',
        'THE EVENT THAT HAPPENS NEXT — open the reply by showing THIS, and only this, actually happening:',
        outcome,
        '',
        'Write the opening 2-4 sentences of the reply. Begin with the event itself, move through its beats in order, and stop once the event is clearly underway. Do not add anything the event does not describe. Raw prose only.',
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

// Append the opening paragraph to the OUTGOING reply prompt so the model treats
// it as the start of its own reply and continues from there. Handles both prompt
// shapes SillyTavern emits right before the request:
//   - chat completion: eventData.chat is an array of {role, content}; push an
//     assistant message so it becomes the reply's seeded opening (Claude-style
//     prefill — the same mechanism ST's own "Start Reply With" uses).
//   - text completion: eventData.prompt is a string; append the paragraph so the
//     model continues from it.
// Returns true if it injected.
export function injectPrefillIntoPrompt(eventData, paragraph) {
    const text = String(paragraph ?? '').trim();
    if (!text || !eventData) return false;
    if (Array.isArray(eventData.chat)) {
        eventData.chat.push({ role: 'assistant', content: text });
        return true;
    }
    if (typeof eventData.prompt === 'string') {
        const sep = eventData.prompt.length && !/\s$/.test(eventData.prompt) ? ' ' : '';
        eventData.prompt = eventData.prompt + sep + text;
        return true;
    }
    return false;
}

// Make the seeded opening visible: the model's continuation returns WITHOUT the
// prefix (it was given as already-said), so prepend the paragraph to the
// finished reply message and re-render it. Idempotent — a reply that already
// starts with the paragraph is left alone.
export function prependParagraphToMessage(messageId, paragraph) {
    const ctx = getST();
    const chat = ctx?.chat;
    const text = String(paragraph ?? '').trim();
    if (!ctx || !Array.isArray(chat) || !text) return false;

    const msg = chat[messageId];
    if (!msg || msg.is_user || typeof msg.mes !== 'string') return false;
    if (msg.mes.trimStart().startsWith(text)) return true; // already there

    const joined = `${text}\n\n${msg.mes.replace(/^\s+/, '')}`;
    msg.mes = joined;
    // Keep the active swipe entry in step so swiping back shows the same opening.
    if (Array.isArray(msg.swipes) && Number.isInteger(msg.swipe_id) && msg.swipes[msg.swipe_id] != null) {
        msg.swipes[msg.swipe_id] = joined;
    }
    try { ctx.updateMessageBlock?.(messageId, msg); } catch (e) { console.warn('[Outcome Roll] re-render failed', e); }
    try { ctx.saveChat?.(); } catch { /* best effort */ }
    return true;
}
