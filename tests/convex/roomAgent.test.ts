// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { allowAllModerator } from "../../convex/moderator";
import { testRoomAgent } from "../../convex/roomAgent";
import { errorKind, roomWithHuman, seededRooms } from "./roomFixture";

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
    sessionId,
    send: (recipient: Id<"participants"> | "all" = provider) =>
      t.action(api.gate.send, {
        sessionId,
        senderParticipantId: consumer,
        recipient,
        content: { kind: "text", text: "¿Tienes horas?" },
      }),
    history: (viewerParticipantId = consumer) =>
      t.query(api.gate.history, { sessionId, viewerParticipantId }),
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

it("sends what an agent asks, to whom it asks, each through the gate", async () => {
  const room = await setup();
  const moderate = vi.spyOn(allowAllModerator, "moderate");
  const agent = vi.spyOn(testRoomAgent, "reply").mockResolvedValueOnce([
    {
      kind: "send",
      recipient: room.human,
      content: { kind: "text", text: "Juan, elige un horario." },
    },
    {
      kind: "send",
      recipient: "all",
      content: { kind: "text", text: "Aviso para todos." },
    },
  ]);

  const sent = await room.send();
  await room.finishReplies();

  expect(agent).toHaveBeenCalledTimes(1);
  const input = agent.mock.calls[0][0];
  expect(input.self).toBe(room.provider);
  expect(input.participants.map((p) => p.participantId)).toEqual([
    room.consumer,
    room.provider,
    room.human,
  ]);
  expect(typeof input.llm.generateObject).toBe("function");
  expect(input).not.toHaveProperty("ctx");
  expect((await room.history(room.human)).slice(1)).toMatchObject([
    sent,
    {
      senderParticipantId: room.provider,
      recipient: room.human,
      status: "allowed",
    },
    { senderParticipantId: room.provider, recipient: "all", status: "allowed" },
  ]);
  expect(moderate).toHaveBeenCalledTimes(3);
});

it("closes the room when an agent asks, like rooms.close, and drops what follows", async () => {
  const room = await setup();
  vi.spyOn(testRoomAgent, "reply").mockResolvedValueOnce([
    {
      kind: "send",
      recipient: room.human,
      content: { kind: "text", text: "Reserva confirmada." },
    },
    { kind: "close" },
    {
      kind: "send",
      recipient: room.human,
      content: { kind: "text", text: "Esto ya no sale." },
    },
  ]);

  await room.send();
  await room.finishReplies();

  const contents = (await room.history(room.human)).map((m) => m.content);
  expect(contents.slice(2)).toMatchObject([
    { kind: "text", text: "Reserva confirmada." },
    { kind: "system", code: "session_closed" },
  ]);
  expect(
    (await room.t.query(api.rooms.get, { sessionId: room.sessionId }))?.status,
  ).toBe("closed");
  expect(await errorKind(room.send())).toBe("RoomClosed");
});

it("gives every agent a turn for a human's message to everyone, and none for an agent's", async () => {
  const room = await setup();
  const agent = vi.spyOn(testRoomAgent, "reply");
  const toEveryone = { kind: "text" as const, text: "Hola a todos." };

  await room.t.action(api.gate.send, {
    sessionId: room.sessionId,
    senderParticipantId: room.human,
    recipient: "all",
    content: toEveryone,
  });
  await room.finishReplies();

  expect(agent.mock.calls.map(([input]) => input.self).sort()).toEqual(
    [room.consumer, room.provider].sort(),
  );
  const acks = (await room.history(room.human)).filter(
    (m) => m.content.kind === "text" && m.content.text === "Recibido.",
  );
  expect(acks.map((m) => m.recipient)).toEqual([room.human, room.human]);

  agent.mockClear();
  await room.send("all");
  await room.finishReplies();
  expect(agent).not.toHaveBeenCalled();
});

it("drops a whole reply that addresses someone outside the room", async () => {
  const room = await setup();
  const other = await roomWithHuman(room);
  vi.spyOn(testRoomAgent, "reply").mockResolvedValueOnce([
    {
      kind: "send",
      recipient: room.human,
      content: { kind: "text", text: "Para Juan." },
    },
    {
      kind: "send",
      recipient: other.human,
      content: { kind: "text", text: "Para otra sala." },
    },
    { kind: "close" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});

  const sent = await room.send();
  await room.finishReplies();

  expect((await room.history(room.human)).slice(1)).toEqual([sent]);
  expect(
    (await room.t.query(api.rooms.get, { sessionId: room.sessionId }))?.status,
  ).toBe("active");
});

it("stops a reply at the first send the moderator blocks", async () => {
  const room = await setup();
  vi.spyOn(testRoomAgent, "reply").mockResolvedValueOnce([
    {
      kind: "send",
      recipient: room.human,
      content: { kind: "text", text: "Reserva confirmada." },
    },
    { kind: "close" },
  ]);
  const moderate = vi.spyOn(allowAllModerator, "moderate");
  moderate.mockResolvedValueOnce({
    verdict: { decision: "allow", reason: "Within the room's purpose." },
    events: [],
  });
  moderate.mockResolvedValueOnce({
    verdict: { decision: "block", rule: "sensitive_data", reason: "Datos." },
    events: [],
  });

  await room.send();
  await room.finishReplies();

  expect(
    (await room.t.query(api.rooms.get, { sessionId: room.sessionId }))?.status,
  ).toBe("active");
  expect((await room.history(room.human)).at(-1)).toMatchObject({
    content: { kind: "ui", spec: { type: "moderator_alert" } },
  });
});

it("stores one confirmation when hosted replies publish the same card concurrently", async () => {
  const room = await setup();
  vi.spyOn(testRoomAgent, "reply").mockResolvedValue([
    {
      kind: "send",
      recipient: room.human,
      content: {
        kind: "ui",
        spec: {
          type: "confirmation",
          id: "reserva-1",
          title: "Reserva confirmada",
          summary: "Martes a las 10.",
          details: [],
          confirmLabel: "Listo",
          cancelLabel: "Cerrar",
        },
      },
    },
  ]);
  const first = await room.send();
  const second = await room.send();

  await Promise.all(
    [first, second].map((message) =>
      room.t.action(internal.gate.reply, {
        messageId: message.messageId as Id<"messages">,
        participantId: room.provider,
      }),
    ),
  );
  await room.finishReplies();

  const history = await room.history(room.human);
  expect(history.slice(3)).toMatchObject([
    {
      recipient: room.human,
      content: { kind: "ui", spec: { id: "reserva-1" } },
      status: "allowed",
    },
  ]);
});

const confirmation = (summary: string) => ({
  kind: "ui" as const,
  spec: {
    type: "confirmation" as const,
    id: "reserva-1",
    title: "Reserva confirmada",
    summary,
    details: [],
    confirmLabel: "Listo",
    cancelLabel: "Cerrar",
  },
});

it("records a blocked confirmation even when one with the same id was allowed", async () => {
  const room = await setup();
  const agent = vi.spyOn(testRoomAgent, "reply");
  agent.mockResolvedValueOnce([
    { kind: "send", recipient: room.human, content: confirmation("Martes.") },
  ]);
  await room.send();
  await room.finishReplies();

  agent.mockResolvedValueOnce([
    {
      kind: "send",
      recipient: room.human,
      content: confirmation("Miércoles."),
    },
    { kind: "close" },
  ]);
  const moderate = vi.spyOn(allowAllModerator, "moderate");
  moderate.mockResolvedValueOnce({
    verdict: { decision: "allow", reason: "Within the room's purpose." },
    events: [],
  });
  moderate.mockResolvedValueOnce({
    verdict: { decision: "block", rule: "sensitive_data", reason: "Datos." },
    events: [],
  });
  await room.send();
  await room.finishReplies();

  const cards = (await room.history(room.provider)).filter(
    (m) => m.content.kind === "ui" && m.content.spec.type === "confirmation",
  );
  expect(cards).toMatchObject([
    { content: confirmation("Martes."), status: "allowed" },
    { content: confirmation("Miércoles."), status: "blocked" },
  ]);
  expect((await room.history(room.human)).at(-1)).toMatchObject({
    content: { kind: "ui", spec: { type: "moderator_alert" } },
  });
  expect(
    (await room.t.query(api.rooms.get, { sessionId: room.sessionId }))?.status,
  ).toBe("active");
});

it("stores a confirmation that reuses an id with different content", async () => {
  const room = await setup();
  const agent = vi.spyOn(testRoomAgent, "reply");
  for (const summary of ["Martes.", "Miércoles."]) {
    agent.mockResolvedValueOnce([
      { kind: "send", recipient: room.human, content: confirmation(summary) },
    ]);
    await room.send();
    await room.finishReplies();
  }

  const cards = (await room.history(room.human)).filter(
    (m) => m.content.kind === "ui" && m.content.spec.type === "confirmation",
  );
  expect(cards).toMatchObject([
    { content: confirmation("Martes."), status: "allowed" },
    { content: confirmation("Miércoles."), status: "allowed" },
  ]);
});
