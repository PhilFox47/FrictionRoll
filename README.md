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
preference — becomes what the reply is written around.

It's a standalone companion to the **Friction Lite** preset (it reuses the same
`WIN` / `COST` / `SETBACK` vocabulary), but works with any preset and is
completely inert until you trigger it.

## How it works

By default (Auto-roll on send), every message you send is adjudicated
automatically before the reply is written:

1. You send a message — nothing extra to click.
2. Before the main reply is generated, a detached side-call looks at your
   message plus recent context and produces a small weighted menu of
   *substantively different* ways the next beat could go (`TAG|PERCENT|text`,
   one per line) — the player's action succeeding or failing, but also external
   developments like a character's reaction, an outside event, a discovery, or
   the plot turning. Outcomes only ever describe the world's response — what
   other characters and the environment do — never the player's own actions,
   words, or reactions. Those are always the player's to decide.
3. The response is parsed strictly, validated for type diversity, and the
   percentages are normalized to sum to 100.
4. A real random 1–100 is rolled **locally** (never by the model) and mapped
   against the menu's cumulative ranges — higher-probability outcomes are more
   likely to be selected.
5. The selected outcome becomes the value of a SillyTavern macro,
   `{{frictionroll}}`, which the preset embeds inside its own final-instruction
   block — so the directive resolves *inside* that block's text and nothing
   (World Info, other depth-0 entries) can be inserted between the rules and it.
6. **Then** the main reply is generated, written around the directive. The
   directive never appears in chat.
7. After the reply, an optional **outcome evaluation** asks the model a plain
   Yes/No: did the reply actually deliver the selected outcome? The verdict is
   logged to the console and the debug view for visibility.
8. **Swiping** that reply automatically re-rolls the dice against the *same*
   menu before the swipe completes — no new side-call, just a fresh roll and
   selection, so the beat's outcome space stays consistent. Moving on to a new
   message clears the directive so it can't leak into a later, unrelated turn.

The roll is wired as a SillyTavern **generate interceptor** (declared in
`manifest.json`), which SillyTavern awaits *before* building the main prompt —
so the whole pipeline completes and the outcome is injected before the reply is
generated. This is the same reliable hook other pre-generation extensions use;
a plain send does not emit a usable `'normal'` event type.

## Trigger model

| Action | Behavior |
| --- | --- |
| Send a message | **Auto-roll** before the reply (default; toggleable). |
| Swipe / regenerate the reply | **Automatic** dice re-roll against the same menu, no new side-call (toggleable). |
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
- **Evaluate outcome** (default on) — a Yes/No side-call after each reply that
  logs whether the outcome was actually delivered (visibility only).
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

## Preset setup — the `{{frictionroll}}` macro

The directive is delivered through a macro, not a positional injection, so the
preset must place `{{frictionroll}}` where the directive should appear —
ideally at the very end of its final-instruction block. Friction Lite v6
already bakes this placeholder into that block. With any other preset, add
`{{frictionroll}}` yourself; without it, rolls still happen but the model never
sees the outcome. The macro resolves to an empty string whenever no roll is
active, so it's harmless when idle.

## Compatibility with Friction Lite

The `WIN` / `COST` / `SETBACK` tags intentionally mirror Friction Lite's
fail-forward rule. The two aren't automatically linked — if that rule's wording
changes, update the tag vocabulary in `src/constants.js` to match. The
extension has no dependency on Friction Lite (or any preset) and is inert
without one (aside from needing the `{{frictionroll}}` placeholder above to
actually reach the model).

## Out of scope (v1)

No character stats or skill modifiers (flat probabilities only), no roll
animation, and no per-NPC outcome menus in group scenes.
