# 04: Room header with contract and participants panels

**What to build:** The room has no right panel. The header shows the provider's name, the turn ("turno 5 de 12") and a three-segment faults meter from the first message on. A "Contrato" button opens the contract ledger, a participants button opens the list and "Invitar a un observador", and a menu holds "Mostrar solo intervenciones", "Auditoría de la sala" and "Cerrar sala". Header, thread and composer share one centred column. The opening notice names the intent in Spanish. See `prototypes/room-desktop.webp` and `prototypes/room-mobile.webp`.

**Blocked by:** 01 (contract ledger)

**Status:** ready-for-agent

- [ ] The faults meter is always visible in the header and replaces the notice that appeared above the thread after the first block.
- [ ] The room totals (messages reviewed, interventions, mean latency, model) are in the "Auditoría de la sala" dialog.
- [ ] The system notice reads "contrato: agendar hora", not the intent code.
- [ ] The panels are Popovers: they open on click and keyboard, close on Escape, and fit the screen at 390px.
- [ ] "Cerrar sala" shows "Cerrando…" until the server answers.
- [ ] The worst-case fixture (long provider name, long observer name, terminated room) renders without overflow.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
