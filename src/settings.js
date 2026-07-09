// Settings access + the single path-independent entry point into SillyTavern.

import { MODULE_NAME, defaultSettings } from './constants.js';

// The documented, path-independent way for a third-party extension to reach
// SillyTavern's internals. Everything the extension needs (functions, event
// system, chat, settings, connection manager) hangs off this object.
export function getST() {
    return globalThis.SillyTavern?.getContext?.();
}

// Lazily initialize and back-fill the persisted settings object.
export function getSettings() {
    const ctx = getST();
    if (!ctx) return { ...defaultSettings };

    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    // Back-fill any keys added in a newer version.
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (s[k] === undefined) s[k] = v;
    }
    return s;
}

export function saveSettings() {
    getST()?.saveSettingsDebounced?.();
}
