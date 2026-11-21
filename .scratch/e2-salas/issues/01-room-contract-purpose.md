# 01: Room contract carries the provider's purpose, plus a turn-limit notice

**What to build:** The shared contracts can express everything E2 must store. The epic says the purpose contract is "the request plus the provider's purpose and scope", but `SessionContract` today has the request (`intent`) and the scope (allowed intents, forbidden topics, data shared and requested) and not the card's `purpose`. Add the provider's purpose to the contract, and add a system notice code that records the turn limit being reached. This is a contract-only change in `shared/`, shipped as its own small PR to `main` before any epic branch, with the seed demo room, the contract examples and the architecture doc updated to match.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Tracker: PLTNS-29

- [ ] `SessionContract` requires the provider's purpose (non-empty, same bounds as the card's purpose); a contract without it is an invalid example.
- [ ] The system notice kinds include one for the turn limit, with a valid example.
- [ ] The seed demo room's contract carries the clinic's purpose, and `seed:ensure` still loads.
- [ ] `pnpm lint`, `typecheck`, `build`, `test` and `smoke` pass.
