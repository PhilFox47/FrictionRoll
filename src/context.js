// Context gathering for the side-call: recent chat as speaker-labeled plain
// text, trimmed to a token budget, plus the specific action being adjudicated.

import { getST, getSettings } from './settings.js';

// Light plain-text cleanup: strip HTML/markup and collapse whitespace so the
// side-call sees prose, not formatting.
export function stripText(mes) {
    if (!mes) return '';
    return String(mes)
        .replace(/<[^>]+>/g, ' ')       // HTML tags
        .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
        .replace(/\r/g, '')
        .replace(/[*_~`]/g, '')          // md emphasis markers
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function speakerLabel(m) {
    if (m.name) return m.name;
    return m.is_user ? 'User' : 'Character';
}

function lastUserMessage(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].is_user && !chat[i].is_system) return chat[i];
    }
    return null;
}

// The action being adjudicated.
//  - manual mode: the composer draft (the message hasn't been sent yet).
//  - send mode: by the time we roll (PROMPT_READY) the message is committed to
//    chat and the composer is usually cleared, so we fall back to the last
//    player message; the draft is still checked first in case it lingers.
//  - swipe mode: the last player message already in chat (composer is empty).
export function getPlayerAction(mode) {
    const chat = getST()?.chat ?? [];

    if ((mode === 'manual' || mode === 'send') && globalThis.jQuery) {
        const draft = String(globalThis.jQuery('#send_textarea').val() ?? '').trim();
        if (draft) return stripText(draft);
    }

    const last = lastUserMessage(chat);
    return last ? stripText(last.mes) : '';
}

// Build the trimmed, speaker-labeled context block.
export async function gatherContext(mode) {
    const ctx = getST();
    const settings = getSettings();

    let chat = (ctx?.chat ?? []).filter((m) => !m.is_system);

    // When regenerating a reply, drop the trailing assistant message being
    // swiped so we adjudicate the action, not the attempt we're replacing.
    if (mode === 'swipe' && chat.length && !chat[chat.length - 1].is_user) {
        chat = chat.slice(0, -1);
    }

    const count = Math.max(1, settings.contextMessageCount | 0);
    const recent = chat.slice(-count);
    const budget = Math.max(200, settings.contextTokenBudget | 0);

    // Walk newest -> oldest, keeping lines until the token budget is spent.
    const picked = [];
    let total = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
        const m = recent[i];
        const line = `${speakerLabel(m)}: ${stripText(m.mes)}`;
        let tokens;
        try {
            tokens = await ctx.getTokenCountAsync(line);
        } catch {
            tokens = Math.ceil(line.length / 4); // rough fallback
        }
        if (total + tokens > budget && picked.length >= 1) break;
        picked.push(line);
        total += tokens;
    }
    picked.reverse();
    return picked.join('\n');
}
