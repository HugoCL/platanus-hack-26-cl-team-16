// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorKind, roomWithHuman, seededRooms } from "./roomFixture";

let rooms: Awaited<ReturnType<typeof seededRooms>>;
let room: Awaited<ReturnType<typeof roomWithHuman>>;

beforeEach(async () => {
  rooms = await seededRooms();
  room = await roomWithHuman(rooms, 40);
});

const send = (
  sender: Id<"participants">,
  text = "¿Tienen hora el lunes?",
  target = room,
) =>
  rooms.t.action(internal.gate.sendAsParticipant, {
    sessionId: target.sessionId,
    senderParticipantId: sender,
    recipient: "all",
    content: { kind: "text", text },
  });

const storedMessages = () =>
  rooms.t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("messages")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", room.sessionId))
          .collect()
      ).length,
  );

describe("the judge's rate limit", () => {
  it("rejects a sender whose bucket is empty without calling the judge or storing anything", async () => {
    for (let i = 0; i < 10; i++) await send(room.consumer);
    const stored = await storedMessages();
    rooms.judge.mockClear();

    expect(await errorKind(send(room.consumer))).toBe("RateLimited");
    expect(rooms.judge).not.toHaveBeenCalled();
    expect(await storedMessages()).toBe(stored);
    expect(await send(room.provider)).toMatchObject({ status: "allowed" });
  });

  it("rejects every sender once the room's bucket is empty", async () => {
    for (let i = 0; i < 10; i++) {
      await send(room.consumer);
      await send(room.provider);
    }
    const stored = await storedMessages();
    rooms.judge.mockClear();

    expect(await errorKind(send(room.human))).toBe("RateLimited");
    expect(rooms.judge).not.toHaveBeenCalled();
    expect(await storedMessages()).toBe(stored);
    const other = await roomWithHuman(rooms, 40);
    expect(await send(other.human, undefined, other)).toMatchObject({
      status: "allowed",
    });
  });

  it("rate limits opening rooms per initiator before the judge runs", async () => {
    for (let i = 0; i < 9; i++) await rooms.open();
    rooms.judge.mockClear();
    const sessions = () =>
      rooms.t.run(
        async (ctx) => (await ctx.db.query("sessions").collect()).length,
      );
    const before = await sessions();

    expect(await errorKind(rooms.open())).toBe("RateLimited");
    expect(rooms.judge).not.toHaveBeenCalled();
    expect(await sessions()).toBe(before);
  });
});

describe("maxViolations", () => {
  it("terminates the room when blocked messages reach the contract's limit", async () => {
    const { maxViolations } = room.room.contract ?? { maxViolations: 0 };
    expect(maxViolations).toBe(3);
    rooms.judge.mockReturnValue({ decision: "block", rule: "scope" });

    for (let i = 0; i < maxViolations - 1; i++) {
      expect(await send(room.consumer)).toMatchObject({ status: "blocked" });
    }
    expect(
      await rooms.t.run((ctx) => ctx.db.get(room.sessionId)),
    ).toMatchObject({ status: "active", violationCount: maxViolations - 1 });

    expect(await send(room.consumer)).toMatchObject({ status: "blocked" });
    expect(
      await rooms.t.run((ctx) => ctx.db.get(room.sessionId)),
    ).toMatchObject({
      status: "terminated",
      closedReason: "max_violations",
      violationCount: maxViolations,
    });
    const last = await rooms.t.run((ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", room.sessionId))
        .order("desc")
        .first(),
    );
    expect(last?.content).toMatchObject({ code: "session_terminated" });

    rooms.judge.mockClear();
    expect(await errorKind(send(room.provider))).toBe("RoomClosed");
    expect(rooms.judge).not.toHaveBeenCalled();
  });
});
