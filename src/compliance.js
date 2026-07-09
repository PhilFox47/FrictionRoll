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

// Returns { checked, hit, ranked, hits }. `checked` is false when the outcome
// text has no usable distinctive words to look for.
export function checkCompliance(outcomeText, replyText) {
    const ranked = distinctiveTokens(outcomeText).slice(0, 4);
    if (!ranked.length) return { checked: false, hit: false, ranked: [], hits: [] };
    const reply = String(replyText ?? '').toLowerCase();
    const hits = ranked.filter((w) => reply.includes(w));
    return { checked: true, hit: hits.length > 0, ranked, hits };
}
