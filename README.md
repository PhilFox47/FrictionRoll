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

It's a standalone companion to the **Friction Lite** preset and completely inert
until you trigger it. The forced opening (prefill) works with any preset and
needs no changes; the optional `{{frictionroll}}` directive that steers the rest
of the reply just needs the preset to embed `{{frictionroll}}` (Friction Lite
already does, in its directive block).

## How it works

By default (Auto-roll on send), every message you send is adjudicated
automatically before the reply is written:

1. You send a message — nothing extra to click.
2. Before the main reply is generated, a detached side-call produces a small
   weighted menu of *terse outcome bullets* (`TAG|PERCENT|bullet`) for the
   turn's drawn archetypes — the player's action succeeding or failing, but also
   external developments like a character's reaction, an outside event, a
   discovery, or the plot turning. Bullets only ever describe the world's
   response — never the player's own actions, words, or reactions.
3. The bullets are parsed, deduped to distinct archetypes, and the percentages
   are normalized to sum to 100.
4. A real random 1–100 is rolled **locally** (never by the model) and mapped
   against the cumulative ranges — higher-probability outcomes are more likely.
5. A **second creative call** turns the winning bullet into the **opening
   paragraph** of the reply, where the outcome is unmistakably happening.
6. The outcome is delivered two ways:
   - the opening paragraph is written into SillyTavern's **"Start Reply With"**
     slot (`power_user.user_prompt_bias`) — the literal, forced start of the
     reply, so the model has no way out but to continue from it;
   - the winning bullet becomes the **`{{frictionroll}}`** macro, which your
     preset injects as a directive to steer the *rest* of the reply toward the
     outcome. Both are cleared after the turn (restoring any static "Start Reply
     With" you had set).
7. After the reply, an optional **outcome evaluation** asks the model a plain
   Yes/No: did the reply actually deliver the outcome? The verdict is logged to
   the console and the debug view.
8. **Swiping** that reply automatically regenerates the whole chain before the
   swipe completes. Moving on to a new message clears everything.

The chain is wired to the **`GENERATION_STARTED`** event, which SillyTavern
emits early in generation (before the "Start Reply With" value is read) and
awaits — so the roll, prefill, and directive are in place before the main reply
builds. A plain send often has an `undefined` generation type, so anything that
isn't a known special type (swipe / regenerate / quiet / impersonate /
continue) is treated as a send. Because that fires before the sent message is
committed to chat, the action is read from the composer, and feedback is a
"rolling…" toast — the sent message and Stop icon appear once the roll
completes.

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
- **Outcome-menu temperature** — the menu is terse bullets, so a lower value.
- **Opening-prose temperature** — the winning outcome's opening paragraph; keep
  near your main roleplay temperature.
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
`SillyTavern/public/scripts/extensions/third-party/`. The forced opening works
out of the box (built-in "Start Reply With"); to also steer the rest of the
reply, embed `{{frictionroll}}` in your preset's instructions.

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

These tags are internal — the main model only ever sees the generated opening
prose and the winning bullet (as the directive), never the tag itself — so you
can add, remove, or reword archetypes freely.

## Compatibility with Friction Lite

The prefilled opening works with any preset and no changes. For the extra
`{{frictionroll}}` directive steering, the preset must inject `{{frictionroll}}`
somewhere in its instructions — Friction Lite already does, inside its
"DIRECTIVE FOR YOUR NEXT MESSAGE" block.

## Out of scope (v1)

No character stats or skill modifiers (flat probabilities only), no roll
animation, and no per-NPC outcome menus in group scenes.
