// The rolled outcome reaches the model through a SillyTavern macro,
// {{frictionroll}}, NOT through a positional prompt injection.
//
// Positional injection (setExtensionPrompt at a depth) competes for a slot in
// the assembled prompt, and World Info / other depth-0 content can land after
// it — pushing the directive out of the "last thing the model sees" position.
// Instead, the preset's final-instruction block embeds the literal
// {{frictionroll}} placeholder, so the directive resolves *inside* that same
// string and nothing in the pipeline can be inserted between the rules and it.

import { getST } from './settings.js';
import { MACRO_NAME } from './constants.js';

// The live value of {{frictionroll}}. Empty when no roll is active.
let currentDirective = '';

export function buildDirective(selected) {
    return (
        `This beat's outcome is decided: ${selected.tag} — ${selected.text} ` +
        `Build the whole reply around this — it's the event that moves this turn, the center of the scene, ` +
        `not a detail to drop into a clause and write past. Everything else in the reply reacts to it. ` +
        `Whatever makes it land — a misread, a change of heart, an interruption — do that, even against what just happened. ` +
        `Don't soften it, shrink it, or blend it with a different result, and don't mention dice, odds, percentages, or that anything was decided in advance.`
    );
}

// Register once at load. The value is a function, so the macro always resolves
// to the latest directive without needing to re-register.
export function registerFrictionrollMacro() {
    const ctx = getST();
    if (!ctx?.registerMacro) {
        console.warn(`[Outcome Roll] registerMacro unavailable — {{${MACRO_NAME}}} will not resolve.`);
        return false;
    }
    ctx.registerMacro(
        MACRO_NAME,
        () => currentDirective,
        'Outcome Roll directive for the current pending turn (empty when no roll is active).',
    );
    return true;
}

export function setDirective(selected) { currentDirective = buildDirective(selected); }
export function clearDirective() { currentDirective = ''; }
export function getDirective() { return currentDirective; }
