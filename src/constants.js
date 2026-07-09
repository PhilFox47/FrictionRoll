// Static constants for the Outcome Roll extension.

export const MODULE_NAME = 'outcome-roll';

// Key used with setExtensionPrompt for the hidden GM directive.
export const INJECT_KEY = 'outcome_roll_directive';

// The three-way tag vocabulary, intentionally mirroring Friction Lite's
// fail-forward rule (clean win / works-but-costs / fails-but-gains).
// If Friction Lite's rule 8 wording changes, update these to match.
export const TAGS = ['WIN', 'COST', 'SETBACK'];

// Verified verbatim from SillyTavern public/script.js. These are stable
// numeric enums; hardcoding the confirmed values keeps the extension free of
// fragile relative imports (everything else comes from SillyTavern.getContext()).
//   extension_prompt_types: NONE:-1, IN_PROMPT:0, IN_CHAT:1, BEFORE_PROMPT:2
//   extension_prompt_roles: SYSTEM:0, USER:1, ASSISTANT:2
export const extension_prompt_types = {
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
};

export const extension_prompt_roles = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};

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

    // Sampler override for the side-call (structured output wants low temp).
    temperature: 0.5,

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
};
