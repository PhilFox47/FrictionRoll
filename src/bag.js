// Shuffle-bag archetype rotation.
//
// A biased model, left to pick freely from all archetypes, keeps reaching for
// the same few favourites. Instead, the extension draws which archetypes are on
// offer each turn from a bag that cycles through the whole pool before any tag
// repeats — so every archetype surfaces regularly. The model then only has to
// write a scene-appropriate outcome for each drawn tag (and may drop one that
// genuinely can't fit). Reset per chat so each story rotates independently.

import { TAGS } from './constants.js';

let bag = [];

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Draw `n` DISTINCT archetype tags. When the bag runs dry mid-draw it refills
// (reshuffled), excluding tags already drawn this turn so a single draw is
// always distinct and no tag is lost across the refill boundary.
export function drawArchetypes(n) {
    const count = Math.max(1, Math.min(Math.floor(n) || 1, TAGS.length));
    const drawn = [];
    while (drawn.length < count) {
        if (bag.length === 0) {
            bag = shuffle(TAGS.filter((t) => !drawn.includes(t)));
        }
        drawn.push(bag.shift());
    }
    return drawn;
}

export function resetBag() { bag = []; }
export function peekBag() { return [...bag]; }
