import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { effectiveAllowedIntents } from "../../shared/agent";
import { CONSUMER_AGENT_SLUG } from "../../shared/seedData";
import {
  DEFAULT_MAX_TURNS,
  type SessionContract,
  type SessionStatus,
} from "../../shared/session";

export async function agentBySlug(ctx: MutationCtx, slug: string) {
  const agent = await ctx.db
    .query("agents")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!agent) throw new Error(`missing agent ${slug}`);
  return agent;
}

export type TestRoom = {
  sessionId: Id<"sessions">;
  providerId: Id<"agents">;
  initiator: Id<"participants">;
  recipient: Id<"participants">;
  owner: Id<"participants">;
};

// Stands in for E2's room until it lands: a session with its contract, the consumer agent as
// initiator, the provider as recipient and a human owner acting for the consumer.
export async function insertRoom(
  ctx: MutationCtx,
  providerSlug: string,
  { status = "active" }: { status?: SessionStatus } = {},
): Promise<TestRoom> {
  const consumer = await agentBySlug(ctx, CONSUMER_AGENT_SLUG);
  const provider = await agentBySlug(ctx, providerSlug);
  const intent = { name: "book", description: "Reservar una hora" };
  const contract: SessionContract = {
    intent,
    capabilities: provider.capabilities,
    allowedIntents: effectiveAllowedIntents(provider),
    forbiddenTopics: provider.scope.forbiddenTopics,
    recipientShares: provider.scope.dataItShares,
    recipientRequests: provider.scope.dataItRequests,
    maxTurns: DEFAULT_MAX_TURNS,
    maxViolations: 3,
  };
  const sessionId = await ctx.db.insert("sessions", {
    initiatorAgentId: consumer._id,
    intent,
    contract,
    mode: "moderated",
    status,
    turnCount: 0,
    violationCount: 0,
  });
  const initiator = await ctx.db.insert("participants", {
    sessionId,
    kind: "agent",
    agentId: consumer._id,
    role: "initiator",
  });
  const recipient = await ctx.db.insert("participants", {
    sessionId,
    kind: "agent",
    agentId: provider._id,
    role: "recipient",
  });
  const owner = await ctx.db.insert("participants", {
    sessionId,
    kind: "human",
    tokenIdentifier: "test|Juan",
    displayName: "Juan",
    role: "owner",
    onBehalfOfAgentId: consumer._id,
  });
  return { sessionId, providerId: provider._id, initiator, recipient, owner };
}
