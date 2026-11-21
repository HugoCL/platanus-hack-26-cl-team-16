import assert from "node:assert/strict";
import { EventEmitter, on } from "node:events";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = new URL(process.env.NEXT_PUBLIC_CONVEX_URL);
if (
  url.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
) {
  console.log("SKIP: room smoke writes only to a local Convex backend");
  process.exit(0);
}

const clients = Array.from({ length: 3 }, () => new ConvexClient(url.origin));
try {
  const [consumer, provider] = await Promise.all([
    clients[0].query(api.directory.get, { slug: "mi-agente-juan" }),
    clients[0].query(api.directory.get, { slug: "clinica-providencia-agenda" }),
  ]);
  assert(consumer && provider, "the room smoke needs the two seed cards");
  const { sessionId, participants } = await clients[0].mutation(
    api.rooms.open,
    {
      initiatorAgentId: consumer.agentId,
      providerAgentId: provider.agentId,
      request: "Room subscription smoke",
      human: { displayName: "Smoke user" },
    },
  );
  const participantsByRole = ["initiator", "recipient", "owner"].map((role) => {
    const participant = participants.find((p) => p.role === role);
    assert(participant, `missing room participant with role ${role}`);
    return participant.participantId;
  });
  const signal = AbortSignal.timeout(15_000);
  const updates = clients.map((client, i) => {
    const events = new EventEmitter();
    const snapshots = on(events, "snapshot", { signal });
    client.onUpdate(
      api.gate.history,
      { sessionId, viewerParticipantId: participantsByRole[i] },
      (messages) => events.emit("snapshot", messages),
      (error) => events.emit("error", error),
    );
    return snapshots;
  });

  const read = () =>
    Promise.all(
      updates.map(async (stream) => {
        const {
          value: [messages],
        } = await stream.next();
        return messages;
      }),
    );
  const initial = await read();
  assert.equal(initial[0].length, 1);
  assert.equal(initial[0][0].content.code, "session_opened");
  assert.deepEqual(
    initial,
    clients.map(() => initial[0]),
  );
  const expected = [...initial[0]];
  for (const [i, senderParticipantId] of participantsByRole.entries()) {
    expected.push(
      await clients[i].action(api.gate.send, {
        sessionId,
        senderParticipantId,
        recipient: "all",
        content: { kind: "text", text: `Room smoke message ${i + 1}` },
      }),
    );
    assert.deepEqual(
      await read(),
      clients.map(() => expected),
    );
  }
  console.log(
    "PASS: three Convex subscribers received the same room messages in order",
  );
} finally {
  await Promise.all(clients.map((client) => client.close()));
}
