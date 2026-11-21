import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Every room message gets `seq`, a per-room sequence assigned in the transaction that stores it.
// nextMessageSeq reads the end of the room's `by_sessionId_and_seq` range, so two transactions
// adding to one room conflict and Convex retries one of them: the sequence has no gaps or
// duplicates and follows commit order, which `_creationTime` does not. Rows stored before `seq`
// existed have none; the index puts them first, in `_creationTime` order, and since nothing adds
// to that part any more, reading it by creation time cannot miss a row.

export const HISTORY_BYTE_BUDGET = 4 * 1024 * 1024;
const encoder = new TextEncoder();

export function messageBytes(doc: Doc<"messages">) {
  return encoder.encode(JSON.stringify(doc)).length;
}

async function nextMessageSeq(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const last = await ctx.db
    .query("messages")
    .withIndex("by_sessionId_and_seq", (q) => q.eq("sessionId", sessionId))
    .order("desc")
    .first();
  return (last?.seq ?? 0) + 1;
}

export async function insertMessage(
  ctx: MutationCtx,
  message: Omit<Doc<"messages">, "_id" | "_creationTime" | "seq">,
) {
  return ctx.db.insert("messages", {
    ...message,
    seq: await nextMessageSeq(ctx, message.sessionId),
  });
}

type Position =
  | { seq: number }
  | { creationTime: number; messageId: Id<"messages"> };

function invalidCursor(): never {
  throw new ConvexError({
    kind: "InvalidArgument",
    message: "the message cursor is not valid",
  });
}

// Only the two shapes encodeCursor writes, both led by the room's id so a cursor from another
// room is refused: `<sessionId>:s:<seq>` with seq >= 1, and `<sessionId>:c:<_creationTime>:<id>`.
const SEQ_CURSOR = /^([^:]+):s:([1-9]\d*)$/;
const CREATION_CURSOR = /^([^:]+):c:(\d+(?:\.\d+)?):([^:]+)$/;

function decodeCursor(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  cursor: string,
): Position {
  const seq = SEQ_CURSOR.exec(cursor);
  if (seq?.[1] === sessionId && Number.isSafeInteger(Number(seq[2]))) {
    return { seq: Number(seq[2]) };
  }
  const creation = CREATION_CURSOR.exec(cursor);
  const messageId =
    creation?.[1] === sessionId && ctx.db.normalizeId("messages", creation[3]);
  if (!creation || !messageId) invalidCursor();
  return { creationTime: Number(creation[2]), messageId };
}

function encodeCursor(doc: Doc<"messages">) {
  return doc.seq === undefined
    ? `${doc.sessionId}:c:${doc._creationTime}:${doc._id}`
    : `${doc.sessionId}:s:${doc.seq}`;
}

// The room's messages after `cursor` (null reads from the start) in sequence order, as raw rows
// for the caller to filter by visibility. A page stops at `limit` rows, or before the row that
// would pass `byteBudget`, but holds at least one row while any is left. The returned cursor
// points after the last row read, or is the given cursor when nothing new was read. Old rows
// without `seq` can share a `_creationTime`, so their cursor also names the row, and the read
// skips the rows of that tie up to it.
export async function messagesAfter(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  cursor: string | null,
  {
    limit,
    byteBudget = HISTORY_BYTE_BUDGET,
  }: { limit: number; byteBudget?: number },
): Promise<{ messages: Doc<"messages">[]; cursor: string | null }> {
  const position =
    cursor === null ? null : decodeCursor(ctx, sessionId, cursor);
  const messages: Doc<"messages">[] = [];
  let bytes = 0;
  const page = () => {
    const last = messages.at(-1);
    return { messages, cursor: last ? encodeCursor(last) : cursor };
  };
  const full = (doc: Doc<"messages">) => {
    bytes += messageBytes(doc);
    if (bytes > byteBudget && messages.length > 0) return true;
    messages.push(doc);
    return messages.length >= limit;
  };

  if (position === null || "creationTime" in position) {
    let tie = position;
    for await (const doc of ctx.db
      .query("messages")
      .withIndex("by_sessionId_and_seq", (q) => {
        const legacy = q.eq("sessionId", sessionId).eq("seq", undefined);
        return tie ? legacy.gte("_creationTime", tie.creationTime) : legacy;
      })) {
      if (tie?.creationTime === doc._creationTime) {
        if (doc._id === tie.messageId) tie = null;
        continue;
      }
      tie = null;
      if (full(doc)) return page();
    }
  }
  for await (const doc of ctx.db
    .query("messages")
    .withIndex("by_sessionId_and_seq", (q) =>
      q
        .eq("sessionId", sessionId)
        .gt("seq", position && "seq" in position ? position.seq : 0),
    )) {
    if (full(doc)) return page();
  }
  return page();
}
