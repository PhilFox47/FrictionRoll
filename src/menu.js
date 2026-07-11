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

// A detached, analytical framing — deliberately NOT the roleplay persona, so
// the model returns a neutral breakdown instead of answering in character.
export function buildSystemPrompt() {
    return [
        'You are an impartial adjudication engine for a tabletop roleplay session.',
        'You do NOT write prose, dialogue, or roleplay, and you do NOT play any character.',
        'Given the scene so far and the player\'s latest message, you output a short weighted menu of ways the story could plausibly continue in the very next beat.',
        'Each outcome is a brief INSTRUCTION stating what happens next — NOT finished prose and NOT dialogue. A separate writer turns your instruction into the actual scene, so never stage the wording, quote any speech, or add stylistic or sensory description. Just name the event plainly in one sentence.',
        'This is NOT only about whether the player\'s action succeeds. What happens next may follow directly from what the player did, OR it may come from elsewhere:',
        'how another character reacts, something in the environment or the wider situation, an outside party noticing or intervening, a discovery, an interruption, or the plot turning in a particular direction.',
        'ABSOLUTE RULE: outcomes describe ONLY what happens outside the player\'s own control — what other characters do or say, how the environment or situation shifts, what events occur.',
        'You must NEVER state, imply, or dictate the player character\'s own actions, dialogue, thoughts, feelings, or reactions. Those belong to the player alone. You decide only what the player is reacting TO, never how they react.',
        'Judge each outcome\'s probability honestly from the context. Do not inflate the odds of success, of the player\'s preferred result, or of the tamest option — real attempts can and do go badly.',
        'The outcomes must be genuinely different from one another in how the scene actually develops — different directions and developments, not reworded versions of the same result.',
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
        'Write ONE possible outcome for EACH of these archetypes — exactly one line per archetype, using the token on the left verbatim as the TAG:',
        archetypeLegendFor(tags),
        'Rules:',
        `- CRITICAL: each outcome describes ONLY what happens around or to ${who} — what other characters do or say, how the environment or situation changes, what events occur. NEVER describe ${who}'s own actions, words, thoughts, feelings, or reactions. You decide what they react TO, never how they react.`,
        '  Bad (dictates the player): "She laughs, and he laughs along as the tension breaks."  Good (external only): "She dissolves into laughter."',
        '- Write each outcome as a SHORT INSTRUCTION of what happens, not as prose. One plain sentence (about 8–25 words). No quotation marks or dialogue, no staged wording, no sensory or stylistic description — the writer will handle all of that. State the event; do not perform it.',
        '  Bad (pre-written prose/dialogue): She smiles and traces your jaw. "First I\'d test your limits," she purrs.  Good (instruction): Joanne takes physical control and names the first small test she intends to put you through.',
        '- Use ONLY the archetypes listed above, each exactly once. Do not invent other tags or reuse one.',
        '- Make each archetype fit THIS scene. If one genuinely cannot fit what is happening, omit that single line rather than forcing it — but keep as many as you can.',
        '- An outcome can hinge on the player\'s action, or on an external factor (another character\'s reaction, an outside event, a discovery, the plot advancing). It does not have to be about the action working or not.',
        '- Note WORLD_* archetypes are judged only from the NPC\'s or world\'s point of view — a loss for them is not automatically a win for the player, and vice versa.',
        '- ADVERSE OR DISRUPTIVE outcomes (LOSS, WORLD_LOSS, TWIST, REVERSAL, CONSEQUENCE, COMPLICATION) are allowed to be BIG and to carry real, lasting consequences: a plan ruined, a bond broken, an injury or a death, capture, exposure, a hard turn away from the card\'s expected plot. Do NOT take the easy way out with a soft, consequence-free version — when one of these lands, let it genuinely cost something and change the story, even if that breaks the natural flow of the scene.',
        '- Continue THIS scene using what is already in it. Build outcomes from the people, objects, and threads already present. Do not introduce a brand-new character or entity that has never appeared (a passing janitor, a coach, a stranger) unless that genuinely is the single most interesting turn available.',
        `- Do not hard-contradict a direct question or statement ${who} just made. An outcome that cuts that thread off entirely (e.g. an interruption that prevents any answer) should be rare, not a default.`,
        '- A limp, consequence-free outcome in a charged situation is jarring — avoid it. It is fine for an adverse or disruptive outcome to break a calm moment and spike the stakes; that is welcome, not a problem.',
        `- PERCENT is an integer from ${floor} to ${ceiling} reflecting how likely this outcome is. Nothing is 0 (impossible) or 100 (guaranteed). The percentages should roughly sum to 100 across your lines.`,
        '- Each outcome is exactly one line, pipe-delimited: TAG|PERCENT|short instruction of what happens next.',
        '- Output ONLY the outcome lines. No numbering, no preamble, no markdown, no blank lines, no commentary.',
        '',
        'Format example (illustrative tags only — use the archetypes listed above, not these). Note each line is a short instruction about other characters and the world, never the player, and contains no dialogue:',
        'WIN|25|The patrol passes the crates and moves on without noticing you.',
        'LOSS|25|The patrol spots you and moves to surround you; this hiding spot is blown for good.',
        'CLOCK|20|The smugglers\' truck starts up down the block — they are nearly ready to leave.',
    ];

    if (stricter) {
        lines.push(
            '',
            'IMPORTANT: your previous response was malformed. Output ONLY lines of the form TAG|PERCENT|text, one per line, ' +
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

// Run the side-call. Either reuse the active chat connection (generateRaw,
// which bypasses the RP persona), or route through a configured Connection
// Manager profile with a sampler override.
export async function runSideCall(systemPrompt, userPrompt, maxTokens = 400) {
    const ctx = getST();
    const settings = getSettings();

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

// Built from TAGS, longest-token-first so e.g. WORLD_WIN is tried before WIN.
// Tolerates an optional leading list marker ("- ", "* ", "1. ", "2) ") since
// small models often bullet their lines despite being told not to.
const TAG_ALTERNATION = [...TAGS].sort((a, b) => b.length - a.length).join('|');
const LINE_RE = new RegExp(
    `^\\s*(?:[-*•]|\\d+[.)])?\\s*(${TAG_ALTERNATION})\\s*\\|\\s*(\\d{1,3})\\s*\\|\\s*(.+?)\\s*$`,
    'i',
);

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
