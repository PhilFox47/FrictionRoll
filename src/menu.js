// Outcome-menu generation: prompt construction, the detached side-call,
// strict parsing, type-diversity validation, and percentage normalization.

import { getST, getSettings } from './settings.js';
import { TAGS } from './constants.js';

// A detached, analytical framing — deliberately NOT the roleplay persona, so
// the model returns a neutral breakdown instead of answering in character.
export function buildSystemPrompt() {
    return [
        'You are an impartial outcome-adjudication engine for a tabletop roleplay session.',
        'You do NOT write prose, dialogue, or roleplay, and you do NOT play any character.',
        'Given a scene and one specific attempted action, you output a short weighted menu of plausible outcomes for that action.',
        'Judge plausibility neutrally. Do not favor success or the most dramatic result — real attempts often fail or cost something.',
    ].join(' ');
}

export function buildUserPrompt(contextText, action, settings, stricter = false) {
    const { minOutcomes, maxOutcomes, floor, ceiling } = settings;
    const lines = [
        'SCENE (recent context):',
        contextText || '(no prior context)',
        '',
        'ACTION BEING ADJUDICATED:',
        action || '(the character attempts something with an uncertain result)',
        '',
        `Produce between ${minOutcomes} and ${maxOutcomes} distinct possible outcomes for this action.`,
        'Rules:',
        '- Each outcome is exactly one line, pipe-delimited: TAG|PERCENT|one concise sentence describing what happens.',
        '- TAG is exactly one of: WIN (clean success), COST (succeeds but at a real price or complication), SETBACK (fails, or a genuine curveball).',
        '- You MUST include at least one WIN, at least one COST, and at least one SETBACK.',
        `- PERCENT is an integer from ${floor} to ${ceiling}. Nothing is 0 (impossible) or 100 (guaranteed).`,
        '- Percentages should reflect genuine uncertainty and roughly sum to 100.',
        '- Output ONLY the outcome lines. No numbering, no preamble, no markdown, no blank lines, no commentary.',
        '',
        'Example of the exact format:',
        'WIN|35|The lock clicks open on the first try.',
        'COST|40|The lock opens but the pick snaps off inside, ruining it.',
        'SETBACK|25|The pick jams and a guard hears the rattle from down the hall.',
    ];

    if (stricter) {
        lines.push(
            '',
            'IMPORTANT: your previous response was malformed. Output ONLY lines of the form TAG|PERCENT|text, one per line, ' +
            'and make sure at least one WIN, one COST, and one SETBACK are present. Output nothing else.',
        );
    }

    return lines.join('\n');
}

// Coerce whatever the generation path returns into a plain string.
function asText(result) {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
        return result.content ?? result.text ?? result.message ?? String(result);
    }
    return String(result ?? '');
}

// Run the side-call. Either reuse the active chat connection (generateRaw,
// which bypasses the RP persona), or route through a configured Connection
// Manager profile with a sampler override.
export async function runSideCall(systemPrompt, userPrompt) {
    const ctx = getST();
    const settings = getSettings();
    const maxTokens = 400;

    if (settings.connectionProfileId) {
        const CM = ctx.ConnectionManagerRequestService;
        if (!CM?.sendRequest) throw new Error('Connection Manager service unavailable');
        // Fold the system instruction into the prompt string so this works for
        // both text-completion and chat-completion profiles.
        const prompt = `${systemPrompt}\n\n${userPrompt}`;
        const overridePayload = {};
        if (Number.isFinite(settings.temperature)) overridePayload.temperature = settings.temperature;
        const result = await CM.sendRequest(settings.connectionProfileId, prompt, maxTokens, undefined, overridePayload);
        return asText(result);
    }

    // Detached raw generation on the active connection.
    const opts = { prompt: userPrompt, systemPrompt, responseLength: maxTokens };
    // Best-effort sampler override (honored on paths that read it; harmless otherwise).
    if (Number.isFinite(settings.temperature)) opts.temperature = settings.temperature;
    const result = await ctx.generateRaw(opts);
    return asText(result);
}

// Tolerate an optional leading list marker ("- ", "* ", "1. ", "2) ") since
// small models often bullet their lines despite being told not to.
const LINE_RE = /^\s*(?:[-*•]|\d+[.)])?\s*(WIN|COST|SETBACK)\s*\|\s*(\d{1,3})\s*\|\s*(.+?)\s*$/i;

// Strict, line-by-line parse. Malformed lines are discarded, not fatal.
export function parseMenu(raw) {
    const out = [];
    if (!raw) return out;
    for (const rawLine of String(raw).split('\n')) {
        const m = rawLine.match(LINE_RE);
        if (!m) continue;
        const tag = m[1].toUpperCase();
        const pct = parseInt(m[2], 10);
        const text = m[3].trim();
        if (!text || !Number.isFinite(pct)) continue;
        out.push({ tag, pct, text });
    }
    return out;
}

// Validation checks type diversity, not just line count — a biased model can
// pass a numeric spread while offering three flavors of "it works".
export function validateMenu(outcomes) {
    if (!outcomes || outcomes.length < 2) {
        return { ok: false, reason: 'too_few', missing: [...TAGS] };
    }
    const present = new Set(outcomes.map((o) => o.tag));
    const missing = TAGS.filter((t) => !present.has(t));
    return { ok: missing.length === 0, reason: missing.length ? 'missing_tags' : null, missing };
}

// --- Normalization to integer percentages summing to exactly 100 ----------

function clampRedistribute(items, floor, ceiling) {
    const n = items.length;
    // Never let the configured bounds become infeasible for n outcomes.
    const lo = Math.min(floor, Math.floor(100 / n));
    const hi = Math.max(ceiling, Math.ceil(100 / n));

    for (let iter = 0; iter < 30; iter++) {
        for (const o of items) o.pct = Math.min(hi, Math.max(lo, o.pct));
        const sum = items.reduce((a, o) => a + o.pct, 0);
        const diff = sum - 100; // >0 too much, <0 too little
        if (Math.abs(diff) < 1e-6) break;
        // Push the difference onto the outcomes that still have headroom.
        const adjustable = items.filter((o) => (diff > 0 ? o.pct > lo : o.pct < hi));
        if (!adjustable.length) break;
        const adjSum = adjustable.reduce((a, o) => a + o.pct, 0);
        for (const o of adjustable) {
            const share = adjSum > 0 ? o.pct / adjSum : 1 / adjustable.length;
            o.pct -= diff * share;
        }
    }
}

function roundToHundred(items) {
    const floors = items.map((o) => Math.floor(o.pct));
    const used = floors.reduce((a, b) => a + b, 0);
    let remainder = Math.max(0, 100 - used);
    // Largest-remainder method: hand the leftover points to the biggest fractions.
    const order = items
        .map((o, i) => ({ i, frac: o.pct - Math.floor(o.pct) }))
        .sort((a, b) => b.frac - a.frac);
    const result = floors.slice();
    for (let k = 0; k < order.length && remainder > 0; k++) {
        result[order[k].i]++;
        remainder--;
    }
    items.forEach((o, i) => { o.pct = result[i]; });

    // Safety: no zero-width ranges. Steal a point from the largest for any zero.
    for (const o of items) {
        if (o.pct <= 0) {
            const donor = items.reduce((a, b) => (b.pct > a.pct ? b : a), items[0]);
            if (donor && donor.pct > 1) { donor.pct -= 1; o.pct = 1; }
        }
    }
}

// Never trust the model's percentages. Rescale if the sum drifts, clamp to the
// configured floor/ceiling with redistribution, then round to integers/100.
export function normalize(outcomes, floor, ceiling) {
    const items = outcomes.map((o) => ({ ...o, pct: Math.max(0, Number(o.pct) || 0) }));
    const n = items.length;

    let sum = items.reduce((a, o) => a + o.pct, 0);
    if (sum <= 0) {
        items.forEach((o) => { o.pct = 100 / n; });
        sum = 100;
    }

    // Rescale to sum 100 whenever it isn't already there (or drifts out of a
    // reasonable tolerance band).
    if (sum < 90 || sum > 110 || Math.round(sum) !== 100) {
        items.forEach((o) => { o.pct = (o.pct * 100) / sum; });
    }

    clampRedistribute(items, floor, ceiling);
    roundToHundred(items);
    return items;
}
