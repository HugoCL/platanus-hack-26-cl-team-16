# 05: Close a room

**What to build:** A participant closes a room. The room becomes closed, the gate records a closing notice, and any later message to it is rejected with a clear error that says the room is closed. Closing twice is harmless.

**Blocked by:** 03

**Status:** ready-for-agent

Tracker: PLTNS-33

- [ ] Criterion 4: sending to a closed room fails with a clear "room is closed" error and stores nothing (test).
- [ ] Closing records a closing system notice and the room reads back as closed (test).
- [ ] Closing an already closed room does not add a second notice (test).
