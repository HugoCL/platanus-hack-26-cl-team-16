import type { Message } from "../shared/messages";
import type { Participant, Session } from "../shared/session";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const MAX_PARTICIPANTS = 10;

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

function toParticipant(p: Doc<"participants">): Participant {
  if (p.kind === "agent") {
    return {
      participantId: p._id,
      kind: "agent",
      agentId: p.agentId,
      role: p.role,
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
    content: doc.content,
    status: doc.moderation.status,
    verdict: doc.moderation.verdict ?? null,
    sentAt: Math.floor(doc._creationTime),
  };
}
