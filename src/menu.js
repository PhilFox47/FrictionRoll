// Outcome-menu generation: prompt construction, the detached side-call,
// strict parsing, distinct-archetype dedup, and percentage normalization.

import { getST, getSettings } from './settings.js';
import { TAGS, ARCHETYPES } from './constants.js';

const DESC_BY_TAG = new Map(ARCHETYPES.map((a) => [a.tag, a.desc]));

// A legend for a specific set of archetype tags (the ones drawn this turn),
// preserving the given order, one per line.
function archetypeLegendFor(tags) {
    return tags
        .filter((t) => DESC_BY_TAG.has(t))
        .map((t) => `  ${t} — ${DESC_BY_TAG.get(t)}`)
        .join('\n');
}

// The menu is terse bullets — the internal shortlist the dice pick from. The
// winning bullet becomes the {{frictionroll}} directive; a separate call turns
// it into the opening prose (the prefill). Keeping the menu terse makes the
// strict format reliable and lets the model spend real effort on the one prose
// paragraph that actually gets written.
export function buildSystemPrompt() {
    return [
        'You are an impartial adjudication engine for a roleplay session. You do NOT write prose or dialogue and you do NOT play any character.',
        'Given the scene and the player\'s latest message, you output a short weighted menu of ways the very next beat could go — each as ONE terse bullet naming what happens, not finished prose.',
        'This is NOT only about whether the player\'s action succeeds. What happens next may follow from the action, OR from a character\'s reaction, an outside event, a discovery, an interruption, or the plot turning.',
        'ABSOLUTE RULE: outcomes describe ONLY what happens outside the player\'s control — what other characters do or say, how the situation shifts, what events occur. NEVER dictate the player character\'s own actions, dialogue, thoughts, feelings, or reactions. You decide what they react TO, never how they react.',
        'The outcomes are mutually exclusive alternatives: exactly one will be chosen and the rest discarded, so each must stand entirely on its own and never assume, continue, or build on another.',
        'Judge each outcome\'s probability honestly. Do not inflate the odds of success, of the player\'s preferred result, or of the tamest option — real attempts can and do go badly.',
    ].join(' ');
}

export function buildUserPrompt(contextText, action, settings, playerName = '', candidateTags = [], stricter = false) {
    const { floor, ceiling } = settings;
    const who = playerName ? `the player character (${playerName})` : 'the player character';
    const tags = (candidateTags && candidateTags.length) ? candidateTags : TAGS;
    const lines = [
        'SCENE (recent context):',
        contextText || '(no prior context)',
        '',
        "PLAYER'S LATEST MESSAGE (the beat to continue from):",
        action || '(the player has just acted or spoken; the situation is uncertain)',
        '',
        'Write ONE terse outcome bullet for EACH archetype below, using the token on the left verbatim as the TAG:',
        archetypeLegendFor(tags),
        'Rules:',
        `- CRITICAL: each bullet describes ONLY what happens around or to ${who} — what other characters do or say, how the situation changes, what events occur. NEVER describe ${who}'s own actions, words, thoughts, feelings, or reactions.`,
        '  Bad (dictates the player): "She laughs and he laughs along."  Good (external only): "She dissolves into laughter."',
        '- Write each bullet as a terse stage direction: <actor> <does what> [-> immediate effect], about 6-16 words. No quotation marks or dialogue, no "smirks/traces a finger/leans in" mood description — name the event; the prose step handles the wording.',
        '- Use ONLY the archetypes listed above, each exactly once. Do not invent other tags or reuse one.',
        '- INDEPENDENCE: the outcomes are mutually exclusive — exactly ONE is chosen and the rest discarded. Each must stand alone and make sense as the ONLY thing that happens next. Never assume, build on, or continue another. Each should send the scene a genuinely different direction.',
        '  Bad (all assume she texted): "she sends a text" / "the text is a photo" / "your phone dies before you can reply".  Good (independent): she texts the next day / she shows up at your door / she goes silent for days / a different person makes contact.',
        '- Make each archetype fit THIS scene. If one genuinely cannot fit, omit that single line rather than forcing it — but keep as many as you can.',
        '- Note WORLD_* archetypes are judged only from the NPC\'s or world\'s point of view — a loss for them is not automatically a win for the player, and vice versa.',
        '- ADVERSE OR DISRUPTIVE outcomes (LOSS, WORLD_LOSS, TWIST, REVERSAL, CONSEQUENCE, COMPLICATION) are allowed to be BIG and to carry real, lasting consequences: a plan ruined, a bond broken, an injury or death, capture, exposure, a hard turn away from the card\'s expected plot. Do NOT take the easy way out with a soft, consequence-free version, even if it breaks the natural flow of the scene.',
        '- Continue THIS scene using what is already in it. Do not introduce a brand-new character or entity that has never appeared unless that genuinely is the single most interesting turn available.',
        `- Do not hard-contradict a direct question or statement ${who} just made. An outcome that cuts that thread off entirely should be rare, not a default.`,
        `- PERCENT is an integer from ${floor} to ${ceiling} reflecting how likely this outcome is. Nothing is 0 or 100. The percentages should roughly sum to 100 across your lines.`,
        '- Each outcome is exactly one line, pipe-delimited: TAG|PERCENT|terse bullet. Output ONLY the outcome lines — no numbering, preamble, markdown, blank lines, or commentary.',
        '',
        'Format example (illustrative tags only — use the archetypes listed above, not these). Terse bullets about other characters and the world, never the player, no dialogue:',
        'WIN|25|The patrol passes the crates and moves on without noticing you.',
        'LOSS|25|The patrol spots you and moves to surround you; this hiding spot is blown.',
        'CLOCK|20|The smugglers finish loading and their truck pulls out.',
    ];

    if (stricter) {
        lines.push(
            '',
            'IMPORTANT: your previous response was malformed. Output ONLY lines of the form TAG|PERCENT|bullet, one per line, ' +
            'one line per archetype listed above, using those tags verbatim. Output nothing else.',
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

// Run a side-call. Either reuse the active chat connection (generateRaw, which
// bypasses the RP persona), or route through a configured Connection Manager
// profile. Callers pass an explicit temperature per call.
export async function runSideCall(systemPrompt, userPrompt, maxTokens = 400, temperature = undefined) {
    const ctx = getST();
    const settings = getSettings();

    if (settings.connectionProfileId) {
        const CM = ctx.ConnectionManagerRequestService;
        if (!CM?.sendRequest) throw new Error('Connection Manager service unavailable');
        // Fold the system instruction into the prompt string so this works for
        // both text-completion and chat-completion profiles.
        const prompt = `${systemPrompt}\n\n${userPrompt}`;
        const overridePayload = {};
        if (Number.isFinite(temperature)) overridePayload.temperature = temperature;
        const result = await CM.sendRequest(settings.connectionProfileId, prompt, maxTokens, undefined, overridePayload);
        return asText(result);
    }

    // Detached raw generation on the active connection.
    const opts = { prompt: userPrompt, systemPrompt, responseLength: maxTokens };
    // Best-effort sampler override (honored on paths that read it; harmless otherwise).
    if (Number.isFinite(temperature)) opts.temperature = temperature;
    const result = await ctx.generateRaw(opts);
    return asText(result);
}

// Built from TAGS, longest-token-first so e.g. WORLD_WIN is tried before WIN.
// Tolerates an optional leading list marker ("- ", "* ", "1. ", "2) ") since
// small models often bullet their lines despite being told not to.
const TAG_ALTERNATION = [...TAGS].sort((a, b) => b.length - a.length).join('|');
const LINE_RE = new RegExp(
    `^\\s*(?:[-*•]|\\d+[.)])?\\s*(${TAG_ALTERNATION})\\s*\\|\\s*(\\d{1,3})\\s*\\|\\s*(.+?)\\s*$`,
    'i',
);

// Bullets should be plain instructions, not staged dialogue. If the model slips
// in quoted speech, strip it so the {{frictionroll}} directive stays clean. A
// bullet with no quotes passes through untouched. (The prose paragraph — the
// prefill — is generated separately and keeps its dialogue.)
export function sanitizeOutcomeText(raw) {
    let t = String(raw ?? '').trim();
    t = t.replace(/[“”][^“”]*[“”]/g, ' ');
    t = t.replace(/"[^"]*"/g, ' ');
    t = t.replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/[\s—–-]+$/g, '')
        .replace(/[\s,;:]+$/g, '')
        .trim();
    return t;
}

// Strict, line-by-line parse. Malformed lines are discarded, not fatal.
export function parseMenu(raw) {
    const out = [];
    if (!raw) return out;
    for (const rawLine of String(raw).split('\n')) {
        const m = rawLine.match(LINE_RE);
        if (!m) continue;
        const tag = m[1].toUpperCase();
        const pct = parseInt(m[2], 10);
        const text = sanitizeOutcomeText(m[3]);
        if (!text || !Number.isFinite(pct)) continue;
        out.push({ tag, pct, text });
    }
    return out;
}

// Enforce distinct archetypes: keep the first outcome for each tag, drop later
// repeats. This is how variety is guaranteed now (no "three flavours of WIN").
export function dedupeByTag(outcomes) {
    const seen = new Set();
    const out = [];
    for (const o of outcomes ?? []) {
        if (seen.has(o.tag)) continue;
        seen.add(o.tag);
        out.push(o);
    }
    return out;
}

// After dedup, we just need at least two distinct outcomes to roll between.
export function validateMenu(outcomes) {
    if (!outcomes || outcomes.length < 2) return { ok: false, reason: 'too_few' };
    return { ok: true, reason: null };
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
