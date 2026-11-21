// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { allowAllModerator } from "../../convex/moderator";
import { errorKind, roomWithHuman, seededRooms } from "./roomFixture";

async function setup() {
  const fixture = await seededRooms();
  const { t } = fixture;
  const { sessionId, consumer, provider, human } = await roomWithHuman(fixture);
  const close = (participantId = human) =>
    t.mutation(api.rooms.close, { sessionId, participantId });
  const send = () =>
    t.action(api.gate.send, {
      sessionId,
      senderParticipantId: consumer,
      recipient: provider,
      content: { kind: "text", text: "¿Queda una hora?" },
    });
  const notices = () =>
    t.run(async (ctx) => {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .take(10);
      return messages.map(({ content }) => content);
    });
  return { t, sessionId, close, send, notices, fixture };
}

it("4. closes the room once and rejects a new message without storing it", async () => {
  const { t, sessionId, close, send, notices } = await setup();
  const closed = await close();
  expect(closed).toEqual({ sessionId, status: "closed" });
  expect(await close()).toEqual(closed);
  expect(await t.query(api.rooms.get, { sessionId })).toMatchObject({
    status: "closed",
  });
  expect(
    await t.run(async (ctx) => (await ctx.db.get(sessionId))?.closedReason),
  ).toBe("closed_by_owner");
  await expect(send()).rejects.toThrow(/the room is closed/);
  expect(await notices()).toMatchObject([
    { code: "session_opened" },
    { code: "session_closed" },
  ]);
});

it("does not let a participant from another room close this one", async () => {
  const { t, close, fixture, sessionId } = await setup();
  const other = await roomWithHuman(fixture);
  expect(await errorKind(close(other.human))).toBe("NotParticipant");
  expect(await t.query(api.rooms.get, { sessionId })).toMatchObject({
    status: "active",
  });
});

it("rejects a message if the room closes while moderation is running", async () => {
  const { close, send, notices } = await setup();
  const moderate = vi
    .spyOn(allowAllModerator, "moderate")
    .mockImplementationOnce(async () => {
      await close();
      return { verdict: { decision: "allow", reason: "Allowed" }, events: [] };
    });
  try {
    expect(await errorKind(send())).toBe("RoomClosed");
    expect(moderate).toHaveBeenCalledOnce();
    expect(await notices()).toMatchObject([
      { code: "session_opened" },
      { code: "session_closed" },
    ]);
  } finally {
    moderate.mockRestore();
  }
});
