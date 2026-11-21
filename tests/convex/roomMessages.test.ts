// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  insertMessage,
  messageBytes,
  messagesAfter,
} from "../../convex/roomMessages";
import { errorKind, roomWithHuman, seededRooms } from "./roomFixture";

const LIMIT = 100;

async function setup() {
  const rooms = await seededRooms();
  const room = await roomWithHuman(rooms);
  const { t } = rooms;
  const stored = (text: string, seq?: number) =>
    ({
      sessionId: room.sessionId,
      senderParticipantId: room.consumer,
      recipient: "all",
      content: { kind: "text", text },
      moderation: { status: "allowed", reasons: [] },
      ...(seq === undefined ? {} : { seq }),
    }) satisfies Omit<Doc<"messages">, "_id" | "_creationTime">;
  const readAfter = (
    cursor: string | null,
    options: { limit?: number; byteBudget?: number } = {},
  ) =>
    t.run((ctx) =>
      messagesAfter(ctx, room.sessionId, cursor, {
        limit: LIMIT,
        ...options,
      }),
    );
  const readAll = async (
    options: { limit?: number; byteBudget?: number },
    cursor: string | null = null,
  ) => {
    const pages: string[][] = [];
    while (true) {
      const page = await readAfter(cursor, options);
      if (page.messages.length === 0) {
        expect(page.cursor).toBe(cursor);
        return { pages, cursor };
      }
      pages.push(page.messages.map(label));
      cursor = page.cursor;
    }
  };
  return { ...rooms, room, stored, readAfter, readAll };
}

function label(doc: Doc<"messages">) {
  return doc.content.kind === "text" ? doc.content.text : doc.content.kind;
}

describe("room message sequence", () => {
  it("numbers every message of a room in commit order, notices included", async () => {
    const { t, room } = await setup();
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
    const { t } = await setup();
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

describe("messagesAfter", () => {
  // convex-test runs one transaction at a time and never lets _creationTime go backwards, so the
  // race (a message committed after the reader's cursor with an earlier _creationTime) is written
  // as the rows it leaves behind: sequence order opposite to creation order.
  it("follows the sequence, not _creationTime, so resuming never skips or repeats a message", async () => {
    const { t, stored, readAfter, readAll } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("messages", stored("committed second", 3)),
    );
    await t.run((ctx) =>
      ctx.db.insert("messages", stored("committed first", 2)),
    );

    const first = await readAfter(null, { limit: 2 });
    expect(first.messages.map(label)).toEqual(["system", "committed first"]);
    const firstCreation = first.messages[1]._creationTime;
    const second = await readAfter(first.cursor);
    expect(second.messages.map(label)).toEqual(["committed second"]);
    expect(second.messages[0]._creationTime).toBeLessThan(firstCreation);

    expect((await readAll({ limit: 1 })).pages).toEqual([
      ["system"],
      ["committed first"],
      ["committed second"],
    ]);
  });

  it("resumes from the last cursor and returns only what arrived after it", async () => {
    const { t, room, stored, readAll } = await setup();
    await t.run((ctx) => insertMessage(ctx, stored("a")));
    const before = await readAll({ limit: 1 });
    expect(before.pages.flat()).toEqual(["system", "a"]);

    await t.run((ctx) => insertMessage(ctx, stored("b")));
    await t.action(internal.gate.sendAsParticipant, {
      sessionId: room.sessionId,
      senderParticipantId: room.human,
      recipient: "all",
      content: { kind: "text", text: "c" },
    });
    expect((await readAll({ limit: 1 }, before.cursor)).pages.flat()).toEqual([
      "b",
      "c",
    ]);
  });

  it("reads old rows without a sequence first, in creation order, and pages across the boundary", async () => {
    const rooms = await seededRooms();
    const room = await roomWithHuman(rooms);
    const { t } = rooms;
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("messages")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", room.sessionId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    });
    const message = (text: string) => ({
      sessionId: room.sessionId,
      recipient: "all" as const,
      content: { kind: "text" as const, text },
      moderation: { status: "allowed" as const, reasons: [] },
    });
    await t.run(async (ctx) => {
      for (const text of ["old 1", "old 2", "old 3"]) {
        await ctx.db.insert("messages", message(text));
      }
    });
    await t.run(async (ctx) => {
      for (const text of ["new 1", "new 2", "new 3"]) {
        await insertMessage(ctx, message(text));
      }
    });
    const read = (cursor: string | null, limit: number) =>
      t.run((ctx) => messagesAfter(ctx, room.sessionId, cursor, { limit }));

    const pages: string[][] = [];
    const seqs: (number | undefined)[] = [];
    let cursor: string | null = null;
    while (true) {
      const page = await read(cursor, 2);
      if (page.messages.length === 0) break;
      pages.push(page.messages.map(label));
      seqs.push(...page.messages.map((m) => m.seq));
      cursor = page.cursor;
    }
    expect(pages).toEqual([
      ["old 1", "old 2"],
      ["old 3", "new 1"],
      ["new 2", "new 3"],
    ]);
    expect(seqs).toEqual([undefined, undefined, undefined, 1, 2, 3]);

    const insideOld = await read(null, 1);
    expect((await read(insideOld.cursor, 10)).messages.map(label)).toEqual([
      "old 2",
      "old 3",
      "new 1",
      "new 2",
      "new 3",
    ]);
  });

  it("stops before the byte budget but never returns an empty page while messages are left", async () => {
    const { t, stored, readAll } = await setup();
    const big = "x".repeat(2000);
    const ids = await t.run(async (ctx) => {
      const out = [];
      for (const text of ["big 1", "big 2", "small"]) {
        out.push(
          await insertMessage(
            ctx,
            stored(text === "small" ? text : big + text),
          ),
        );
      }
      return out;
    });
    const [, big2, small] = await t.run((ctx) =>
      Promise.all(
        ids.map(async (id) => {
          const doc = await ctx.db.get(id);
          if (!doc) throw new Error("missing message");
          return messageBytes(doc);
        }),
      ),
    );
    const short = (text: string) => text.replace(big, "");

    const fits = await readAll({ byteBudget: big2 + small });
    expect(fits.pages.map((page) => page.map(short))).toEqual([
      ["system"],
      ["big 1"],
      ["big 2", "small"],
    ]);
    const tiny = await readAll({ byteBudget: 1 });
    expect(tiny.pages.map((page) => page.map(short))).toEqual([
      ["system"],
      ["big 1"],
      ["big 2"],
      ["small"],
    ]);
  });

  it("rejects a cursor it did not issue", async () => {
    const { readAfter, room } = await setup();
    const shapes = [
      "",
      "s:",
      "s:1:2",
      "x:1",
      "c:5",
      "c:5:not-an-id",
      "s:0",
      "s:-5",
      "s:   ",
      "s:1e0",
      "s:01",
      "c:   :x",
    ];
    for (const cursor of [
      ...shapes,
      ...shapes.map((shape) => `${room.sessionId}:${shape}`),
      "s:1",
    ]) {
      expect(await errorKind(readAfter(cursor))).toBe("InvalidArgument");
    }
  });

  it("rejects a cursor from another room", async () => {
    const rooms = await setup();
    const { t, readAfter, room } = rooms;
    const other = await roomWithHuman(rooms);
    expect(other.sessionId).not.toBe(room.sessionId);
    const { cursor } = await t.run((ctx) =>
      messagesAfter(ctx, other.sessionId, null, { limit: LIMIT }),
    );
    expect(cursor).toMatch(new RegExp(`^${other.sessionId}:`));
    expect(await errorKind(readAfter(cursor))).toBe("InvalidArgument");
    expect((await readAfter(null)).cursor).toMatch(
      new RegExp(`^${room.sessionId}:`),
    );
  });
});
