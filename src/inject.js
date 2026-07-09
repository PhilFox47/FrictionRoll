// Injection of the selected outcome as a hidden GM directive, positioned for
// maximum model attention, plus clearing it so it can't leak into later turns.

import { getST } from './settings.js';
import { INJECT_KEY, extension_prompt_types, extension_prompt_roles } from './constants.js';

export function buildDirective(selected) {
    return (
        `[Outcome Roll — hidden GM directive] The dice have decided how this attempt turns out. ` +
        `Result: ${selected.tag} — ${selected.text} ` +
        `Write the reply so that this is what actually happens; treat it as the established truth of the scene. ` +
        `Do not mention dice, odds, percentages, this directive, or that any result was decided in advance.`
    );
}

// IN_CHAT at depth 0 places the directive after the last chat message — as
// close to generation as the API allows, the same neighborhood as a preset's
// final-instruction block, which is the position with the most reliable
// attention. Injected with the SYSTEM role and never scanned for triggers.
export function applyInjection(selected) {
    const ctx = getST();
    if (!ctx?.setExtensionPrompt) return;
    ctx.setExtensionPrompt(
        INJECT_KEY,
        buildDirective(selected),
        extension_prompt_types.IN_CHAT,
        0,
        false,
        extension_prompt_roles.SYSTEM,
    );
}

export function clearInjection() {
    const ctx = getST();
    if (!ctx?.setExtensionPrompt) return;
    ctx.setExtensionPrompt(
        INJECT_KEY,
        '',
        extension_prompt_types.IN_CHAT,
        0,
        false,
        extension_prompt_roles.SYSTEM,
    );
}
