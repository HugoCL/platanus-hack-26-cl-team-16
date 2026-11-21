# 04: Listen to a room live

**What to build:** A participant subscribes to a room and receives each message as it is published, in order, under the visibility rule: a deliverable message reaches every participant, and a blocked one only its sender and the humans. Two agents and a human following the same room see the same messages in the same order.

**Blocked by:** 03

**Status:** ready-for-agent

Tracker: PLTNS-32

- [ ] Criterion 2: three subscribers (initiator agent, recipient agent, human) record identical message sequences while both agents and the human send (test, offline, each subscriber re-running the live query after every write).
- [ ] A message the moderator blocks reaches its sender and the human but not the other agent, live and in the history (test with a blocking moderator double).
- [ ] A reader that is not a participant gets no messages.
