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
import { checkCompliance } from './compliance.js';

let pending = null;
let busy = false;            // a pipeline (manual or swipe) is running
let consumeOnReceive = false; // the in-flight normal generation is using the primed roll
let showToastNext = false;    // a swipe reroll wants a post-hoc result toast
let suppressReroll = false;   // a forced compliance regen: keep the same outcome
let regenGuardMessageId = null; // messageId we've already auto-regenerated once

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

    let raw = '';
    let outcomes = [];
    let validation = null;

    for (let attempt = 0; attempt < 2; attempt++) {
        const userPrompt = buildUserPrompt(contextText, action, settings, attempt > 0);
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
    return { menu: ranges, roll, selected };
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

        // Swipe / regenerate: re-roll a turn we actually adjudicated.
        if (SWIPE_TYPES.has(type)) {
            // A forced compliance regen keeps the SAME outcome — don't re-roll.
            if (suppressReroll) { suppressReroll = false; return chat; }
            if (!settings.autoRerollOnSwipe) return chat;
            if (!pending || pending.status !== 'committed') return chat;
            await runInlineRoll('swipe', { committed: true, messageId: pending.messageId, chat });
            return chat;
        }

        // Background / utility generations are never adjudicated.
        if (SKIP_TYPES.has(type)) return chat;

        // Otherwise this is a fresh player send (type is 'normal', undefined, '').
        // A primed roll (manual pre-roll, or a double-fire of this same send)
        // takes precedence: consume it rather than rolling again.
        if (pending?.status === 'primed') {
            consumeOnReceive = true;
            return chat;
        }

        // Advancing to a new turn — clear any stale committed directive first.
        if (pending?.status === 'committed') {
            clearDirective();
            pending = null;
            regenGuardMessageId = null;
        }

        if (!settings.autoRollOnSend) return chat; // manual-only mode

        const ok = await runInlineRoll('send', { committed: false, messageId: null, chat });
        if (ok) consumeOnReceive = true; // this generation consumes it; commit on end
        return chat;
    } catch (e) {
        console.error('[Outcome Roll] interceptor error', e);
        return chat; // fail open — never block the player's generation
    }
}

// Register under the exact name declared in manifest.json's generate_interceptor.
globalThis.outcomeRollGenerationInterceptor = outcomeRollGenerationInterceptor;

// --- GENERATION_ENDED: primed -> committed, toast, and compliance check -----
export function onGenerationEnded() {
    if (busy) return; // ignore the side-call's own end event
    const settings = getSettings();
    if (!settings.enabled) return;

    let landed = false; // a real adjudicated reply just completed

    if (consumeOnReceive && pending?.status === 'primed') {
        pending.status = 'committed';
        pending.messageId = (getST()?.chat?.length ?? 1) - 1;
        consumeOnReceive = false;
        landed = true;
        if (settings.showResultAfter) showResultToast(pending);
    }

    if (showToastNext) {
        showToastNext = false;
        landed = true;
        if (settings.showResultAfter && pending) showResultToast(pending);
    }

    if (landed && pending?.selected && settings.complianceCheck) {
        runComplianceCheck(settings);
    }
}

// Did the reply actually reflect the selected outcome? Log HIT/MISS and record
// it in the debug view. Optionally regenerate once (keeping the same outcome).
function runComplianceCheck(settings) {
    const chat = getST()?.chat ?? [];
    const reply = chat[chat.length - 1]?.mes ?? '';
    const res = checkCompliance(pending.selected.text, reply);
    if (!res.checked) return;

    pending.compliance = res.hit ? 'hit' : 'miss';
    annotateDebug({ compliance: pending.compliance, complianceTokens: res.ranked, complianceHits: res.hits });

    if (res.hit) {
        console.info(`[Outcome Roll] compliance HIT (${pending.selected.tag}) — matched: ${res.hits.join(', ')}`);
        return;
    }

    console.warn(`[Outcome Roll] compliance MISS (${pending.selected.tag}) — none of [${res.ranked.join(', ')}] appeared in the reply.`);

    // Regenerate at most once per turn, keeping the same outcome.
    if (settings.autoRegenerateOnMiss && regenGuardMessageId !== pending.messageId) {
        regenGuardMessageId = pending.messageId;
        autoRegenerate();
    }
}

function autoRegenerate() {
    const ctx = getST();
    if (typeof ctx?.generate !== 'function') {
        console.warn('[Outcome Roll] auto-regenerate unavailable (no generate()).');
        return;
    }
    console.info('[Outcome Roll] compliance MISS — regenerating once with the same outcome.');
    suppressReroll = true; // the forced swipe must not re-roll
    // Defer so this GENERATION_ENDED handler finishes before a new generation starts.
    setTimeout(() => {
        try {
            Promise.resolve(ctx.generate('swipe')).catch((e) => {
                suppressReroll = false;
                console.error('[Outcome Roll] auto-regenerate failed', e);
            });
        } catch (e) {
            suppressReroll = false;
            console.error('[Outcome Roll] auto-regenerate failed', e);
        }
    }, 0);
}

// --- Chat switch / reset: wipe everything so nothing leaks across chats -----
export function onChatChanged() {
    clearDirective();
    pending = null;
    consumeOnReceive = false;
    showToastNext = false;
    suppressReroll = false;
    regenGuardMessageId = null;
    busy = false;
}
