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
import { applyInjection, clearInjection } from './inject.js';
import { setDebug } from './debug.js';

let pending = null;
let busy = false;            // a pipeline (manual or swipe) is running
let consumeOnReceive = false; // the in-flight normal generation is using the primed roll
let showToastNext = false;    // a swipe reroll wants a post-hoc result toast

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
async function generateMenu(mode, actionOverride) {
    const settings = getSettings();
    const contextText = await gatherContext(mode);
    const action = actionOverride ?? getPlayerAction(mode);
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

        const result = await generateMenu('manual', actionOverride);
        pending = { ...result, status: 'primed', messageId: null };
        applyInjection(result.selected);
        // Deliberately does NOT reveal the roll/outcome here — that would let it
        // be gamed by seeing it coming.
        notify('success', '🎲 Rolled — outcome locked in. Send your message.');
    } catch (e) {
        console.error('[Outcome Roll] manual roll failed', e);
        clearInjection();
        pending = null;
        notify('warning', 'Roll failed — continuing without an adjudicated outcome.');
    } finally {
        busy = false;
    }
}

// Guard against both emit shapes: (type, options, dryRun) and (type, dryRun).
function isDryRun(options, dryRun) {
    return dryRun === true || options === true || options?.dryRun === true;
}

// --- GENERATION_STARTED: swipe re-roll + primed/committed transitions -------
// eventSource.emit awaits async listeners, so the swipe branch can run the full
// pipeline (fresh menu + fresh roll) before the swipe builds its prompt.
export async function onGenerationStarted(type, options, dryRun) {
    if (isDryRun(options, dryRun)) return;
    if (busy) return; // ignore re-entrancy from our own side-call generations
    const settings = getSettings();
    if (!settings.enabled) return;

    const isSwipe = type === 'swipe' || type === 'regenerate';

    if (isSwipe) {
        if (!settings.autoRerollOnSwipe) return;
        // Only re-roll a turn we actually adjudicated; leave normal swipes alone.
        if (!pending || pending.status !== 'committed') return;
        busy = true;
        try {
            const result = await generateMenu('swipe');
            pending = { ...result, status: 'committed', messageId: pending.messageId };
            applyInjection(result.selected);
            showToastNext = settings.showResultAfter; // reveal after the swipe writes
        } catch (e) {
            console.error('[Outcome Roll] swipe re-roll failed', e);
            clearInjection(); // fail open: this swipe just isn't adjudicated
        } finally {
            busy = false;
        }
        return;
    }

    if (type === 'normal') {
        if (pending?.status === 'primed') {
            // This generation consumes the primed roll.
            consumeOnReceive = true;
        } else if (pending?.status === 'committed') {
            // Player has advanced to a new, unrelated turn — clear the stale
            // directive before it can bleed into this reply.
            clearInjection();
            pending = null;
        }
    }
    // Other types (quiet/impersonate/continue) leave state untouched.
}

// --- GENERATION_ENDED: primed -> committed, and post-hoc result toast -------
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
}

// --- Chat switch / reset: wipe everything so nothing leaks across chats -----
export function onChatChanged() {
    clearInjection();
    pending = null;
    consumeOnReceive = false;
    showToastNext = false;
    busy = false;
}
