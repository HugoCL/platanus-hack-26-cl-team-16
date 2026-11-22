# 08: Rooms list and link page share the app's vocabulary

**What to build:** "Tus salas" (`/room`) lists rooms as guide rows: provider, intent, status with its colour dot, and time. The link page (`/link/[code]`) uses the same page title as the rest and shows the agent as a guide row with its contract ledger. Signed-out, empty, loading and invalid-link states each say what happened and what to do next.

**Blocked by:** 02 (guide row) and 04 (rooms list in the room's left panel)

**Status:** ready-for-agent

- [ ] No label sits above a page title on either page.
- [ ] Signed out, `/room` says why the list is empty and offers "Iniciar sesión" and the demo room.
- [ ] An invalid or expired link says so in one sentence and how to get a new one. The word "Link" is replaced by "enlace".
- [ ] Loading states are skeletons shaped like the rows.
- [ ] Both pages were checked signed in with the team's Clerk keys, or the PR says they were not.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
