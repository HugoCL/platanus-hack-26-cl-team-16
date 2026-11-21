// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { allowAllModerator } from "../../convex/moderator";
import { testRoomAgent } from "../../convex/roomAgent";
import { roomWithHuman, seededRooms } from "./roomFixture";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const fixture = await seededRooms();
  const { t } = fixture;
  const { sessionId, consumer, provider, human } = await roomWithHuman(fixture);
  return {
    ...fixture,
    consumer,
    provider,
    human,
    send: (recipient = provider) =>
      t.action(internal.gate.sendAsParticipant, {
        sessionId,
        senderParticipantId: consumer,
        recipient,
        content: { kind: "text", text: "¿Tienes horas?" },
      }),
    history: (viewerParticipantId = consumer) =>
      t.query(internal.gate.historyForParticipant, {
        sessionId,
        viewerParticipantId,
      }),
    finishReplies: () => t.finishAllScheduledFunctions(vi.runAllTimers),
  };
}

it("publishes a hosted agent's answer to the sender with its own verdict", async () => {
  const room = await setup();
  const moderate = vi.spyOn(allowAllModerator, "moderate");
  const sent = await room.send();
  expect(sent.status).toBe("allowed");
  await room.finishReplies();

  const messages = await room.history();
  expect(messages.slice(1)).toMatchObject([
    sent,
    {
      senderParticipantId: room.provider,
      recipient: room.consumer,
      content: { kind: "text", text: "Recibido." },
      status: "allowed",
      verdict: { decision: "allow" },
    },
  ]);
  expect(moderate).toHaveBeenCalledTimes(2);
  expect(moderate.mock.calls[1][0].sender.participantId).toBe(room.provider);
});

it("does not deliver a blocked agent reply to the other agent", async () => {
  const room = await setup();
  const moderate = vi.spyOn(allowAllModerator, "moderate");
  moderate.mockResolvedValueOnce({
    verdict: { decision: "allow", reason: "Within the room's purpose." },
    events: [],
  });
  moderate.mockResolvedValueOnce({
    verdict: { decision: "block", rule: "purpose", reason: "Off-topic." },
    events: [],
  });

  const sent = await room.send();
  await room.finishReplies();
  expect((await room.history()).slice(1)).toEqual([sent]);
  expect(await room.history(room.provider)).toHaveLength(4);
  expect((await room.history(room.provider))[2]).toMatchObject({
    senderParticipantId: room.provider,
    status: "blocked",
    verdict: { decision: "block" },
  });
});

it("does not ask an agent to reply to a block or a message for a human or external agent", async () => {
  const room = await setup();
  const agent = vi.spyOn(testRoomAgent, "reply");
  vi.spyOn(allowAllModerator, "moderate").mockResolvedValueOnce({
    verdict: { decision: "block", rule: "purpose", reason: "Off-topic." },
    events: [],
  });
  await room.send();
  await room.send(room.human);
  await room.t.run((ctx) =>
    ctx.db.patch("agents", room.clinicId, { kind: "external" }),
  );
  await room.send();
  await room.finishReplies();
  expect(agent).not.toHaveBeenCalled();
});

it("does not expose previous blocked messages to the hosted recipient", async () => {
  const room = await setup();
  const agent = vi.spyOn(testRoomAgent, "reply");
  vi.spyOn(allowAllModerator, "moderate").mockResolvedValueOnce({
    verdict: { decision: "block", rule: "purpose", reason: "Off-topic." },
    events: [],
  });
  await room.send();
  const allowed = await room.send();
  await room.finishReplies();
  expect(agent.mock.calls[0][0].history.slice(1)).toEqual([allowed]);
});
