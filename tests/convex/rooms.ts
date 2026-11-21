import type { TestConvex } from "convex-test";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import type schema from "../../convex/schema";
import { providerTurn } from "../../lib/agents/provider";
import { effectiveAllowedIntents } from "../../shared/agent";
import {
  Message,
  type Recipient,
  type SendableContent,
} from "../../shared/messages";
import { DELIVERABLE_STATUSES, type Moderator } from "../../shared/moderation";
import type { LlmProvider } from "../../shared/providers/llm";
import { CONSUMER_AGENT_SLUG } from "../../shared/seed-data";
import {
  DEFAULT_MAX_TURNS,
  type Participant,
  type SessionContract,
  type SessionIntent,
  type SessionStatus,
} from "../../shared/session";

// The seed's slots are fixed dates from 24 to 28 November 2026, so tests run at a fixed time.
export const NOW = Date.parse("2026-11-21T12:00:00-03:00");

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
  contract: SessionContract;
  participants: Participant[];
  initiator: Id<"participants">;
  recipient: Id<"participants">;
  owner: Id<"participants">;
};

// Stands in for E2's room until it lands: a session with its contract, the consumer agent as
// initiator, the provider as recipient and a human owner acting for the consumer.
export async function insertRoom(
  ctx: MutationCtx,
  providerSlug: string,
  {
    status = "active",
    ownerName = "Juan",
    intent = { name: "book", description: "Reservar una hora" },
  }: {
    status?: SessionStatus;
    ownerName?: string;
    intent?: SessionIntent;
  } = {},
): Promise<TestRoom> {
  const consumer = await agentBySlug(ctx, CONSUMER_AGENT_SLUG);
  const provider = await agentBySlug(ctx, providerSlug);
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
    tokenIdentifier: `test|${ownerName}`,
    displayName: ownerName,
    role: "owner",
    onBehalfOfAgentId: consumer._id,
  });
  return {
    sessionId,
    providerId: provider._id,
    contract,
    initiator,
    recipient,
    owner,
    participants: [
      {
        participantId: initiator,
        kind: "agent",
        agentId: consumer._id,
        role: "initiator",
      },
      {
        participantId: recipient,
        kind: "agent",
        agentId: provider._id,
        role: "recipient",
      },
      {
        participantId: owner,
        kind: "human",
        displayName: ownerName,
        role: "owner",
        onBehalfOfAgentId: consumer._id,
      },
    ],
  };
}

export const allowAll: Moderator = {
  moderate: async () => ({
    verdict: { decision: "allow", reason: "Doble que permite todo." },
    events: [],
  }),
};

// The room's message log with E2's allow-all moderator double in front of it: every post is
// asked to `allowAll` and stored as a shared `Message` with its verdict.
export function withLog(room: TestRoom) {
  const history: Message[] = [];
  const post = async (
    sender: string,
    recipient: Recipient,
    content: SendableContent,
  ) => {
    const from = room.participants.find((p) => p.participantId === sender);
    if (!from) throw new Error(`${sender} is not in the room`);
    const { verdict } = await allowAll.moderate({
      content,
      sender: from,
      recipient,
      contract: room.contract,
      participants: room.participants,
      history,
    });
    const message = Message.parse({
      messageId: `${room.sessionId}-${history.length + 1}`,
      sessionId: room.sessionId,
      senderParticipantId: sender,
      recipient,
      content,
      status: verdict.decision === "allow" ? "allowed" : "blocked",
      verdict,
      sentAt: history.length + 1,
    });
    history.push(message);
    return message;
  };
  return { ...room, history, post };
}
export type LoggedRoom = ReturnType<typeof withLog>;

export function pickerOf(message: Message) {
  if (
    message.content.kind !== "ui" ||
    message.content.spec.type !== "slot_picker"
  ) {
    throw new Error(
      `expected a slot picker, got ${JSON.stringify(message.content)}`,
    );
  }
  return message.content.spec;
}

// The room's human picks one slot of a picker, as a ui_response to the provider.
export const choose = (room: LoggedRoom, picker: Message, slotId: string) =>
  room.post(room.owner, room.recipient, {
    kind: "ui_response",
    inReplyTo: picker.messageId,
    response: { type: "slot_selected", pickerId: pickerOf(picker).id, slotId },
  });

// What a participant can see of the room, as E2 delivers it: what it sent, and the delivered
// messages addressed to it or to everyone.
export const visibleTo = (room: LoggedRoom, self: string) =>
  room.history.filter(
    (m) =>
      m.senderParticipantId === self ||
      (DELIVERABLE_STATUSES.includes(m.status) &&
        (m.recipient === self || m.recipient === "all")),
  );

// One provider turn as E2's adapter will run it: the room as the provider sees it, the context
// loaded by `providerAgent.context` and the `book` port bound to `bookings.book`, both at `NOW`.
export async function askProvider(
  t: TestConvex<typeof schema>,
  room: LoggedRoom,
  incoming: Message,
  llm: LlmProvider,
) {
  const context = await t.query(internal.providerAgent.context, {
    agentId: room.providerId,
    now: NOW,
  });
  return providerTurn(
    {
      self: room.recipient,
      contract: room.contract,
      participants: room.participants,
      history: visibleTo(room, room.recipient),
      incoming,
    },
    context,
    {
      llm,
      book: (slotId) =>
        t.mutation(internal.bookings.book, {
          sessionId: room.sessionId,
          agentId: room.providerId,
          availabilityId: slotId as Id<"availability">,
          now: NOW,
        }),
    },
  );
}
