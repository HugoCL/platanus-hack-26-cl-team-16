# App views redesign: the landing's vocabulary in the app

Source: design review of 2026-11-21 with Hugo. He approved the direction and the three mockups in priori (canvas `ss7231mavmmycdtra6eynh3m098jpnhb`, revision 4). Captures of the approved mockups are in `prototypes/`. The mockups were throwaway HTML and are not in the repo.

## Goal

The directory, the agent card page, the rooms and the smaller pages look and behave like one product with the landing. Today they share its tokens and almost none of its vocabulary, and the same piece is drawn several ways.

## What the review found

- The landing's room replay shows a room the product does not have: a faults meter in the header, the intent in Spanish, slot tiles in mono. The real room shows `CONTRATO: BOOK`, shows faults only after the first block, and draws slots as grey boxes in a card.
- The contract is drawn three ways: cards with 28px chips on the agent card page, 26px chips in the open-room dialog, a paragraph with icons in the room panel. The landing draws it as rows with dot leaders.
- On the directory at 1440×900 the filters take 300px before the first result and two cards fit. Each card has two buttons of equal weight.
- There are six `h1` recipes (18px to 36px) and six recipes for the small uppercase label, with four tracking values. "Ver ficha" is 36px in the list and 32px in the map card.
- Loading, signed-out, empty and invalid-link states are plain text. `DESIGN.md` §8 asks for content-shaped skeletons and one sentence with the reason.
- `DESIGN.md` no longer describes the code. §1 keeps yellow on the landing only, and yellow is already on Buscar, the verified badge, the slot picker and the agent card page's call to action. §4 reserves the hatch for the moderator, and unclaimed cards use it while the blocked message does not.

## Decisions

Hugo made these. Do not reopen them.

1. **The landing is the visual authority.** `DESIGN.md` §1 to §4 get rewritten after the build to say so. Colour semantics (§6), the rejected clichés, Lucide icons and Geist stay.
2. **Yellow highlighter means selection, and only selection:** the selected directory row and its map pin, the open room in the rooms list, the current page in the header, the chosen slot. The one brand call to action per page keeps its yellow fill.
3. **One contract ledger.** A definition list with dot leaders, one component, used on the agent card page, in the open-room dialog and in the room.
4. **No machine names in UI for people.** Intent codes and MCP tool names (`check_availability`, `book`) do not appear on the agent card page, the directory or the room contract. They stay in the message audit and in "Detalles técnicos". This changes `DESIGN.md` §2 ("Codes stay visible").
5. **Directory results are guide rows, not cards.** Name, dot leader, comuna and distance on one line, purpose under it. The selected row opens and shows purpose, intents, agent kind, Conversar and Ver ficha. The first result is open on load.
6. **The agent card page is one column.** Conversar sits under the purpose. No column that holds only the call to action, and no note that conversations are moderated.
7. **The moderator is a shield beside each message.** Always visible, muted. Hover, focus or tap opens a panel with the verdict, the reason, the stages and a link to the message audit. A ruling that changed the message (edited, blocked) is also written under the bubble, so moderation is never hover-only. No moderator column.
8. **The room has no right panel.** Contract and participants open from header buttons. A menu holds "Mostrar solo intervenciones", "Auditoría de la sala" and "Cerrar sala". The header always shows the turn and the faults meter.
9. **Tomar control replaces the input, it does not sit beside it.** Before taking control there is no text field: one sentence and the button, full width on phones. After, the field appears with a band that says who you are speaking as and offers "Devolver control".
10. **Unclaimed agents drop the hatch.** Muted text and a dashed tag. The blocked message gets the hatch.

## Do not build now

- "Reportar comportamiento sospechoso" in the moderator panel. It needs a table, a mutation and a rate limit. Separate ticket.
- Removing `/server`. It is the Convex template and `docs/deploy.md` uses it to verify the sign-in redirect.
- Changing the typeface.

## Constraints

- UI SDK primitives for every control. The moderator panel and the header panels are Popovers, not Tooltips: they hold actions and must work on touch.
- Every view keeps what it does today unless a decision above removes it: map and list selection in sync, the verified badge, unclaimed agents, long names, the worst-case fixtures, the message audit dialog with reasons and scores, the unread pill, the demo controls.
- Light and dark, 1440px and 390px, checked in a real browser with the worst-case fixtures.
- The smoke test keeps passing: `data-testid="agent-card"` and `data-testid="directory"` stay on the result rows and their list. Update `scripts/smoke.py` in the same PR if the landing's `h1` or those hooks change.

## Success criteria

1. A selected thing is yellow in every view, and nothing else in the app views is.
2. The contract looks the same on the agent card page, in the open-room dialog and in the room.
3. At 1440×900 the directory shows at least eight results without scrolling.
4. A person can read why the moderator edited or blocked a message without hovering.
5. Each page type has one `h1` recipe, and there is one uppercase label, one tag and one "Ver ficha" size.
6. `pnpm lint`, `typecheck`, `test` and `smoke` pass on every ticket.
