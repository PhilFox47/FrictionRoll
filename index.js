// Outcome Roll — a SillyTavern extension that externalizes "did this attempt
// work" from the writing model, using a weighted, dice-resolved outcome menu.
//
// Entry point: wires event listeners and mounts the UI. All SillyTavern access
// goes through the global SillyTavern.getContext(), so there are no fragile
// relative imports into the app's source.

import { getSettings } from './src/settings.js';
import { onGenerationStarted, onGenerationEnded, onChatChanged } from './src/state.js';
import { registerFrictionrollMacro } from './src/directive.js';
import { initUI } from './src/ui.js';

function wireEvents(ctx) {
    const { eventSource, event_types } = ctx;
    if (!eventSource || !event_types) {
        console.warn('[Outcome Roll] event system unavailable; extension inert.');
        return;
    }
    // GENERATION_STARTED fires early in Generate() — before the prefill slot
    // (power_user.user_prompt_bias) is read — and is awaited, so the whole
    // roll+prefill chain runs here and the opening is in place before the main
    // generation builds its prompt.
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    // GENERATION_ENDED: clear the prefill slot, commit, evaluate.
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    // CHAT_CHANGED: wipe state so nothing leaks across chats.
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
}

function boot() {
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (!ctx) {
        console.warn('[Outcome Roll] SillyTavern context not ready; retrying shortly.');
        setTimeout(boot, 500);
        return;
    }
    getSettings();      // ensure persisted defaults exist
    const macroOk = registerFrictionrollMacro(); // {{frictionroll}} directive
    wireEvents(ctx);
    initUI();
    console.log(`[Outcome Roll] loaded (prefill + {{frictionroll}} macro: ${macroOk}).`);
}

if (globalThis.jQuery) {
    globalThis.jQuery(() => boot());
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
