# 07: Stop looping agents at the turn limit

**What to build:** Every room enforces its contract's turn limit. Each agent message the gate stores counts as a turn; when the room reaches the limit, the gate refuses further agent messages, the orchestrator stops asking agents for replies, and the room records one system notice that the limit was reached. Humans can still write and close the room.

**Blocked by:** 06

**Status:** ready-for-agent

Tracker: PLTNS-35

- [ ] Criterion 5: two internal test agents that always answer each other stop when the room reaches its limit, with exactly that many agent turns and one turn-limit notice in the history (test with the default 12 and with a custom limit).
- [ ] After the limit, an agent send is rejected with a clear error, and a human message is still accepted (test).
- [ ] The room's turn count never exceeds its limit, so the room still validates as a shared `Session` (test).
