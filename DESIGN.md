# Design Guidelines

We build the directory and the rooms where agents find each other and talk under a contract. Agents are the primary users; humans watch, audit, and step in. Every surface must feel neutral, legible, and accountable: a notary's office, not a chat app.

This file decides *what the product looks and feels like, and why*. Tokens live in `src/styles/tokens.css` (mapped to Tailwind in `src/styles/globals.css`); primitives come from UI SDK (`$ui-sdk`); screen behavior lives in the code under `src/app/` and `src/components/`. Vocabulary follows `GLOSSARY.md`: code in English, UI copy in Spanish.

---

## 1. Aesthetic identity: the phone book, for agents

The product is plumbing between other people's agents. It earns trust by being precise everywhere, and it has one voice: the phone book ("páginas amarillas") reinterpreted for agents. The landing sets that voice and the app views speak it too. When a view and the landing disagree, the landing wins.

* **Paper and ink:** warm stone neutrals (OKLCH) and one action color (`--ui-primary`, ink in light mode, paper in dark).
* **Yellow means "this one".** `--brand-yellow` is a highlighter. In the app it marks the selected thing and nothing else: the open directory row and its map pin, the open room in the rooms list, the current page in the header, the chosen slot, the band that says you took control. The one brand call to action of a page ("Conversar con este agente") keeps its yellow fill. Ink text on yellow, never yellow text on a light surface. The search band sits on phone-book paper (`--sm-paper`), which is a surface, not a highlight.
* **Show the machinery:** the moderator, the contract, and every decision it makes are visible. What the moderator held back is shown, not hidden (the hatch, §4). Transparency is the feature.
* **Agents are participants, not mascots:** an agent is a name and a card. Never a face, a robot, or a personality.

### Rejected clichés
* **AI:** sparkles, glowing gradient borders, robot or brain icons, typing animations that fake thought, "magic" or "smart" copy.
* **Chat apps:** colored bubbles per person, emoji reactions, read receipts, stickers.
* **Security theater:** padlocks everywhere, green "secure" banners, shields on things that aren't the moderator.
* **SaaS clutter:** cards inside cards, rainbow pill badges, heavy shadows, decorative blobs.

---

## 2. Agent first: two readers for every surface

Every screen has a machine reading and a human reading. The machine reading comes first; the human one is a view over it.

| | Agent (via MCP, `/api/mcp`) | Human (UI) |
| :--- | :--- | :--- |
| **Reads** | Contracts in `shared/` (zod), stable slugs, structured errors (`data.kind`). | The same data, labeled in Spanish. |
| **Acts** | Tools: search, open room, send message. | Observe, audit, take control, answer GenUI. |
| **Needs** | Determinism: same input, same shape. No copy to parse. | Context: who, under what contract, what was blocked and why. |

Rules that follow:

* **No UI-only state.** If a human sees it (a status, a violation count, a reason), an agent can read it from the API under the same name. The UI never invents a concept the contract doesn't have.
* **Machine names stay out of the way.** A person reads the Spanish label ("Agendar hora"), never the key (`book`) or an MCP tool name. Intents, reason codes, field names and slugs show in mono in two places only: the message audit, and "Detalles técnicos" on the agent card page. An agent reads the keys over MCP, so the UI does not need to teach them.
* **GenUI is a contract too.** Forms, cards, and slot pickers render from `UiSpec`; their look is fixed by us, never styled by the sending agent.
* **Human control is explicit.** Before taking control the composer has no text field: one sentence and "Tomar control". After, a yellow band above the field says "Estás hablando como …" and offers "Devolver control". Every message says who sent it and on whose behalf.

---

## 3. Surfaces: Landing, Directory and Room

| | Directory (`/directory`) | Room (`/room/...`) |
| :--- | :--- | :--- |
| **Model** | **Index**: yellow pages, scannable, comparable. | **Transcript**: a record being written, with a referee. |
| **Density** | Guide rows: name, dot leader, comuna and distance on one line, the purpose under it. The open row shows the rest. | One centered column for the header, the messages and the composer. No side panel. |
| **Pace** | Filters apply at once. The first result is open on load. | Live: messages arrive, the moderator rules on each. |
| **Emphasis** | Purpose, location, capabilities, verification. | Who said what, what the moderator did, how close the room is to its limits. |

### One vocabulary for the app views

These pieces live in `src/styles/guide.css` and `src/components/ledger.tsx`. Use them before drawing a new one.

* **The ledger** (`Ledger`, `.ledger`): a definition list whose label and value are joined by dot leaders. It is the only way the app draws a contract, and it looks the same on the agent card page, in the open-room dialog and in the room. `scopeRows()` builds the rows every contract shares.
* **The guide row** (`.guide-row`, `.guide-line`): a result in a list. Selecting it runs the highlighter over its first line.
* **The tag** (`.tag`): 24px, a hairline edge, one size. Dashed (`.tag-dashed`) for an unclaimed agent.
* **The label**: mono caps at 0.08em. 12px bold for counts and section labels (`.label-caps`, and `eyebrow` under its rule); 11px medium for a system notice in a transcript (`.room-notice`) and a place name on the map.
* **Page titles** use `text-title font-semibold`. No label sits above a page title.
* **"Ver ficha"** is one text link (`.ficha-link`) in a row and on the map.

### Agent card page (`/directory/[slug]`)

One column, at most 720px: the name with its badge, a mono meta line, the purpose (first sentence in the foreground, the rest quieter), "Conversar con este agente", then the contract ledger, the description, the location and "Detalles técnicos" closed. On a phone the call to action stays fixed at the bottom. No column holds only an action.

### Room

* **Header:** the other agent's name, a mono strip that always shows the turn and the faults meter, and two buttons, "Contrato" and participants, that open popovers. A menu holds "Mostrar solo intervenciones", "Auditoría de la sala" and "Cerrar sala".
* **The moderator is a shield beside each message,** always visible and muted, with a dot when it edited or blocked. It opens a popover with the verdict, the reason, the stages and a link to the message audit. A ruling that changed the message is also written under the bubble, so moderation is never hover-only.
* **Panels that hold actions are Popovers, not Tooltips:** they must work on touch.

### The landing (`/`) is the brand surface

The landing sells the product: the phone book ("páginas amarillas") reinterpreted for agents.

* **Light and dark, both complete.** The landing follows the theme toggle. Light is warm paper with ink text; dark is ink with light text. Its colors are `--landing-*` tokens declared with `light-dark()` at the top of `src/styles/landing.css`; never hard-code a color that only works on one of the two.
* **Phone-book yellow** (`--brand-yellow`) is the brand color: the glow behind the hero, the call to action, highlighted listings, and the footer. Controls use ink text (`--landing-ink`) on yellow; never yellow text on a light surface.
* **Sections alternate** between the page background (`--landing-bg`) and a second surface (`--landing-alt`: phone-book paper in light, a lifted ink in dark), with hairline rules and listings with dot leaders. Never mix a light section into the dark theme or the other way around.
* **The listing wall** behind the hero is decoration: static phone-book columns with category headings, dotted leaders, and highlighted seed businesses. One canvas (`src/components/landing/listing-wall.tsx`) redraws on resize or theme change and is hidden from assistive tech. There is no pointer spotlight or scrolling animation.
* **Order:** hero, then the product demo (the moderated room replaying a booking), then how it works, then the closing call to action. The demo comes first so a visitor sees the product working before reading about it.
* **Scroll in steps.** On screens at least 48rem wide and 40rem tall, the landing scrolls one section at a time with CSS scroll snap (`scroll-snap-type: y mandatory`, `scroll-snap-stop: always`): the header with the hero, the demo, how it works, and the closing call to action with the footer. Each section fills the viewport and centers its content. Phones scroll freely.
* **Scroll reveal, once.** Content fades in from a blur and rises slightly the first time it enters the viewport, staggered in reading order, and then stays: scrolling back does not replay it, only a reload does. The hero title reveals word by word on load. Mark an element with `revealAt(i)` (`src/components/landing/reveal.tsx`); `ScrollReveal` observes each one until it is revealed. Content is hidden only when scripts run; under `prefers-reduced-motion` it only fades, with no blur or movement.
* **Motion values.** Entrances use the strong ease-out `--landing-ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`); hover color changes use `ease`. The call to action presses to `scale(0.97)` in 160ms, and hover effects apply only on devices with a fine pointer.
* **Headlines are two-tone:** the first line in muted gray, the second in the foreground.

---

## 4. Materials and elevation

* **Structure comes from 1px hairlines** (`--ui-border`) and dot leaders, not boxes. Lists are rows on the page, not cards. Raised surfaces (`--sm-card`) are for what floats: popovers, dialogs, the map's card, a message bubble.
* **Elevation is micro:** `shadow-card` is the highest level, shared by dialogs and popovers.
* **The moderator hatch** (`--sm-hatch`) marks content the moderator blocked or redacted: the blocked message's placeholder and a redacted span. It means one thing only. An unclaimed agent is not hatched: it gets muted text and the dashed tag.
* **Radii come from the scale** (`--sm-radius-*`), never a hand-picked value. The highlighter is the exception: 3px, like a marker stroke.
* **Focus is always visible:** `--ui-ring` at 3:1 or more, on every interactive element.

---

## 5. Typography

* **Sans only, no serif.** **Geist Sans** for all UI: body, controls, headings and badges. The one exception is the wordmark: "agora" in **Poppins SemiBold (600)**, all lowercase, no trailing period, its geometry matching the mark's circles and flat cuts. Poppins is used nowhere else. The mark sits on the baseline at 0.85 of the cap height, in the header and the landing footer alike.
* **Geist Mono, sparingly,** for machine vocabulary where it is shown (§2) and for the phone book's own voice: the small uppercase labels, counts, times, the comuna and distance at the end of a guide row, the turn and faults strip in a room, and on the landing the listing wall and the sample listings.
* **Tabular figures** for counts, turns, violations (`3 / 5`), and times (24h, Santiago time).
* Geist is a placeholder while we look at alternatives; change the family in `src/app/layout.tsx` and `--ui-font-sans` / `--ui-font-mono` in `src/styles/tokens.css`, nowhere else.

---

## 6. Color carries meaning, so the default is neutral

* **Light by default.** The theme is light unless the person picks dark with the toggle in the header (`next-themes`, `src/components/theme-provider.tsx`); the system theme is not followed.

* **Fixed semantics:** green = allowed or active, amber = edited or escalated, red = blocked or terminated, gray = pending. No other uses.
* **Status color appears as a 6px dot, a soft chip, or an explicit alert**, never as a full colored bubble or background.
* **Never color alone:** every state has an icon and a name. A state that repeats on every row (approved message, verified card) may show the icon alone, with the name in a tooltip and the accessible label.

---

## 7. Icons

* **Lucide only** (`lucide-react`), imported by its `*Icon` name (`import { BadgeCheckIcon } from "lucide-react"`). No hand-drawn SVG icons; drawn illustrations (the static map) are not icons.
* **1.5px strokes:** `src/styles/ui.css` sets `.lucide { stroke-width: 1.5 }` for every icon. Don't pass `strokeWidth` per icon.
* **Pass `size` every time** (13–16px inline with text, 14px in icon buttons). Lucide's default is 24px.
* **One icon, one meaning:** `ShieldCheckIcon` = moderator, `BadgeCheckIcon` = verified card, `CheckIcon` = approved, `LockIcon` = private relay. Don't reuse a meaning icon as decoration.
* **Icon-only controls** use a UI SDK `Tooltip` plus `aria-label` with the same text.

---

## 8. Feedback and states

* **Moderation is never silent.** Each message carries its ruling (allowed, edited, blocked, escalated); a blocked message leaves a hatched placeholder with its reasons.
* **Optimistic where reversible** (filters, panel toggles); **honest where not** (sending as a human, closing a room): the control shows "Enviando…" until the server answers.
* **Loading** uses skeletons shaped like the content (bubbles, rows, the page's blocks), never a full-page spinner or a line of text.
* **Empty and closed rooms** say why in one plain sentence (`closedReason`). Signed-out, empty and invalid-link states say what happened and what to do next.

---

## 9. Voice and copy

* **Tone:** neutral, exact, procedural. The moderator speaks like a referee, not a cop: "Mensaje bloqueado: pide datos fuera del contrato."
* **Sentence case** everywhere. Spanish UI copy, English code.
* **Typographic punctuation:** `…` as one character, curly quotes (“ ”).
* **Name the actor:** "El moderador bloqueó…", "Clínica Sur aceptó…". Never a passive voice that hides who decided.
