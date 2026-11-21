// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { judgeRateLimiter } from "../../convex/moderator";
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
    for (let i = 0; i < 10; i++) await send(room.provider);
    const stored = await storedMessages();
    rooms.judge.mockClear();

    expect(await errorKind(send(room.provider))).toBe("RateLimited");
    expect(rooms.judge).not.toHaveBeenCalled();
    expect(await storedMessages()).toBe(stored);
    expect(await send(room.human)).toMatchObject({ status: "allowed" });
  });

  it("rejects every sender once the room's bucket is empty", async () => {
    const other = await roomWithHuman(rooms, 40);
    for (let i = 0; i < 10; i++) await send(room.provider);
    for (let i = 0; i < 8; i++) await send(room.consumer);
    for (let i = 0; i < 2; i++) await send(room.human);
    const stored = await storedMessages();
    rooms.judge.mockClear();

    expect(await errorKind(send(room.human))).toBe("RateLimited");
    expect(rooms.judge).not.toHaveBeenCalled();
    expect(await storedMessages()).toBe(stored);
    expect(await send(other.human, undefined, other)).toMatchObject({
      status: "allowed",
    });
  });

  it("gives an agent a separate bucket in each room", async () => {
    const other = await roomWithHuman(rooms, 40);
    for (let i = 0; i < 10; i++) await send(room.provider);
    expect(await errorKind(send(room.provider))).toBe("RateLimited");
    expect(await send(other.provider, undefined, other)).toMatchObject({
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

describe("the judge's rate limit under concurrency", () => {
  it("does not spend a sender's token when the room bucket rejects the send", async () => {
    for (let i = 0; i < 10; i++) await send(room.provider);
    for (let i = 0; i < 9; i++) await send(room.consumer);
    const results = await Promise.allSettled([
      send(room.human),
      send(room.human),
      send(room.human),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const tokens = await rooms.t.run((ctx) =>
      judgeRateLimiter.getValue(ctx, "roomJudgeSender", {
        key: `participant:${room.human}`,
      }),
    );
    expect(Math.floor(tokens.value)).toBe(9);
  });
});

describe("maxViolations", () => {
  it("does not count a moderator failure as a violation", async () => {
    rooms.judge.mockImplementation(() => {
      throw new Error("openrouter 503");
    });
    for (let i = 0; i < 3; i++) {
      expect(await send(room.human)).toMatchObject({ status: "blocked" });
    }
    expect(
      await rooms.t.run((ctx) => ctx.db.get(room.sessionId)),
    ).toMatchObject({ status: "active", violationCount: 0 });
  });

  it("rejects a reply to a UI block broadcast to the room instead of counting a violation", async () => {
    const picker = await rooms.t.action(internal.gate.sendAsParticipant, {
      sessionId: room.sessionId,
      senderParticipantId: room.provider,
      recipient: "all",
      content: {
        kind: "ui",
        spec: {
          type: "slot_picker",
          id: "horarios",
          title: "Elige un horario",
          timezone: "America/Santiago",
          slots: [
            {
              id: "lunes-0900",
              start: "2026-11-24T09:00:00-03:00",
              end: "2026-11-24T09:30:00-03:00",
            },
          ],
        },
      },
    });
    const reply = () =>
      rooms.t.action(internal.gate.sendAsParticipant, {
        sessionId: room.sessionId,
        senderParticipantId: room.human,
        recipient: room.provider,
        content: {
          kind: "ui_response",
          inReplyTo: picker.messageId,
          response: {
            type: "slot_selected",
            pickerId: "horarios",
            slotId: "lunes-0900",
          },
        },
      });
    for (let i = 0; i < 3; i++) {
      expect(await errorKind(reply())).toBe("InvalidArgument");
    }
    expect(
      await rooms.t.run((ctx) => ctx.db.get(room.sessionId)),
    ).toMatchObject({ status: "active", violationCount: 0 });
  });

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
