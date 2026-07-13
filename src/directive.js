// The {{frictionroll}} macro. The opening paragraph (injected directly into the
// outgoing reply prompt) is now what carries the rolled outcome, so this macro
// no longer steers anything — it stays registered and resolves to an empty
// string purely so any preset that still references {{frictionroll}} (e.g. the
// old Friction Lite directive block) doesn't leak a literal "{{frictionroll}}"
// token into the prompt.

import { getST } from './settings.js';
import { MACRO_NAME } from './constants.js';

export function registerFrictionrollMacro() {
    const ctx = getST();
    if (!ctx?.registerMacro) {
        console.warn(`[Outcome Roll] registerMacro unavailable — {{${MACRO_NAME}}} will not resolve.`);
        return false;
    }
    ctx.registerMacro(
        MACRO_NAME,
        () => '',
        'Outcome Roll (legacy directive macro; now always empty — the opening paragraph carries the outcome).',
    );
    return true;
}
