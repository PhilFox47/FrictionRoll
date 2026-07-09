# Outcome Roll

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that
externalizes *"did this attempt actually work"* from the writing model's own
judgment, using a weighted, dice-resolved outcome menu instead.

Most RP-tuned models default toward whatever outcome feels most narratively
satisfying — usually success. Outcome Roll moves the decision **outside** the
writing model: before the scene is written, a detached side-call generates a
few possible outcomes with probabilities, a genuine local random roll picks
one, and that outcome — not the model's preference — becomes what the model has
to write around.

It's a standalone companion to the **Friction Lite** preset (it reuses the same
`WIN` / `COST` / `SETBACK` vocabulary), but works with any preset and is
completely inert until you trigger it.

## How it works

By default (Auto-roll on send), every message you send is adjudicated
automatically before the reply is written:

1. You send a message describing an uncertain attempt — nothing extra to click.
2. Before the main reply is generated, a detached side-call looks at your
   message plus recent context and produces a small weighted menu of
   *substantively different* outcomes (`TAG|PERCENT|text`, one per line).
3. The response is parsed strictly, validated for type diversity, and the
   percentages are normalized to sum to 100.
4. A real random 1–100 is rolled **locally** (never by the model) and mapped
   against the menu's cumulative ranges — higher-probability outcomes are more
   likely to be selected.
5. The selected outcome is injected as a hidden GM directive positioned at the
   end of context, where model attention is most reliable.
6. **Then** the main reply is generated, written around the directive. The
   directive never appears in chat.
7. **Swiping** that reply automatically runs a fresh menu + roll before the
   swipe completes. Moving on to a new message clears the directive so it can't
   leak into a later, unrelated turn.

Because SillyTavern's event emitter awaits async listeners, the roll hooks
`GENERATION_STARTED` and completes *before* the generation builds its prompt.

## Trigger model

| Action | Behavior |
| --- | --- |
| Send a message | **Auto-roll** before the reply (default; toggleable). |
| Swipe / regenerate the reply | **Automatic** fresh menu + roll (toggleable). |
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
  Manager profile just for the side-call.
- **Side-call temperature** — keep it low; this is structured output, not prose.
- **Prompt to edit the action** before rolling (optional).
- **Automatic re-roll on swipe** (default on).
- **Show roll result after the reply** (default off — showing it *before*
  defeats the purpose; *after* is fine as flavor).
- **Debug view**: the last full menu, raw roll, selected outcome, and raw
  side-call response, for tuning wording without cluttering chat.

## Failure handling

Fail open, never fail closed. If the side-call errors, or parsing fails twice,
or a required tag never appears, the extension shows a small notice and injects
nothing rather than blocking your message. Raw responses are logged to the
console and the debug view.

## Install

Use SillyTavern's **Install Extension** with this repository URL, or clone into
`SillyTavern/public/scripts/extensions/third-party/`.

## Compatibility with Friction Lite

The `WIN` / `COST` / `SETBACK` tags intentionally mirror Friction Lite's
fail-forward rule. The two aren't automatically linked — if that rule's wording
changes, update the tag vocabulary in `src/constants.js` to match. The
extension has no dependency on Friction Lite (or any preset) and is inert
without one.

## Out of scope (v1)

No character stats or skill modifiers (flat probabilities only), no roll
animation, and no per-NPC outcome menus in group scenes.
