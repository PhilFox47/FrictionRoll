// Outcome Roll — a SillyTavern extension that externalizes "did this attempt
// work" from the writing model, using a weighted, dice-resolved outcome menu.
//
// Entry point: wires event listeners and mounts the UI. All SillyTavern access
// goes through the global SillyTavern.getContext(), so there are no fragile
// relative imports into the app's source.

import { getSettings } from './src/settings.js';
import { onGenerationStarted, onPromptReady, onGenerationEnded, onChatChanged } from './src/state.js';
import { registerFrictionrollMacro } from './src/directive.js';
import { initUI } from './src/ui.js';

function wireEvents(ctx) {
    const { eventSource, event_types } = ctx;
    if (!eventSource || !event_types) {
        console.warn('[Outcome Roll] event system unavailable; extension inert.');
        return;
    }
    // GENERATION_STARTED fires before the sent message is rendered — so it only
    // ARMS the turn (no rolling), keeping the send instant.
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    // PROMPT_READY (chat + text variants) fires while the REPLY prompt is
    // assembled, after the message is on screen — roll here and inject the
    // opening paragraph into the outgoing prompt.
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, onPromptReady);
    // GENERATION_ENDED: prepend the opening to the finished reply, commit, evaluate.
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
    // Keep {{frictionroll}} registered (resolves to empty) so any preset that
    // still references it doesn't leak a literal token; the opening paragraph,
    // not a macro directive, is now what carries the outcome.
    registerFrictionrollMacro();
    wireEvents(ctx);
    initUI();
    console.log('[Outcome Roll] loaded (prompt-injected opening paragraph).');
}

if (globalThis.jQuery) {
    globalThis.jQuery(() => boot());
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
