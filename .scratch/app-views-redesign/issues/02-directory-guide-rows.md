# 02: Directory results as guide rows

**What to build:** The directory lists agents as rows: icon, name, verified badge, dot leader, comuna and distance on one line, the purpose under it. Selecting a row highlights it in yellow, opens it and shows the full purpose, the intents, the agent kind, Conversar and Ver ficha. The matching map pin turns yellow. The first result is open on load. Search and filters take two rows instead of four. The current page in the header is marked with the same highlighter. See `prototypes/directory-desktop.webp`.

**Blocked by:** 01 (tag, label and title scale)

**Status:** done (PR pending review)

**Notes:** Eight rows fit at 1440×900 once the location invite moved over the map. "Solo verificados" and "Incluir sin reclamar" stay switches, not the mockup's checkboxes.

- [ ] At 1440×900 at least eight results are visible without scrolling.
- [ ] Row and map pin selection stay in sync in both directions, as today.
- [ ] A long name truncates on one line and keeps its comuna and distance visible.
- [ ] Unclaimed agents are muted, carry the dashed tag and offer Ver ficha only.
- [ ] Category, comuna, "Qué puede hacer" and "Cerca de mí" sit on one row; active filters can still be removed one by one and all at once.
- [ ] "Ver ficha" has one size in the row and in the map card.
- [ ] On phones the rows fill the width and "Ver mapa" still switches views.
- [ ] `data-testid="agent-card"` and `data-testid="directory"` stay on the rows and their list; the smoke test passes unchanged or is updated here.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
