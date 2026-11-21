# E2: agent-to-agent rooms

Source: epic E2 in the project drive (`specs/directorio-agentes-epics.md`), "Contratos compartidos" and "Reglas fijas". Epic issue: PLTNS-19. Owner: Yung.

## Goal

A neutral room where agents of different entities and a human talk under the same rules: participants, an immutable purpose contract, and an ordered history. Every message passes one moderation point before it is stored and delivered.

## Build

- Open a room from a card and a request. The contract is the request plus the card's purpose and scope.
- Send a message, read the history, listen live, close the room.
- One moderation gate that every message passes before it is stored and delivered. Until E3 it calls an allow-all moderator double behind a `Moderator` interface; only E3 replaces it.
- Turn orchestration: when an allowed message is addressed to an internal agent, the room asks that agent for its reply and publishes it through the same gate. Agents sit behind a `RoomAgent` interface; E2 ships a deterministic test agent on the fake LLM, E8 builds the real ones.
- A per-room turn limit, configurable, 12 by default.

## Do not build now

Persistence across restarts as a requirement, rooms with more than two agents, attachments, editing or deleting messages, authentication of callers (E5 adds per-agent credentials), any UI (E4).

## Decisions

- Names follow the code: room = `session`, card = `agent`, consumer = `initiator`, provider = `recipient`.
- The gate is a Convex action (the real moderator calls an LLM). It reads the room, asks the moderator, and commits the message with its verdict in one internal mutation that rechecks the room is open and under its turn limit. The gate module is the only code that writes to `messages`.
- Platform notices (`system` messages) are written by the same gate module, stamped by the platform, without asking the moderator.
- A turn is a message from an agent participant that the gate stores. Human messages do not count, so the human can still talk after agents hit the limit.
- Visibility: a deliverable message (`allowed`) is visible to every participant; a blocked one only to its sender and to humans. With the allow-all double nothing is blocked, but the rule lives in the listen and history reads so E3 only changes verdicts.
- Live listening is a reactive Convex query. `convex-test` has no subscriptions, so the offline test models each subscriber as a client that re-runs the same query after every write, which is what Convex's reactivity guarantees.

## Success criteria (from the epic)

1. Opening a room from the clinic card returns an open room whose contract has the request, the purpose, and what the card allows and forbids.
2. Three clients subscribed to the same room (two agents and one human) get the same messages in the same order.
3. The history returns every message in order, each with its verdict.
4. A closed room rejects new messages with a clear error.
5. Two agents that answer each other forever stop at the turn limit, and the room records it with a system notice.
6. There is no way to deliver a message without passing the single moderation point.
