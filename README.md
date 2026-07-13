# Outcome Roll

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that
externalizes *"how does the scene continue next"* from the writing model's own
judgment, using a weighted, dice-resolved outcome menu instead.

Most RP-tuned models default toward whatever direction feels most narratively
satisfying — usually the player succeeding and things going their way. Outcome
Roll moves the decision **outside** the writing model: as the reply is being
assembled, a detached side-call proposes a few plausible ways the next beat could
go — the player's action landing or not, but also how other characters react,
outside events, discoveries, or the plot turning — each with a probability. A
genuine local random roll picks one, a second call writes that development into a
short opening paragraph, and that paragraph is injected as the reply's seeded
opening — so the model continues *from* it rather than around it.

It works with **any preset** and needs no preset changes — it manipulates the
outgoing reply prompt directly rather than relying on any built-in slot or macro.
It's completely inert until you trigger it.

## How it works

By default (Auto-roll on send), every message you send is adjudicated
automatically as the reply is assembled:

1. You send a message — nothing extra to click. **Your message appears
   instantly** (the roll does not block the send — see the timing note below).
2. While the reply's prompt is being built, a detached side-call produces a
   small weighted menu of *terse outcome bullets* (`TAG|PERCENT|bullet`) for the
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
6. The paragraph is delivered by manipulating the outgoing reply prompt directly:
   - it is **injected as the reply's seeded opening** — an assistant prefix for
     chat completion (the same mechanism as "Start Reply With", but set on the
     outgoing request so it can't be missed), or appended text for text
     completion — so the model continues *from* it and has no way out;
   - because the model's continuation comes back without that seed, the paragraph
     is then **prepended to the finished reply** and the message re-rendered, so
     the opening is visible.
7. After the reply, an optional **outcome evaluation** asks the model a plain
   Yes/No: did the reply actually deliver the outcome? The verdict is logged to
   the console and the debug view.
8. **Swiping** that reply automatically regenerates the whole chain. Moving on to
   a new message clears everything.

**Timing.** The chain is split across the generation lifecycle so the send is
never delayed. `GENERATION_STARTED` (which fires before your message is rendered)
only *arms* the turn — no rolling there. The roll and injection happen at the
**prompt-ready** event (`CHAT_COMPLETION_PROMPT_READY` for chat completion,
`GENERATE_AFTER_COMBINE_PROMPTS` for text completion), which fires while the
reply prompt is assembled — *after* your message is already on screen. So the
only thing the roll delays is the reply itself, which you're waiting on anyway.
A plain send often has an `undefined` generation type, so anything that isn't a
known special type (swipe / regenerate / quiet / impersonate / continue) is
treated as a send.

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
extension injects nothing and lets the reply generate normally rather than
blocking it. Raw responses are logged to the console and the debug view.

## Install

Use SillyTavern's **Install Extension** with this repository URL, or clone into
`SillyTavern/public/scripts/extensions/third-party/`. It works out of the box
with any preset — no preset edits, no built-in slot or macro required.

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
paragraph, never the tag or the bullet itself — so you can add, remove, or
reword archetypes freely.

## Preset compatibility

The injected opening works with any preset and no changes. A legacy
`{{frictionroll}}` macro is still registered but now resolves to an empty string
(the opening paragraph carries the outcome), so presets that still reference it
— e.g. the old Friction Lite "DIRECTIVE FOR YOUR NEXT MESSAGE" block — won't
leak a literal token; that block can simply be removed.

## Out of scope (v1)

No character stats or skill modifiers (flat probabilities only), no roll
animation, and no per-NPC outcome menus in group scenes.
