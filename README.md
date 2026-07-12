# Outcome Roll

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that
externalizes *"how does the scene continue next"* from the writing model's own
judgment, using a weighted, dice-resolved outcome menu instead.

Most RP-tuned models default toward whatever direction feels most narratively
satisfying — usually the player succeeding and things going their way. Outcome
Roll moves the decision **outside** the writing model: before the reply is
written, a detached side-call proposes a few plausible ways the next beat could
go — the player's action landing or not, but also how other characters react,
outside events, discoveries, or the plot turning — each with a probability. A
genuine local random roll picks one, and that development — not the model's
preference — is written as the literal opening of the reply, so the model must
continue *from* it rather than around it.

It's a standalone companion to the **Friction Lite** preset but works with any
preset, needs no preset changes, and is completely inert until you trigger it.

## How it works

By default (Auto-roll on send), every message you send is adjudicated
automatically before the reply is written:

1. You send a message — nothing extra to click.
2. Before the main reply is generated, a single detached side-call looks at your
   message plus recent context and, for each of the turn's drawn archetypes,
   writes the **opening prose of the reply** where that outcome happens
   (`TAG|PERCENT|prose`, one per line) — the player's action succeeding or
   failing, but also external developments like a character's reaction, an
   outside event, a discovery, or the plot turning. The prose only ever
   describes the world's response — what other characters and the environment
   do — never the player's own actions, words, or reactions.
3. The response is parsed, deduped to distinct archetypes, and the percentages
   are normalized to sum to 100.
4. A real random 1–100 is rolled **locally** (never by the model) and mapped
   against the cumulative ranges — higher-probability outcomes are more likely.
5. The winning outcome's prose — already written — is placed directly into
   SillyTavern's **"Start Reply With"** slot (`power_user.user_prompt_bias`). No
   conversion step: the outcome text *is* the opening. It becomes the literal,
   visible beginning of the reply, and the model continues from it. The slot is
   cleared afterwards (restoring any value you had set).
6. After the reply, an optional **outcome evaluation** asks the model a plain
   Yes/No: did the reply actually deliver the selected outcome? The verdict is
   logged to the console and the debug view for visibility.
7. **Swiping** that reply automatically regenerates the whole chain — fresh
   outcomes, fresh roll, fresh opening — before the swipe completes. Moving on
   to a new message clears the slot so nothing leaks into a later turn.

The chain is wired to the **`GENERATION_STARTED`** event, which SillyTavern
emits early in generation (before the "Start Reply With" value is read) and
awaits — so the roll and opening are in place before the main reply builds. A
plain send often has an `undefined` generation type, so anything that isn't a
known special type (swipe / regenerate / quiet / impersonate / continue) is
treated as a send. Because that fires before the sent message is committed to
chat, the action is read from the composer; feedback is a "rolling…" toast.

## Trigger model

| Action | Behavior |
| --- | --- |
| Send a message | **Auto-roll** before the reply (default; toggleable). |
| Swipe / regenerate the reply | **Automatic** fresh chain — new menu, roll, and prefill (toggleable). |
| 🎲 button / `/roll-outcome` | Manual roll — a pre-roll that the next send uses (still available; the primary path when auto-roll is off). |
| Auto-roll off, no manual roll | Zero effect — no side-calls, no injection. |

Turn a message from *"attempt"* into *"just narration"* by switching **Roll
automatically on every message you send** off in settings and rolling manually
only when you want an attempt adjudicated.

## Settings

- **Outcome count** (default 3–5) and **percentage floor/ceiling** (default
  5/70 — nothing is impossible or guaranteed).
- **Context** message count and token budget for the side-call.
- **Connection**: reuse the active chat connection, or pick a Connection
  Manager profile just for the side-calls.
- **Outcome prose temperature** — the outcomes are written as prose, so keep
  this near your main roleplay temperature.
- **Prompt to edit the action** before rolling (optional).
- **Automatic re-roll on swipe** (default on).
- **Evaluate outcome** (default on) — a Yes/No side-call after each reply that
  logs whether the outcome was actually delivered (visibility only).
- **Show roll result after the reply** (default off).
- **Debug view**: the last full menu, raw roll, selected outcome, the prefill,
  and the raw side-call response.

## Failure handling

Fail open, never fail closed. If the side-call errors or returns nothing, the
extension leaves the "Start Reply With" slot empty and lets the reply generate
normally rather than blocking your message. Raw responses are logged to the
console and the debug view.

## Install

Use SillyTavern's **Install Extension** with this repository URL, or clone into
`SillyTavern/public/scripts/extensions/third-party/`. No preset changes are
required — the outcome is delivered through the built-in "Start Reply With"
mechanism.

## Outcome archetypes

The side-call chooses from a pool of archetypes (defined in
`src/constants.js` as `ARCHETYPES`): the player-facing `WIN` / `COST` /
`LOSS`; their `WORLD_*` counterparts judged only from an NPC's or the world's
perspective (a world loss is *not* automatically a player win); and structural
beats — `TWIST`, `CONTINUE`, `ESCALATION`, `DE_ESCALATION`, `STALEMATE`,
`REVELATION`, `CLOCK`, `CONSEQUENCE`, `REVERSAL`, `INTERRUPTION`,
`COMPLICATION`.

Which archetypes appear each turn is chosen by a **shuffle-bag**, not the
model: the extension draws distinct archetypes from a bag that cycles through
the whole pool before repeating, so every archetype surfaces regularly (all 17
within ~4 turns at 5 outcomes each) instead of the model leaning on a few
favourites. The model then just writes a scene-appropriate outcome for each
drawn archetype, and may drop one that genuinely can't fit. The bag resets per
chat, and the debug view shows each turn's draw. A local d100 then picks the
winner, weighted by the model's percentages.

These tags are internal — the writer only ever sees the generated opening prose,
never the tag or the outcome text — so you can add, remove, or reword archetypes
freely without affecting the prose.

## Compatibility with Friction Lite

The extension has no dependency on Friction Lite (or any preset). It delivers the
outcome through SillyTavern's built-in "Start Reply With" slot, so no preset
changes are needed.

## Out of scope (v1)

No character stats or skill modifiers (flat probabilities only), no roll
animation, and no per-NPC outcome menus in group scenes.
