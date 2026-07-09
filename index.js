// Outcome Roll — a SillyTavern extension that externalizes "did this attempt
// work" from the writing model, using a weighted, dice-resolved outcome menu.
//
// Entry point: wires event listeners and mounts the UI. All SillyTavern access
// goes through the global SillyTavern.getContext(), so there are no fragile
// relative imports into the app's source.

import { getSettings } from './src/settings.js';
import {
    onGenerationStarted, onGenerationEnded, onChatChanged,
} from './src/state.js';
import { initUI } from './src/ui.js';

function wireEvents(ctx) {
    const { eventSource, event_types } = ctx;
    if (!eventSource || !event_types) {
        console.warn('[Outcome Roll] event system unavailable; extension inert.');
        return;
    }
    // GENERATION_STARTED is emitted early in Generate() with the generation
    // type ('normal', 'swipe', 'regenerate', 'quiet', ...). eventSource.emit
    // awaits async listeners, so the swipe branch can run the full pipeline
    // before the swipe builds its prompt.
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
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
    console.log('[Outcome Roll] loaded.');
}

if (globalThis.jQuery) {
    globalThis.jQuery(() => boot());
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
