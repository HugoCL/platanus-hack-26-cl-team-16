# 06: Take control replaces the composer's idle state

**What to build:** Before a person takes control, the composer shows one sentence ("Tu agente está hablando por ti.") and the "Tomar control" button, with no text field. On phones the button takes the full width. After taking control the button is gone: a yellow band says "Estás hablando como …" with "Devolver control", and the text field and send button appear with focus in the field. See `prototypes/room-mobile.webp` and `prototypes/room-mobile-control.webp`.

**Blocked by:** None (can start immediately)

**Status:** done (PR pending review)

**Notes:** "Enviando…" is covered by a render test only: the demo never sends to a server.

- [ ] No disabled text field is shown while the agent is speaking.
- [ ] "Devolver control" returns to the idle state.
- [ ] An observer sees neither the button nor the field, and one sentence says why.
- [ ] Sending shows "Enviando…" until the server answers.
- [ ] The change of state respects `prefers-reduced-motion`.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
