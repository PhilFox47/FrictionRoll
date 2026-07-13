// Orchestration + the trigger/lifecycle state machine.
//
//   pending = {
//     menu, roll, selected,          // the current adjudicated outcome
//     prefill,                       // the winning outcome's opening paragraph
//     status: 'primed' | 'committed' // primed = rolled, not yet delivered;
//                                     // committed = a reply was produced with it
//     messageId,                     // chat index of that reply (committed only)
//   }
//
// Delivery is split across the generation lifecycle so the SEND is never delayed:
//
//   GENERATION_STARTED  – fires before your message is rendered. We do NOT roll
//                         here (that would delay the message); we only note that
//                         this generation should be adjudicated ("arm" it).
//   *_PROMPT_READY       – fires while the REPLY prompt is assembled, AFTER your
//                         message is already on screen. Here we roll, generate
//                         the opening paragraph, and inject it into the outgoing
//                         prompt as the reply's seeded opening. Blocking here
//                         delays only the reply, which is expected.
//   GENERATION_ENDED    – the reply is in chat; prepend the paragraph to it so
//                         the opening is visible, then commit + evaluate.

import { getST, getSettings } from './settings.js';
import { MENU_MAX_TOKENS, EVAL_MAX_TOKENS, EVAL_TEMPERATURE } from './constants.js';
import { gatherContext, getPlayerAction } from './context.js';
import {
    buildSystemPrompt, buildUserPrompt, runSideCall,
    parseMenu, dedupeByTag, validateMenu, normalize,
} from './menu.js';
import { rollD100, selectByRoll } from './roll.js';
import { drawArchetypes, resetBag } from './bag.js';
import { generatePrefill, injectPrefillIntoPrompt, prependParagraphToMessage } from './prefill.js';
import { setDebug, annotateDebug } from './debug.js';
import { buildEvalSystemPrompt, buildEvalUserPrompt, parseEvalVerdict } from './evaluate.js';

let pending = null;
let busy = false;             // a pipeline (our own side-calls) is running
let armed = null;             // { mode, messageId? } — set at GENERATION_STARTED, consumed at PROMPT_READY
let deliverParagraph = null;  // paragraph to prepend once the reply lands (one-shot)
let judgeThisReply = false;   // the reply about to land should be evaluated
let showToastNext = false;    // show a post-hoc result toast for this reply

export function isBusy() { return busy; }
export function getPending() { return pending; }

function notify(kind, msg, opts) {
    try {
        const t = globalThis.toastr;
        if (t && typeof t[kind] === 'function') { t[kind](msg, 'Outcome Roll', opts); return; }
    } catch { /* ignore */ }
    console.log(`[Outcome Roll] ${msg}`);
}

function showResultToast(p) {
    if (!p?.selected) return;
    notify('info', `🎲 ${p.roll}/100 → ${p.selected.tag}: ${p.selected.text}`, { timeOut: 9000, extendedTimeOut: 3000 });
}

// The roll runs at PROMPT_READY (the reply is already generating), so a
// non-blocking toast signals "rolling" without touching the Send/Stop buttons.
function showRollingToast() {
    notify('info', '🎲 Rolling for the next outcome…', { timeOut: 4000 });
}

// One side-call: for each drawn archetype the model writes a terse outcome
// bullet. Then parse/dedupe/validate -> normalize -> roll -> select. Throws on
// unrecoverable failure (caller fails open).
async function generateMenu(mode, { actionOverride } = {}) {
    const settings = getSettings();
    const contextText = await gatherContext(mode);
    const action = actionOverride ?? getPlayerAction(mode);
    const systemPrompt = buildSystemPrompt();

    // The player character's name, so the side-call knows who it must never narrate.
    let playerName = '';
    try {
        const n = getST()?.substituteParams?.('{{user}}');
        if (n && !String(n).includes('{{')) playerName = String(n).trim();
    } catch { /* ignore */ }

    // Draw this turn's archetypes from the shuffle-bag (rotation/balance).
    const candidateTags = drawArchetypes(settings.maxOutcomes);
    const candidateSet = new Set(candidateTags);

    let raw = '';
    let outcomes = [];

    for (let attempt = 0; attempt < 2; attempt++) {
        const userPrompt = buildUserPrompt(contextText, action, settings, playerName, candidateTags, attempt > 0);
        raw = await runSideCall(systemPrompt, userPrompt, MENU_MAX_TOKENS, settings.outcomeTemperature);
        const deduped = dedupeByTag(parseMenu(raw));
        const onList = deduped.filter((o) => candidateSet.has(o.tag));
        outcomes = onList.length >= 2 ? onList : deduped;
        if (validateMenu(outcomes).ok) break;
    }

    if (!outcomes || outcomes.length < 2) {
        setDebug({ mode, action, contextText, raw, candidateTags, error: 'parse_failed', menu: [] });
        throw new Error('parse_failed');
    }

    const normalized = normalize(outcomes, settings.floor, settings.ceiling);
    const roll = rollD100();
    const { selected, ranges } = selectByRoll(normalized, roll);

    setDebug({ mode, action, contextText, raw, candidateTags, menu: ranges, roll, selected });
    return { menu: ranges, roll, selected, contextText };
}

// Roll a bullet menu, pick one, then turn the winner into the reply's opening
// paragraph. `busy` guards re-entrancy from our own side-calls (which re-emit the
// prompt-ready events). Returns the paragraph, or '' on failure (fail open).
async function produceOutcome(mode, { actionOverride, committed = false, messageId = null } = {}) {
    busy = true;
    try {
        const result = await generateMenu(mode, { actionOverride });

        let prefill = '';
        try {
            prefill = await generatePrefill(result.contextText, result.selected.text);
        } catch (e) {
            console.warn('[Outcome Roll] opening-paragraph generation failed.', e);
            prefill = '';
        }

        pending = { ...result, prefill, status: committed ? 'committed' : 'primed', messageId };
        annotateDebug({ prefill: prefill || '(none)' });
        console.info(`[Outcome Roll] ${mode} roll ${result.roll}/100 → ${result.selected.tag}: ${result.selected.text}`);
        console.info(`[Outcome Roll] opening paragraph: ${prefill || '(empty)'}`);
        return prefill;
    } catch (e) {
        console.error(`[Outcome Roll] ${mode} roll failed`, e);
        if (committed) pending = null;
        return '';
    } finally {
        busy = false;
    }
}

// --- Manual trigger (button / slash command) -------------------------------
export async function onManualRoll() {
    const settings = getSettings();
    if (!settings.enabled) { notify('info', 'Outcome Roll is disabled in settings.'); return; }
    if (busy) { notify('info', 'Already rolling…'); return; }

    let actionOverride;
    if (settings.promptForAction) {
        const ctx = getST();
        const def = getPlayerAction('manual');
        if (ctx?.callGenericPopup) {
            const INPUT = ctx.POPUP_TYPE?.INPUT ?? 1;
            const res = await ctx.callGenericPopup('Action to adjudicate:', INPUT, def, { rows: 3 });
            if (res === null || res === false) return; // cancelled
            actionOverride = (typeof res === 'string' && res.trim()) ? res.trim() : def;
        }
    }

    const paragraph = await produceOutcome('manual', { actionOverride, committed: false, messageId: null });
    if (paragraph) notify('success', '🎲 Rolled — opening ready. Send your message.');
    else notify('warning', 'Roll failed — continuing without an adjudicated outcome.');
}

// Generation types that are NOT a fresh player send.
const SWIPE_TYPES = new Set(['swipe', 'regenerate']);
const SKIP_TYPES = new Set(['quiet', 'impersonate', 'continue', 'ask_command']);

// Guard against both emit shapes: (type, options, dryRun) and (type, dryRun).
function isDryRun(options, dryRun) {
    return dryRun === true || options === true || options?.dryRun === true;
}

// --- The automatic trigger, part 1: GENERATION_STARTED ----------------------
// Fires before your sent message is rendered, so it does NO work that would
// delay it — it only decides whether this generation should be adjudicated and
// arms it. The actual roll happens later, at PROMPT_READY.
export function onGenerationStarted(type, options, dryRun) {
    if (isDryRun(options, dryRun)) return;
    if (busy) return; // re-entrancy from our own side-call generations
    const settings = getSettings();
    if (!settings.enabled) return;

    armed = null; // each generation re-decides

    // Swipe / regenerate: re-roll the whole chain fresh.
    if (SWIPE_TYPES.has(type)) {
        if (!settings.autoRerollOnSwipe) return;
        if (!pending || pending.status !== 'committed') return;
        armed = { mode: 'swipe', messageId: pending.messageId };
        showRollingToast();
        return;
    }

    // Background / utility generations are never adjudicated.
    if (SKIP_TYPES.has(type)) return;

    // Otherwise this is a fresh player send (type is 'normal', undefined, '').
    // A primed roll (manual pre-roll) takes precedence: deliver it, don't re-roll.
    if (pending?.status === 'primed') {
        armed = { mode: 'primed' };
        return;
    }

    // Advancing to a new turn — drop last turn's committed state.
    if (pending?.status === 'committed') pending = null;

    if (!settings.autoRollOnSend) return; // manual-only mode

    armed = { mode: 'send' };
    showRollingToast();
}

// --- The automatic trigger, part 2: PROMPT_READY ----------------------------
// Wired to BOTH chat_completion_prompt_ready (chat completion) and
// generate_after_combine_prompts (text completion). Fires while the reply prompt
// is assembled — after your message is on screen — so rolling here delays only
// the reply. Rolls (or reuses a primed roll) and injects the opening paragraph
// into the outgoing prompt.
export async function onPromptReady(eventData) {
    if (busy) return;                              // our own side-calls re-emit this
    if (!armed) return;
    if (!eventData || eventData.dryRun) return;

    const isChat = Array.isArray(eventData.chat);
    const isText = !isChat && typeof eventData.prompt === 'string';
    if (!isChat && !isText) return;
    // Chat completion also emits the text event (with an empty prompt) before the
    // chat event — ignore it there and wait for the real chat-array event, so we
    // don't consume the armed roll on the wrong prompt shape.
    if (isText && getST()?.mainApi === 'openai') return;

    const a = armed;
    armed = null; // one-shot: we own this generation now

    const settings = getSettings();
    if (!settings.enabled) return;

    try {
        let paragraph = '';
        if (a.mode === 'primed' && pending?.status === 'primed' && pending.prefill) {
            paragraph = pending.prefill; // manual pre-roll — reuse, don't re-roll
        } else {
            paragraph = await produceOutcome(a.mode, {
                committed: a.mode === 'swipe',
                messageId: a.messageId ?? null,
            });
        }
        if (!paragraph) return; // fail open — reply generates normally

        if (injectPrefillIntoPrompt(eventData, paragraph)) {
            deliverParagraph = paragraph;
            judgeThisReply = true;
            showToastNext = settings.showResultAfter;
        }
    } catch (e) {
        console.error('[Outcome Roll] prompt-ready delivery failed', e);
    }
}

// --- GENERATION_ENDED: prepend the opening, commit, evaluate ----------------
export function onGenerationEnded() {
    if (busy) return; // ignore our own side-call end events
    const settings = getSettings();
    if (!settings.enabled) return;

    if (deliverParagraph) {
        const para = deliverParagraph;
        deliverParagraph = null;
        const chat = getST()?.chat ?? [];
        const messageId = chat.length - 1;
        prependParagraphToMessage(messageId, para);
        if (pending) { pending.status = 'committed'; pending.messageId = messageId; }
        if (showToastNext) {
            showToastNext = false;
            if (settings.showResultAfter) showResultToast(pending);
        }
    }

    if (judgeThisReply) {
        judgeThisReply = false;
        if (settings.evaluateOutcome && pending?.selected) {
            evaluateReply(); // async, fire-and-forget
        }
    }
}

// Ask the model whether the reply delivered the selected outcome; log/record the
// Yes/No verdict for visibility. (No auto-regeneration.)
async function evaluateReply() {
    const outcome = pending?.selected;
    if (!outcome) return;
    const chat = getST()?.chat ?? [];
    const reply = chat[chat.length - 1]?.mes ?? '';
    if (!String(reply).trim()) return;

    let verdict = 'unknown';
    busy = true; // guard our own judge side-call from re-triggering the pipeline
    try {
        const raw = await runSideCall(buildEvalSystemPrompt(), buildEvalUserPrompt(outcome, reply), EVAL_MAX_TOKENS, EVAL_TEMPERATURE);
        verdict = parseEvalVerdict(raw);
    } catch (e) {
        console.warn('[Outcome Roll] outcome evaluation failed.', e);
        verdict = 'unknown';
    } finally {
        busy = false;
    }

    annotateDebug({ evaluation: verdict });
    const label = verdict === 'no' ? 'NO — reply did not deliver the outcome' : verdict.toUpperCase();
    console.info(`[Outcome Roll] outcome evaluation (${outcome.tag}): ${label}`);
}

// --- Chat switch / reset: wipe everything so nothing leaks across chats -----
export function onChatChanged() {
    resetBag(); // each story rotates its archetypes independently
    pending = null;
    armed = null;
    deliverParagraph = null;
    judgeThisReply = false;
    showToastNext = false;
    busy = false;
}
