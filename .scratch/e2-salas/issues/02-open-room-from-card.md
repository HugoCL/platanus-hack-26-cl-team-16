# 02: Open a room from a card and a request

**What to build:** A consumer agent opens a room by naming itself, the provider's card and its free-text request, optionally with the human who follows it and a turn limit. It gets back an open room with its participants (initiator agent, recipient agent, and the human owner acting for the initiator when given) and an immutable contract built from the request plus the card's purpose and scope, with the turn limit (12 unless set). Reading the room by id returns it as a valid shared `Session` with its participants. Opening fails with a clear error when the card is missing, a draft or invalid, when the initiator is the provider itself, or when the requested intent is outside what the card allows.

**Blocked by:** 01

**Status:** ready-for-agent

Tracker: PLTNS-30

- [ ] Criterion 1: opening a room from the seed clinic card returns an open room whose contract contains the request, the clinic's purpose, its allowed intents, its forbidden topics and its data rules (test).
- [ ] The room read validates against the shared `Session` contract, and the turn limit defaults to 12 and can be set at creation (test).
- [ ] Each rejection above returns a clear error (tests).
- [ ] `docs/development.md` documents the new functions.
