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
        `The dice determined this outcome is a ${selected.tag}: ${selected.text} ` +
        `Write the reply consistent with this, whether it follows from the player's action or from the characters and world around them. ` +
        `Do not mention dice, odds, percentages, or that anything was decided in advance.`
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
