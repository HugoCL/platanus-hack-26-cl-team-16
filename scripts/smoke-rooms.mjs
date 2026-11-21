import assert from "node:assert/strict";
import { EventEmitter, on } from "node:events";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = new URL(process.env.NEXT_PUBLIC_CONVEX_URL);
assert(
  url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  "room smoke writes only to a local Convex backend",
);

const clients = Array.from({ length: 3 }, () => new ConvexClient(url.origin));
try {
  const [consumer, provider] = await Promise.all([
    clients[0].query(api.directory.get, { slug: "mi-agente-juan" }),
    clients[0].query(api.directory.get, { slug: "clinica-providencia-agenda" }),
  ]);
  assert(consumer && provider, "the room smoke needs the two seed cards");
  const { sessionId, participants } = await clients[0].action(api.rooms.open, {
    initiatorAgentId: consumer.agentId,
    providerAgentId: provider.agentId,
    request: "Room subscription smoke",
    human: { displayName: "Smoke user" },
  });
  const participantsByRole = ["initiator", "recipient", "owner"].map((role) => {
    const participant = participants.find((p) => p.role === role);
    assert(participant, `missing room participant with role ${role}`);
    return participant.participantId;
  });
  const signal = AbortSignal.timeout(15_000);
  const providerSnapshots = [];
  const updates = clients.map((client, i) => {
    const events = new EventEmitter();
    const snapshots = on(events, "snapshot", { signal });
    client.onUpdate(
      api.gate.history,
      { sessionId, viewerParticipantId: participantsByRole[i] },
      (messages) => {
        if (i === 1) providerSnapshots.push(messages);
        events.emit("snapshot", messages);
      },
      (error) => events.emit("error", error),
    );
    return snapshots;
  });

  const read = (indices = [0, 1, 2]) =>
    Promise.all(indices.map(async (i) => (await updates[i].next()).value[0]));
  const initial = await read();
  assert.equal(initial[0].length, 1);
  assert.equal(initial[0][0].content.code, "session_opened");
  assert.deepEqual(
    initial,
    clients.map(() => initial[0]),
  );
  const expected = initial.map((messages) => [...messages]);
  let blockedId;
  for (const [i, senderParticipantId] of participantsByRole.entries()) {
    const allowed = await clients[i].action(api.gate.send, {
      sessionId,
      senderParticipantId,
      recipient: "all",
      content: { kind: "text", text: `Room smoke message ${i + 1}` },
    });
    assert.equal(allowed.status, "allowed");
    for (const messages of expected) messages.push(allowed);
    assert.deepEqual(await read(), expected);
    if (i !== 0) continue;

    const blocked = await clients[0].action(api.gate.send, {
      sessionId,
      senderParticipantId,
      recipient: participantsByRole[1],
      content: { kind: "text", text: "¿Hablamos del clima?" },
    });
    blockedId = blocked.messageId;
    assert.equal(blocked.status, "blocked");
    const [sender, human] = await read([0, 2]);
    const alert = sender.at(-1);
    assert.equal(alert.content.spec.type, "moderator_alert");
    assert.equal(alert.content.spec.blockedMessageId, blockedId);
    assert.equal(alert.content.spec.reason, blocked.verdict.reason);
    expected[0].push(blocked, alert);
    expected[2].push(blocked, alert);
    assert.deepEqual([sender, human], [expected[0], expected[2]]);
  }
  assert(blockedId);
  for (const snapshot of providerSnapshots) {
    assert(
      !snapshot.some(
        (message) =>
          message.messageId === blockedId ||
          message.content.spec?.blockedMessageId === blockedId,
      ),
    );
  }
  console.log(
    "PASS: three Convex subscribers received allowed messages in order; only sender and human received the blocked message and alert",
  );
} finally {
  await Promise.all(clients.map((client) => client.close()));
}
