// The {{frictionroll}} macro. The preset embeds it inside its own directive
// block (fr_anchor: "DIRECTIVE FOR YOUR NEXT MESSAGE … {{frictionroll}}"), which
// tells the model to make the beat happen. We resolve the macro to the winning
// outcome — the concrete event — so the directive steers the rest of the reply
// toward it, reinforcing the prefilled opening.
//
// Macros are resolved late (at prompt substitution), so the value just needs to
// be set before the reply is assembled; the value is a function so we only
// mutate a string and never re-register.

import { getST } from './settings.js';
import { MACRO_NAME } from './constants.js';

let currentDirective = '';

// The preset supplies all the "make it happen" framing, so the macro is just the
// concrete event (the winning bullet).
export function buildDirective(selected) {
    return String(selected?.text ?? '').trim();
}

export function registerFrictionrollMacro() {
    const ctx = getST();
    if (!ctx?.registerMacro) {
        console.warn(`[Outcome Roll] registerMacro unavailable — {{${MACRO_NAME}}} will not resolve.`);
        return false;
    }
    ctx.registerMacro(
        MACRO_NAME,
        () => currentDirective,
        'Outcome Roll directive for the current turn (empty when no roll is active).',
    );
    return true;
}

export function setDirective(selected) { currentDirective = buildDirective(selected); }
export function clearDirective() { currentDirective = ''; }
export function getDirective() { return currentDirective; }
