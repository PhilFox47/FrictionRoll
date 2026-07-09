// A single AI pass that judges whether a generated reply actually delivered the
// selected outcome. Unlike keyword matching, this asks the model directly for a
// Yes/No verdict, which the caller logs for visibility.

export function buildEvalSystemPrompt() {
    return [
        'You are a strict evaluator for a roleplay system. You do not roleplay or write prose.',
        'You are given an OUTCOME that was supposed to happen next in the scene, and the REPLY that was written.',
        'Decide whether the reply actually makes that outcome happen as a real, central event — not merely hinted at, mentioned in passing, or contradicted.',
        'Answer with a single word: Yes or No. No explanation, no punctuation, nothing else.',
    ].join(' ');
}

export function buildEvalUserPrompt(outcome, reply) {
    return [
        `OUTCOME THAT SHOULD HAPPEN (${outcome.tag}):`,
        outcome.text,
        '',
        'REPLY:',
        String(reply ?? '').trim(),
        '',
        'Does the reply make this outcome actually happen as a central event of the scene? Answer only Yes or No.',
    ].join('\n');
}

// Returns 'yes' | 'no' | 'unknown'. Ambiguous responses are 'unknown' and the
// caller treats them as acceptance, so a flaky judge never forces a regen.
export function parseEvalVerdict(raw) {
    const t = String(raw ?? '').trim().toLowerCase();
    if (!t) return 'unknown';
    if (/^[^a-z]*no\b/.test(t)) return 'no';
    if (/^[^a-z]*yes\b/.test(t)) return 'yes';
    const hasYes = /\byes\b/.test(t);
    const hasNo = /\bno\b/.test(t);
    if (hasNo && !hasYes) return 'no';
    if (hasYes && !hasNo) return 'yes';
    return 'unknown';
}
