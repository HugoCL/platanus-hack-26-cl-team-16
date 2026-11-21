# Design system

One system for the landing, the directory and the rooms. The landing's phone book sets the look:
warm paper and ink, one loud yellow, small corners, mono labels. UI SDK primitives carry the
behavior; this repo only styles them.

## Where it lives

| File | What it holds |
| --- | --- |
| `src/styles/tokens.css` | Every color, radius and shadow, in OKLCH with `light-dark()`. The only place a raw color is allowed. |
| `src/styles/globals.css` | The Tailwind mapping (`bg-paper`, `bg-brand`, `text-brand-ink`, `text-headline-muted`, `shadow-float`), the type scale and the `eyebrow`, `press` and `press-blur` utilities. |
| `src/styles/ui.css` | UI SDK primitives styled by `data-slot`, the `brand` button and the shared `.site-footer`. |
| `src/styles/landing.css` | Landing-only layout. Its `--landing-*` colors alias the global tokens. |

`tests/design-tokens.test.ts` fails when a component uses a pixel font size, an `oklch()` or a hex
color. Add a token instead.

## Rules

- **Surfaces.** `bg-background` is paper, `bg-card` is the white sheet on it, `bg-muted` is a quiet
  fill. `bg-paper` (the yellow page) is for alternate landing sections, never behind dense UI.
- **Yellow.** `--brand-yellow` marks meaning, not decoration: the screen's one primary action
  (`data-variant="brand"`), what is selected (map pin, chosen slot), verified, and an accepted
  booking. Text on yellow is always ink (`text-brand-ink`); yellow text on paper is 1.5:1, so never.
- **Other actions.** `data-variant="solid"` (ink) for the rest of the primary actions in a list,
  the default outline button for secondary ones, `ghost` for icon buttons.
- **Corners.** 6px (`rounded-lg`) for chips, badges and tags; 8px (`rounded-2xl`) for buttons,
  inputs, menus and inner panels; 10px (`rounded-3xl`) for options; 12px (`rounded-4xl`) for cards,
  dialogs and message bubbles. `rounded-full` only for avatars, dots and counters.
- **Type.** Body is `text-sm` (14px). Around it: `text-micro` 11, `text-caption` 13, `text-lead` 15,
  `text-title` for page titles and `text-display` for landing-size headings. Section labels use
  `eyebrow` (mono caps under a 3px rule). Two-tone titles put the quiet half in
  `text-headline-muted`, which is large-text only (3.5:1).
- **System text.** Notices in a room read like the landing demo: mono caps, `text-micro`.
- **Focus.** `--ui-ring` is ink on paper and yellow on ink. Do not replace it with a softer color.
