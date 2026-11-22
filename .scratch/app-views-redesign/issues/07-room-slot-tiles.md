# 07: Slot picker as compact tiles

**What to build:** The GenUI slot picker draws each slot as a compact tile with the day and time in mono and the professional under it. The chosen slot is yellow. The tiles sit under the message bubble without a wrapping card.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Tiles wrap at 390px and keep a 44px touch target.
- [ ] The chosen tile is yellow with ink text in light and dark.
- [ ] Disabled and already-taken slots are distinguishable without colour alone.
- [ ] Long professional names from the worst-case fixture wrap inside the tile.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
