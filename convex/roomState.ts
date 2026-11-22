import { ConvexError } from "convex/values";
import type { Message } from "../shared/messages";
import type { Participant, Session } from "../shared/session";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

export const MAX_PARTICIPANTS = 10;

export async function requireRoomIdentity(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      kind: "Unauthorized",
      message: "sign in to use this room",
    });
  }
  return identity;
}

export async function requireRoomHuman(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
) {
  const { tokenIdentifier } = await requireRoomIdentity(ctx);
  const rows = await ctx.db
    .query("participants")
    .withIndex("by_tokenIdentifier_and_sessionId", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier).eq("sessionId", sessionId),
    )
    .take(2);
  if (rows.length > 1) {
    throw new ConvexError({
      kind: "DuplicateParticipant",
      message: "you have more than one membership in this room",
    });
  }
  const [participant] = rows;
  if (participant?.kind !== "human" || participant.leftAt !== undefined) {
    throw new ConvexError({
      kind: "NotParticipant",
      message: "you are not a participant in this room",
    });
  }
  return participant;
}

export async function loadSession(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
): Promise<Session | null> {
  const session = await ctx.db.get(sessionId);
  if (!session) return null;
  const { contract } = session;
  const participants = await ctx.db
    .query("participants")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_PARTICIPANTS);
  return {
    sessionId: session._id,
    status: session.status,
    mode: session.mode,
    intent: session.intent,
    contract:
      contract?.purpose === undefined
        ? null
        : { ...contract, purpose: contract.purpose },
    participants: participants.map(toParticipant),
    turnCount: session.turnCount,
  };
}

export function toParticipant(p: Doc<"participants">): Participant {
  if (p.kind === "agent") {
    return {
      participantId: p._id,
      kind: "agent",
      agentId: p.agentId,
      role: p.role,
      ...(p.role === "guest" ? { joinedAt: Math.floor(p._creationTime) } : {}),
    };
  }
  return {
    participantId: p._id,
    kind: "human",
    displayName: p.displayName,
    role: p.role,
    onBehalfOfAgentId: p.onBehalfOfAgentId,
  };
}

export function toMessage(doc: Doc<"messages">): Message {
  return {
    messageId: doc._id,
    sessionId: doc.sessionId,
    senderParticipantId: doc.senderParticipantId ?? null,
    recipient: doc.recipient,
    content:
      doc.moderation.status === "redacted"
        ? {
            kind: "text",
            text:
              doc.moderation.redactedText ??
              "Contenido retirado por la moderación.",
          }
        : doc.content,
    status: doc.moderation.status,
    verdict: doc.moderation.verdict ?? null,
    sentAt: Math.floor(doc._creationTime),
  };
}
