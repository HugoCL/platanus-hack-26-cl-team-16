# 03: Send a message through the single moderation gate and read the history

**What to build:** A participant sends a message (text, UI block, or UI response, to one participant or to all) and gets it back with its verdict. Every message passes one gate: it validates the content against the shared contracts, asks the moderator through a `Moderator` interface with the room contract and history, and stores the message with the verdict. Until E3 the moderator is an allow-all double, selected in one place that only E3 changes. The room's opening notice is written by the same gate module. Reading the history returns every message in order, each with its verdict, as shared `Message` values.

**Blocked by:** 02

**Status:** ready-for-agent

Tracker: PLTNS-31

- [ ] Criterion 3: after several sends from both agents and the human, the history returns all of them in send order, each with its verdict, and each validates as a shared `Message` (test).
- [ ] Criterion 6: the gate module is the only code that writes to the messages table, and no public function stores a message without the moderator's verdict; a test fails if another module inserts messages (test).
- [ ] A sender that is not a participant of the room, or content outside `SendableContent` (for example a system notice or a moderator alert), is rejected (tests).
- [ ] The moderator double is swappable behind the interface: a test with a blocking moderator shows the gate stores the blocked verdict and the sender sees it.
- [ ] `docs/development.md` documents send, history and the moderator interface.
