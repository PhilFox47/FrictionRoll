// Orchestration + the trigger/lifecycle state machine.
//
// The whole point of scoping the rolled outcome to a specific pending turn is
// to tell "this is a swipe of the same turn" (re-roll) apart from "this is a
// new turn" (clear the stale outcome, never reuse it).
//
//   pending = {
//     menu, roll, selected,          // the current adjudicated outcome
//     status: 'primed' | 'committed' // primed = rolled, not yet generated;
//                                     // committed = a reply was produced with it
//     messageId,                     // chat index of that reply (committed only)
//   }

import { getST, getSettings } from './settings.js';
import { gatherContext, getPlayerAction } from './context.js';
import {
    buildSystemPrompt, buildUserPrompt, runSideCall,
    parseMenu, validateMenu, normalize,
} from './menu.js';
import { rollD100, selectByRoll } from './roll.js';
import { setDirective, clearDirective } from './inject.js';
import { setDebug, annotateDebug } from './debug.js';
import { buildEvalSystemPrompt, buildEvalUserPrompt, parseEvalVerdict } from './evaluate.js';

let pending = null;
let busy = false;            // a pipeline (manual or swipe) is running
let consumeOnReceive = false; // the in-flight normal generation is using the primed roll
let showToastNext = false;    // a swipe reroll wants a post-hoc result toast
let judgeThisReply = false;   // the reply about to land should be evaluated

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

// The full pipeline: gather -> side-call (+one strict retry) -> parse/validate
// -> normalize -> roll -> select. Throws on unrecoverable failure so callers
// can fail open.
async function generateMenu(mode, { actionOverride, chat } = {}) {
    const settings = getSettings();
    const contextText = await gatherContext(mode, chat);
    const action = actionOverride ?? getPlayerAction(mode, chat);
    const systemPrompt = buildSystemPrompt();

    // The player character's name, so the side-call knows exactly who it must
    // never narrate. Falls back to a generic label if unavailable.
    let playerName = '';
    try {
        const n = getST()?.substituteParams?.('{{user}}');
        if (n && !String(n).includes('{{')) playerName = String(n).trim();
    } catch { /* ignore */ }

    let raw = '';
    let outcomes = [];
    let validation = null;

    for (let attempt = 0; attempt < 2; attempt++) {
        const userPrompt = buildUserPrompt(contextText, action, settings, playerName, attempt > 0);
        raw = await runSideCall(systemPrompt, userPrompt);
        outcomes = parseMenu(raw);
        validation = validateMenu(outcomes);
        if (validation.ok) break;
        // Retry exactly once with a stricter reminder; never loop indefinitely.
    }

    if (!outcomes || outcomes.length < 2) {
        setDebug({ mode, action, contextText, raw, error: 'parse_failed', menu: [] });
        throw new Error('parse_failed');
    }

    // Proceed even if a tag (e.g. SETBACK) never survived — flag it, don't loop.
    const missing = validation?.missing ?? [];
    if (missing.length) {
        console.warn(`[Outcome Roll] proceeding without tags: ${missing.join(', ')} (prompt wording may need revisiting)`);
    }

    const normalized = normalize(outcomes, settings.floor, settings.ceiling);
    const roll = rollD100();
    const { selected, ranges } = selectByRoll(normalized, roll);

    setDebug({ mode, action, contextText, raw, menu: ranges, roll, selected, missing, partial: missing.length > 0 });
    // action/contextText/raw are carried on `pending` so a swipe can re-roll the
    // same menu (and show meaningful debug) without another side-call.
    return { menu: ranges, roll, selected, raw, action, contextText, missing };
}

// A swipe re-rolls the dice against the ALREADY-GENERATED menu — no new
// side-call. Same outcomes and weights, fresh d100, new selection. Synchronous.
function rerollFromMenu(messageId) {
    const settings = getSettings();
    const roll = rollD100();
    const { selected, ranges } = selectByRoll(pending.menu, roll);
    pending = { ...pending, menu: ranges, roll, selected, status: 'committed', messageId };
    setDirective(selected);
    showToastNext = settings.showResultAfter;
    judgeThisReply = true; // a fresh selection — evaluate the resulting reply
    console.info(`[Outcome Roll] swipe re-roll ${roll}/100 → ${selected.tag}: ${selected.text} (same menu, no side-call)`);
    setDebug({
        mode: 'swipe-reroll',
        action: pending.action ?? '(reused menu)',
        contextText: pending.contextText ?? '',
        raw: pending.raw ?? '(menu reused — no new side-call)',
        menu: ranges, roll, selected, missing: pending.missing ?? [],
    });
}

// --- Manual trigger (button / slash command) -------------------------------
// Initial roll is manual only. Re-clicking before sending discards the unused
// menu/roll and generates a fresh one.
export async function onManualRoll() {
    const settings = getSettings();
    if (!settings.enabled) { notify('info', 'Outcome Roll is disabled in settings.'); return; }
    if (busy) { notify('info', 'Already rolling…'); return; }

    busy = true;
    try {
        let actionOverride;
        if (settings.promptForAction) {
            const ctx = getST();
            const def = getPlayerAction('manual');
            if (ctx?.callGenericPopup) {
                const INPUT = ctx.POPUP_TYPE?.INPUT ?? 1;
                const res = await ctx.callGenericPopup('Action to adjudicate:', INPUT, def, { rows: 3 });
                if (res === null || res === false) { return; } // cancelled
                actionOverride = (typeof res === 'string' && res.trim()) ? res.trim() : def;
            }
        }

        const result = await generateMenu('manual', { actionOverride });
        pending = { ...result, status: 'primed', messageId: null };
        setDirective(result.selected);
        // Deliberately does NOT reveal the roll/outcome here — that would let it
        // be gamed by seeing it coming.
        notify('success', '🎲 Rolled — outcome locked in. Send your message.');
    } catch (e) {
        console.error('[Outcome Roll] manual roll failed', e);
        clearDirective();
        pending = null;
        notify('warning', 'Roll failed — continuing without an adjudicated outcome.');
    } finally {
        busy = false;
    }
}

// Run the full pipeline inline and inject, guarding re-entrancy from our own
// side-call generations. `committed` marks a turn that already produced a reply
// (so it re-rolls on swipe); `primed` marks a roll about to be consumed by the
// generation we're standing in front of. Fails open: on error, inject nothing.
async function runInlineRoll(mode, { committed = false, messageId = null, chat = null } = {}) {
    const settings = getSettings();
    busy = true;
    try {
        const result = await generateMenu(mode, { chat });
        pending = { ...result, status: committed ? 'committed' : 'primed', messageId };
        setDirective(result.selected);
        if (committed) showToastNext = settings.showResultAfter; // reveal after it writes
        console.info(`[Outcome Roll] ${mode} roll ${result.roll}/100 → ${result.selected.tag}: ${result.selected.text}`);
        return true;
    } catch (e) {
        console.error(`[Outcome Roll] ${mode} roll failed`, e);
        clearDirective();
        if (committed) pending = null;
        return false;
    } finally {
        busy = false;
    }
}

// Generation types that are NOT a fresh player send and must not auto-roll.
const SWIPE_TYPES = new Set(['swipe', 'regenerate']);
const SKIP_TYPES = new Set(['quiet', 'impersonate', 'continue', 'ask_command']);

// --- The automatic trigger: a SillyTavern generate interceptor --------------
// Declared in manifest.json ("generate_interceptor") and registered on
// globalThis below. SillyTavern awaits this before building the main prompt and
// passes the prompt-building chat + generation type, so the whole roll pipeline
// runs here and the reply is then generated with the winning outcome injected.
// It MUST return the chat array. This is the same reliable hook working
// extensions use; a plain send does not emit a usable 'normal' event type.
export async function outcomeRollGenerationInterceptor(chat, _contextSize, _abort, type) {
    try {
        if (busy) return chat; // re-entrancy from our own side-call generation
        const settings = getSettings();
        if (!settings.enabled) return chat;

        // Swipe / regenerate: re-roll the dice against the SAME menu — no new
        // side-call. Keeps the beat's outcome space consistent; only the roll
        // (and thus the selected outcome) changes.
        if (SWIPE_TYPES.has(type)) {
            if (!settings.autoRerollOnSwipe) return chat;
            if (!pending || pending.status !== 'committed') return chat;
            if (Array.isArray(pending.menu) && pending.menu.length >= 2) {
                rerollFromMenu(pending.messageId);
            } else {
                // No usable stored menu — fall back to a fresh menu generation.
                await runInlineRoll('swipe', { committed: true, messageId: pending.messageId, chat });
            }
            return chat;
        }

        // Background / utility generations are never adjudicated.
        if (SKIP_TYPES.has(type)) return chat;

        // Otherwise this is a fresh player send (type is 'normal', undefined, '').
        // A primed roll (manual pre-roll, or a double-fire of this same send)
        // takes precedence: consume it rather than rolling again.
        if (pending?.status === 'primed') {
            consumeOnReceive = true;
            judgeThisReply = true; // evaluate the reply this primed roll produces
            return chat;
        }

        // Advancing to a new turn — clear any stale committed directive first.
        if (pending?.status === 'committed') {
            clearDirective();
            pending = null;
        }

        if (!settings.autoRollOnSend) return chat; // manual-only mode

        const ok = await runInlineRoll('send', { committed: false, messageId: null, chat });
        if (ok) { consumeOnReceive = true; judgeThisReply = true; } // consume + evaluate on end
        return chat;
    } catch (e) {
        console.error('[Outcome Roll] interceptor error', e);
        return chat; // fail open — never block the player's generation
    }
}

// Register under the exact name declared in manifest.json's generate_interceptor.
globalThis.outcomeRollGenerationInterceptor = outcomeRollGenerationInterceptor;

// --- GENERATION_ENDED: primed -> committed, toast, and outcome evaluation ----
export function onGenerationEnded() {
    if (busy) return; // ignore the side-call's own end event
    const settings = getSettings();
    if (!settings.enabled) return;

    if (consumeOnReceive && pending?.status === 'primed') {
        pending.status = 'committed';
        pending.messageId = (getST()?.chat?.length ?? 1) - 1;
        consumeOnReceive = false;
        if (settings.showResultAfter) showResultToast(pending);
    }

    if (showToastNext) {
        showToastNext = false;
        if (settings.showResultAfter && pending) showResultToast(pending);
    }

    if (judgeThisReply) {
        judgeThisReply = false;
        if (settings.evaluateOutcome && pending?.selected) {
            evaluateReply(); // async, fire-and-forget
        }
    }
}

// Ask the model whether the reply delivered the selected outcome, and log /
// record the Yes/No verdict for visibility. (No auto-regeneration.)
async function evaluateReply() {
    const outcome = pending?.selected;
    if (!outcome) return;
    const chat = getST()?.chat ?? [];
    const reply = chat[chat.length - 1]?.mes ?? '';
    if (!String(reply).trim()) return;

    let verdict = 'unknown';
    busy = true; // guard our own judge side-call from re-triggering the interceptor
    try {
        const raw = await runSideCall(buildEvalSystemPrompt(), buildEvalUserPrompt(outcome, reply), 8);
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
    clearDirective();
    pending = null;
    consumeOnReceive = false;
    showToastNext = false;
    judgeThisReply = false;
    busy = false;
}
