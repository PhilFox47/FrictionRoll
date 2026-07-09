// The genuine random roll and range selection. The number is generated
// locally and must never come from the model.

// Uniform integer in [1, 100]. Prefers crypto for real randomness, falls back
// to Math.random. Rejection sampling avoids the modulo bias crypto%100 has.
export function rollD100() {
    try {
        const c = globalThis.crypto ?? globalThis.msCrypto;
        if (c?.getRandomValues) {
            const buf = new Uint32Array(1);
            const limit = Math.floor(0x100000000 / 100) * 100; // largest multiple of 100
            let x;
            do {
                c.getRandomValues(buf);
                x = buf[0];
            } while (x >= limit);
            return (x % 100) + 1;
        }
    } catch {
        /* fall through to Math.random */
    }
    return Math.floor(Math.random() * 100) + 1;
}

// Build cumulative 1..100 ranges in the given order and find the hit.
export function selectByRoll(outcomes, roll) {
    let cumulative = 0;
    const ranges = outcomes.map((o) => {
        const start = cumulative + 1;
        cumulative += o.pct;
        return { ...o, start, end: cumulative };
    });
    const selected = ranges.find((r) => roll >= r.start && roll <= r.end)
        ?? ranges[ranges.length - 1];
    return { selected, ranges };
}
