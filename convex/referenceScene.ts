import { ConvexError, v } from "convex/values";
import { chooseProvider } from "../lib/agents/consumer";
import { agentWithRole } from "../lib/agents/turn";
import { MAX_TEXT_LENGTH, type Message } from "../shared/messages";
import { CONSUMER_AGENT_SLUG } from "../shared/seed-data";
import type { Session } from "../shared/session";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { sendThroughGate } from "./gate";
import { referenceLlm } from "./referenceLlm";
import { requireRoomIdentity } from "./roomState";
import { openRoom } from "./rooms";

export const start = action({
  args: { request: v.string(), displayName: v.string() },
  handler: async (
    ctx,
    { request, displayName },
  ): Promise<{
    room: Session;
    opening: Message;
  } | null> => {
    const { tokenIdentifier } = await requireRoomIdentity(ctx);
    const text = request.trim();
    if (!text || text.length > MAX_TEXT_LENGTH) {
      throw new ConvexError({
        kind: "InvalidArgument",
        message: `request must have 1 to ${MAX_TEXT_LENGTH} characters`,
      });
    }
    const llm = referenceLlm();
    if (!llm) {
      throw new ConvexError({
        kind: "NotConfigured",
        message: "reference agents need a model with structured output",
      });
    }
    await ctx.runMutation(internal.moderator.takeOpenerToken, {
      opener: `user:${tokenIdentifier}`,
    });
    const consumer = await ctx.runQuery(api.directory.get, {
      slug: CONSUMER_AGENT_SLUG,
    });
    if (!consumer) {
      throw new ConvexError({ kind: "NotFound", message: "missing consumer" });
    }
    const choice = await chooseProvider(text, {
      llm,
      search: async (query) =>
        (await ctx.runAction(api.directory.searchText, { query })).agents,
    });
    if (!choice) return null;
    const room = await openRoom(
      ctx,
      {
        initiatorAgentId: consumer.agentId as Id<"agents">,
        providerAgentId: choice.agentId as Id<"agents">,
        request: choice.intent.description,
        intent: choice.intent.name,
        human: { displayName },
      },
      { openerTokenTaken: true },
    );
    const initiator = agentWithRole(room.participants, "initiator");
    const provider = agentWithRole(room.participants, "recipient");
    if (!initiator || !provider) throw new Error("missing room agents");
    const opening = await sendThroughGate(ctx, {
      sessionId: room.sessionId as Id<"sessions">,
      senderParticipantId: initiator.participantId as Id<"participants">,
      recipient: provider.participantId as Id<"participants">,
      content: { kind: "text", text: choice.opening },
    });
    return { room, opening };
  },
});
