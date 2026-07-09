// A tiny in-memory debug store: last full menu + roll + selection, plus a short
// history, for tuning wording/tags without cluttering the chat.

let lastDebug = null;
const history = [];
let renderCb = null;

export function setDebug(entry) {
    lastDebug = { ...entry, at: new Date().toLocaleTimeString() };
    history.unshift(lastDebug);
    if (history.length > 15) history.length = 15;
    try { renderCb?.(lastDebug, history); } catch { /* UI not mounted yet */ }
}

// Merge extra fields (e.g. a post-generation compliance result) into the most
// recent entry and re-render.
export function annotateDebug(patch) {
    if (!lastDebug) return;
    Object.assign(lastDebug, patch);
    try { renderCb?.(lastDebug, history); } catch { /* UI not mounted yet */ }
}

export function getLastDebug() { return lastDebug; }
export function getHistory() { return history; }

// The UI registers a callback here so the panel updates live.
export function onDebugRender(cb) { renderCb = cb; }
