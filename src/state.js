// Orchestration + the trigger/lifecycle state machine.
//
//   pending = {
//     menu, roll, selected,          // the current adjudicated outcome
//     prefill,                       // the generated opening prose for it
//     status: 'primed' | 'committed' // primed = rolled, not yet generated;
//                                     // committed = a reply was produced with it
//     messageId,                     // chat index of that reply (committed only)
//   }
//
// The outcome reaches the reply as a PREFILL written into power_user's
// "Start Reply With" slot. That value is read EARLY in Generate (getBiasStrings),
// so it must be set before generation — which is why the trigger is the early,
// awaited GENERATION_STARTED event, not the late generate-interceptor.

import { getST, getSettings } from './settings.js';
import { gatherContext, getPlayerAction } from './context.js';
import {
    buildSystemPrompt, buildUserPrompt, runSideCall,
    parseMenu, dedupeByTag, validateMenu, normalize,
} from './menu.js';
import { rollD100, selectByRoll } from './roll.js';
import { drawArchetypes, resetBag } from './bag.js';
import { generatePrefill, setPrefill, clearPrefill } from './prefill.js';
import { setDebug, annotateDebug } from './debug.js';
import { buildEvalSystemPrompt, buildEvalUserPrompt, parseEvalVerdict } from './evaluate.js';

let pending = null;
let busy = false;            // a pipeline (manual/send/swipe) is running
let consumeOnReceive = false; // the in-flight normal generation is using the primed roll
let showToastNext = false;    // a swipe wants a post-hoc result toast
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

// Our chain runs at GENERATION_STARTED, which pauses Generate() BEFORE ST flips
// the Send button to Stop — so during our side-calls the UI would still show
// "Send". Flip it to Stop ourselves for immediate feedback; ST does the same
// deactivate/activate itself once it resumes, so this just bridges the gap.
function showGeneratingUI() {
    try {
        const $ = globalThis.jQuery;
        if (!$) return;
        $('#send_but').addClass('displayNone');   // hide Send (ST's own class)
        $('#mes_stop').css('display', 'flex');     // show Stop (matches showStopButton)
    } catch { /* UI not present */ }
}

// The outcome pipeline: gather -> menu side-call (+one strict retry) ->
// parse/dedupe/validate -> normalize -> roll -> select. Throws on unrecoverable
// failure so callers can fail open.
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
        raw = await runSideCall(systemPrompt, userPrompt);
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
    return { menu: ranges, roll, selected, raw, action, contextText, candidateTags };
}

// The full chain: roll an outcome, generate its opening prose, and write that
// into the "Start Reply With" slot. `busy` guards re-entrancy from our own
// side-call generations. Fails open: on error, the prefill slot is left empty
// and the reply generates normally.
async function produceOutcome(mode, { actionOverride, committed = false, messageId = null } = {}) {
    busy = true;
    try {
        const result = await generateMenu(mode, { actionOverride });

        // Turn the selected outcome into the opening of the reply (creative call).
        let prefill = '';
        try {
            prefill = await generatePrefill(result.contextText, result.selected.text);
        } catch (e) {
            console.warn('[Outcome Roll] prefill generation failed — reply will generate without a prefill.', e);
            prefill = '';
        }

        pending = { ...result, prefill, status: committed ? 'committed' : 'primed', messageId };
        if (prefill) setPrefill(prefill); else clearPrefill();

        annotateDebug({ prefill: prefill || '(none)' });
        console.info(`[Outcome Roll] ${mode} roll ${result.roll}/100 → ${result.selected.tag}: ${result.selected.text}`);
        console.info(`[Outcome Roll] prefill: ${prefill || '(empty)'}`);
        return true;
    } catch (e) {
        console.error(`[Outcome Roll] ${mode} roll failed`, e);
        clearPrefill();
        if (committed) pending = null;
        return false;
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

    const ok = await produceOutcome('manual', { actionOverride, committed: false, messageId: null });
    if (ok) notify('success', '🎲 Rolled — opening ready. Send your message.');
    else notify('warning', 'Roll failed — continuing without an adjudicated outcome.');
}

// Generation types that are NOT a fresh player send.
const SWIPE_TYPES = new Set(['swipe', 'regenerate']);
const SKIP_TYPES = new Set(['quiet', 'impersonate', 'continue', 'ask_command']);

// Guard against both emit shapes: (type, options, dryRun) and (type, dryRun).
function isDryRun(options, dryRun) {
    return dryRun === true || options === true || options?.dryRun === true;
}

// --- The automatic trigger: GENERATION_STARTED ------------------------------
// Emitted early in Generate() (before getBiasStrings reads the prefill slot) and
// awaited, so the whole chain runs here and the prefill is in place before the
// main generation builds. Handles the type unreliability (a plain send often has
// type undefined) by treating anything that isn't a known special type as a send.
export async function onGenerationStarted(type, options, dryRun) {
    if (isDryRun(options, dryRun)) return;
    if (busy) return; // re-entrancy from our own side-call generations
    const settings = getSettings();
    if (!settings.enabled) return;

    // Swipe / regenerate: regenerate the whole chain fresh (new menu, roll, prefill).
    if (SWIPE_TYPES.has(type)) {
        if (!settings.autoRerollOnSwipe) return;
        if (!pending || pending.status !== 'committed') return;
        showGeneratingUI();
        const ok = await produceOutcome('swipe', { committed: true, messageId: pending.messageId });
        if (ok) { showToastNext = settings.showResultAfter; judgeThisReply = true; }
        return;
    }

    // Background / utility generations are never adjudicated.
    if (SKIP_TYPES.has(type)) return;

    // Otherwise this is a fresh player send (type is 'normal', undefined, '').
    // A primed roll (manual pre-roll, or a double-fire) takes precedence: keep
    // its prefill and consume it rather than rolling again.
    if (pending?.status === 'primed') {
        consumeOnReceive = true;
        judgeThisReply = true;
        return;
    }

    // Advancing to a new turn — clear any stale prefill first.
    if (pending?.status === 'committed') {
        clearPrefill();
        pending = null;
    }

    if (!settings.autoRollOnSend) return; // manual-only mode

    showGeneratingUI();
    const ok = await produceOutcome('send', { committed: false, messageId: null });
    if (ok) { consumeOnReceive = true; judgeThisReply = true; }
}

// --- GENERATION_ENDED: clear the prefill slot, commit, evaluate -------------
export function onGenerationEnded() {
    if (busy) return; // ignore our own side-call end events
    const settings = getSettings();
    if (!settings.enabled) return;

    // The generation has consumed the prefill; restore the user's slot so it
    // can never leak into a later, unrelated reply.
    clearPrefill();

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
    clearPrefill();
    resetBag(); // each story rotates its archetypes independently
    pending = null;
    consumeOnReceive = false;
    showToastNext = false;
    judgeThisReply = false;
    busy = false;
}
