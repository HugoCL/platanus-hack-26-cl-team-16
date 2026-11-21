// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { roomWithHuman, seededRooms } from "./roomFixture";

function label(doc: Doc<"messages">) {
  return doc.content.kind === "text" ? doc.content.text : doc.content.kind;
}

describe("room message sequence", () => {
  it("numbers every message of a room in commit order, notices included", async () => {
    const rooms = await seededRooms();
    const { t } = rooms;
    const room = await roomWithHuman(rooms);
    const send = (
      sender: Id<"participants">,
      recipient: Id<"participants"> | "all",
      text: string,
    ) =>
      t.action(internal.gate.sendAsParticipant, {
        sessionId: room.sessionId,
        senderParticipantId: sender,
        recipient,
        content: { kind: "text", text },
      });
    await send(room.consumer, "all", "uno");
    await send(room.human, "all", "dos");
    await send(room.consumer, room.provider, "tres");
    await t.mutation(internal.rooms.closeAsParticipant, {
      sessionId: room.sessionId,
      participantId: room.human,
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", room.sessionId))
        .collect(),
    );
    expect(rows.map((row) => row.seq)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.map(label)).toEqual(
      expect.arrayContaining(["system", "uno", "dos", "tres"]),
    );
    expect(
      rows.filter((row) => row.senderParticipantId === undefined),
    ).not.toHaveLength(0);
  });

  it("keeps a separate sequence per room", async () => {
    const rooms = await seededRooms();
    const first = await roomWithHuman(rooms);
    const second = await roomWithHuman(rooms);
    const seqs = await rooms.t.run(async (ctx) =>
      Promise.all(
        [first, second].map(async ({ sessionId }) =>
          (
            await ctx.db
              .query("messages")
              .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
              .collect()
          ).map((row) => row.seq),
        ),
      ),
    );
    expect(seqs).toEqual([[1], [1]]);
  });

  it("gives the seeded demo room a sequence", async () => {
    const { t } = await seededRooms();
    const rows = await t.run(async (ctx) => {
      const demo = await ctx.db.query("sessions").first();
      if (!demo) throw new Error("missing seeded room");
      return ctx.db
        .query("messages")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", demo._id))
        .collect();
    });
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((row) => row.seq)).toEqual(rows.map((_, i) => i + 1));
  });
});
