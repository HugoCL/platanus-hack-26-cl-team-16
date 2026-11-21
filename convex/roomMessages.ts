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
