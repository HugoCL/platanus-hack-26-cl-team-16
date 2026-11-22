import { consumerTurn } from "../lib/agents/consumer";
import { guestTurn } from "../lib/agents/guest";
import { providerTurn } from "../lib/agents/provider";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import type { RoomAgent } from "./roomAgent";

export const referenceConsumer: RoomAgent = {
  reply: ({ message, llm, ...turn }) =>
    consumerTurn({ ...turn, incoming: message }, { llm }),
};

export function referenceProvider(
  ctx: ActionCtx,
  agentId: Id<"agents">,
): RoomAgent {
  return {
    async reply({ message, llm, ...turn }) {
      const now = Date.now();
      const context = await ctx.runQuery(internal.providerAgent.context, {
        agentId,
        now,
      });
      return providerTurn({ ...turn, incoming: message }, context, {
        llm,
        book: (slotId) =>
          ctx.runMutation(internal.bookings.book, {
            sessionId: message.sessionId as Id<"sessions">,
            agentId,
            availabilityId: slotId as Id<"availability">,
            now,
          }),
      });
    },
  };
}

export function referenceGuest(
  ctx: ActionCtx,
  agentId: Id<"agents">,
): RoomAgent {
  return {
    async reply({ message, llm, ...turn }) {
      const context = await ctx.runQuery(internal.providerAgent.context, {
        agentId,
        now: Date.now(),
      });
      return guestTurn({ ...turn, incoming: message }, context, { llm });
    },
  };
}
