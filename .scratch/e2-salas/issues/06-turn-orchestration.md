# 06: Turn orchestration with a test agent

**What to build:** When the gate stores an allowed message addressed to an internal agent, the room asks that agent for its reply and publishes the reply through the same gate, so the reply is moderated like any other message. Agents sit behind a `RoomAgent` interface that receives the room contract, the history it can see, and an `LlmProvider`; E2 ships one deterministic test agent that answers through the fake LLM, and E8 replaces it with the real agents. Messages addressed to a human, or to an external agent, wait for that participant.

**Blocked by:** 03, 04 (the agent’s reply context uses the same visibility policy as the live view)

**Status:** ready-for-agent

Tracker: PLTNS-34

- [ ] A message from the consumer addressed to the internal provider produces exactly one reply from the provider, published through the gate with its verdict and addressed back to the sender (test).
- [ ] A reply the moderator blocks is stored as blocked and never reaches the other agent (test with a blocking moderator double).
- [ ] A message addressed to the human produces no agent reply (test).
