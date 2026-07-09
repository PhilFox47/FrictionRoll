// Outcome Roll — a SillyTavern extension that externalizes "did this attempt
// work" from the writing model, using a weighted, dice-resolved outcome menu.
//
// Entry point: wires event listeners and mounts the UI. All SillyTavern access
// goes through the global SillyTavern.getContext(), so there are no fragile
// relative imports into the app's source.

import { getSettings } from './src/settings.js';
// Importing state.js registers globalThis.outcomeRollGenerationInterceptor,
// the function named in manifest.json's "generate_interceptor" — that is the
// automatic trigger, fired and awaited by SillyTavern before the main prompt is
// built. The events below only handle post-generation bookkeeping.
import { onGenerationEnded, onChatChanged } from './src/state.js';
import { initUI } from './src/ui.js';

function wireEvents(ctx) {
    const { eventSource, event_types } = ctx;
    if (!eventSource || !event_types) {
        console.warn('[Outcome Roll] event system unavailable; extension inert.');
        return;
    }
    // GENERATION_ENDED: primed -> committed + optional post-hoc result toast.
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
    wireEvents(ctx);
    initUI();
    const registered = typeof globalThis.outcomeRollGenerationInterceptor === 'function';
    console.log(`[Outcome Roll] loaded. generate_interceptor registered: ${registered}`);
}

if (globalThis.jQuery) {
    globalThis.jQuery(() => boot());
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
