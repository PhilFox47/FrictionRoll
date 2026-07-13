// Static constants for the Outcome Roll extension.

export const MODULE_NAME = 'outcome-roll';

// The macro the preset injects ({{frictionroll}}) for the directive that steers
// the rest of the reply toward the rolled outcome. The literal opening prose is
// delivered separately, via the "Start Reply With" prefill slot.
export const MACRO_NAME = 'frictionroll';

// The outcome archetypes the side-call can choose from. These tags are INTERNAL
// (the main model only ever sees the winning outcome's prose + directive), so
// the taxonomy purely shapes what kinds of beats get generated. Compact
// single-token tags keep the strict TAG|PERCENT|bullet format reliable on small
// models. Descriptions double as the prompt legend and the debug labels.
export const ARCHETYPES = [
    { tag: 'WIN', desc: 'The next beat plays out in your favour.' },
    { tag: 'COST', desc: 'The next beat plays out in your favour, but at a real cost.' },
    { tag: 'LOSS', desc: 'The next beat does not play out in your favour — and this can be a big, lasting setback: a plan collapses, something or someone is lost, real and hard-to-undo damage is done. Not a mild, quickly-recovered stumble.' },
    { tag: 'WORLD_WIN', desc: 'The next beat plays out in favour of one NPC or the world — judged only from their perspective, regardless of what it means for you.' },
    { tag: 'WORLD_COST', desc: 'The next beat favours one NPC or the world but at a real cost to them — their perspective only, regardless of you.' },
    { tag: 'WORLD_LOSS', desc: 'The next beat does not play out in favour of one NPC or the world — their perspective only, and NOT automatically a win for you.' },
    { tag: 'TWIST', desc: 'Something unexpected happens, turning the scene in a new direction — up to a major swerve that upends the situation or breaks from the card\'s expected plot, not a small surprise that smooths over in a line.' },
    { tag: 'CONTINUE', desc: 'The scene simply continues in its most logical direction.' },
    { tag: 'ESCALATION', desc: 'Stakes, danger, or intensity rise sharply — whoever it favours.' },
    { tag: 'DE_ESCALATION', desc: 'Tension releases: a threat backs off, things calm, a breath.' },
    { tag: 'STALEMATE', desc: 'Nobody gains ground; the situation holds and the decision is deferred.' },
    { tag: 'REVELATION', desc: 'A secret, a lie, or a hidden fact surfaces.' },
    { tag: 'CLOCK', desc: 'The world moves on its own schedule — a timer, plan, or off-screen event advances regardless of you.' },
    { tag: 'CONSEQUENCE', desc: 'A consequence of an earlier action, or a stated rule or threat, lands now.' },
    { tag: 'REVERSAL', desc: 'The power dynamic flips — whoever was in control loses it.' },
    { tag: 'INTERRUPTION', desc: 'A new person or event breaks into the scene and redirects it.' },
    { tag: 'COMPLICATION', desc: 'A fresh obstacle or problem appears that is not cleanly anyone\'s win or loss.' },
];

export const TAGS = ARCHETYPES.map((a) => a.tag);

// Token budgets for the side-calls.
export const MENU_MAX_TOKENS = 400;    // a terse bullet per outcome
export const PREFILL_MAX_TOKENS = 200; // one opening paragraph for the winner
export const EVAL_MAX_TOKENS = 8;      // just "Yes" / "No"
export const EVAL_TEMPERATURE = 0.2;   // deterministic verdict

export const defaultSettings = {
    enabled: true,

    // Outcome-menu shape.
    minOutcomes: 3,
    maxOutcomes: 5,
    floor: 5,
    ceiling: 70,

    // Context gathering for the side-call.
    contextMessageCount: 8,
    contextTokenBudget: 1000,

    // Connection: '' means "reuse the active chat connection" (generateRaw).
    // Any other value is a Connection Manager profile id used for the side-call.
    connectionProfileId: '',

    // The outcome-menu side-call writes terse bullets (structured), so a lower
    // temperature. The prefill side-call writes prose, so a creative one near
    // the main roleplay generation.
    outcomeTemperature: 0.7,
    prefillTemperature: 0.9,

    // Optional: pop a small editor to specify/edit the action before rolling.
    promptForAction: false,

    // Show the roll result as post-hoc flavor AFTER the reply is written.
    // Default hidden so outcomes can't be gamed by seeing them coming.
    showResultAfter: false,

    // Automatically run the roll pipeline on every message you send, before the
    // main reply is generated. When off, rolls only happen via the manual
    // button / slash command (the original manual-only behavior).
    autoRollOnSend: true,

    // Automatic fresh roll when swiping/regenerating an adjudicated reply.
    autoRerollOnSwipe: true,

    // After a reply, ask the model (a Yes/No side-call) whether it actually
    // delivered the selected outcome, and log the verdict for visibility.
    evaluateOutcome: true,
};
