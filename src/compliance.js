// Best-effort visibility into whether the model actually honored the directive.
// Small models won't hit 100% — this makes the real rate visible instead of
// silent. It is a heuristic: distinctive-word overlap between the selected
// outcome text and the generated reply, tolerant of light paraphrasing.

const STOP = new Set([
    'the', 'and', 'but', 'for', 'with', 'without', 'from', 'into', 'your', 'you', 'yourself',
    'his', 'her', 'their', 'they', 'them', 'then', 'than', 'that', 'this', 'these', 'those',
    'over', 'under', 'out', 'off', 'away', 'back', 'who', 'what', 'when', 'where', 'while',
    'stay', 'still', 'just', 'very', 'also', 'more', 'most', 'some', 'any', 'all', 'are',
    'was', 'were', 'been', 'being', 'have', 'has', 'had', 'will', 'would', 'could', 'should',
    'about', 'around', 'before', 'after', 'onto', 'upon', 'its', 'not',
]);

export function distinctiveTokens(text) {
    const words = String(text ?? '').toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];
    const uniq = [...new Set(words)].filter((w) => !STOP.has(w));
    // Longest words first — the most content-bearing / distinctive.
    return uniq.sort((a, b) => b.length - a.length);
}

// The "early" part of the reply, where a decided outcome should land if it's
// actually the center of the beat: the opening paragraph(s), up to roughly the
// first 400–600 characters. This is the prominence proxy — an outcome that only
// shows up after this window was buried, not built around.
function earlyWindow(text) {
    const paras = String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let w = '';
    for (const p of paras) {
        w += (w ? '\n' : '') + p;
        if (w.length >= 400) break;
    }
    return w.slice(0, 600);
}

// Compliance now means PROMINENT, not merely present. A HIT requires a
// distinctive outcome word to appear in the early window (opening paragraph /
// first main clauses). If the words appear only later, that's `presentButLate`
// — the "included but weightless" case — which counts as a miss.
// Returns { checked, hit, ranked, hits, presentButLate, anyHits }.
export function checkCompliance(outcomeText, replyText) {
    const ranked = distinctiveTokens(outcomeText).slice(0, 4);
    if (!ranked.length) {
        return { checked: false, hit: false, ranked: [], hits: [], presentButLate: false, anyHits: [] };
    }
    const replyLower = String(replyText ?? '').toLowerCase();
    const earlyLower = earlyWindow(replyLower);
    const hits = ranked.filter((w) => earlyLower.includes(w));
    const anyHits = ranked.filter((w) => replyLower.includes(w));
    return {
        checked: true,
        hit: hits.length > 0,
        ranked,
        hits,
        presentButLate: hits.length === 0 && anyHits.length > 0,
        anyHits,
    };
}
