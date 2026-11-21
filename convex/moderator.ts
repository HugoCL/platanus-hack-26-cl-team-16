import {
  isRateLimitError,
  MINUTE,
  RateLimiter,
} from "@convex-dev/rate-limiter";
import { type ObjectType, v } from "convex/values";
import { modelFor } from "../shared/models";
import type { ModerationInput, ModerationOutcome } from "../shared/moderation";
import { createModerator } from "../shared/moderator/moderator";
import { createLlmProvider } from "../shared/providers/llm";
import { components, internal } from "./_generated/api";
import { type ActionCtx, internalMutation } from "./_generated/server";

const MODERATOR_FAILED: ModerationOutcome = {
  verdict: {
    decision: "block",
    rule: "purpose",
    reason: "El moderador falló; el mensaje se bloqueó.",
  },
  events: [
    {
      stage: "purpose",
      action: "block",
      reasons: [
        {
          code: "moderator_error",
          stage: "purpose",
          detail: "No se pudo completar la moderación.",
        },
      ],
    },
  ],
};

export const judgeRateLimiter = new RateLimiter(components.rateLimiter, {
  roomJudgeSender: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 20,
  },
  roomJudgeRoom: {
    kind: "token bucket",
    rate: 40,
    period: MINUTE,
    capacity: 40,
  },
});

const judgeBuckets = { sender: v.string(), room: v.string() };
export type JudgeBuckets = ObjectType<typeof judgeBuckets>;

export const takeJudgeTokens = internalMutation({
  args: { ...judgeBuckets, sender: v.optional(v.string()), count: v.number() },
  handler: async (ctx, { sender, room, count }) => {
    if (sender !== undefined) {
      await judgeRateLimiter.limit(ctx, "roomJudgeSender", {
        key: sender,
        count,
        throws: true,
      });
    }
    await judgeRateLimiter.limit(ctx, "roomJudgeRoom", {
      key: room,
      count,
      throws: true,
    });
  },
});

export const takeOpenerToken = internalMutation({
  args: { opener: v.string() },
  handler: async (ctx, { opener }) => {
    await judgeRateLimiter.limit(ctx, "roomJudgeSender", {
      count: 2,
      key: opener,
      throws: true,
    });
  },
});

export async function judgeRetryAfter(
  ctx: ActionCtx,
  { sender, room }: JudgeBuckets,
): Promise<number | undefined> {
  const statuses = [
    await judgeRateLimiter.check(ctx, "roomJudgeSender", {
      key: sender,
      count: 2,
    }),
    await judgeRateLimiter.check(ctx, "roomJudgeRoom", { key: room, count: 2 }),
  ];
  const waits = statuses.flatMap((status) =>
    status.ok ? [] : [status.retryAfter],
  );
  return waits.length > 0 ? Math.max(...waits) : undefined;
}

export async function moderate(
  ctx: ActionCtx,
  input: ModerationInput,
  buckets: Omit<JudgeBuckets, "sender"> & { sender?: string },
): Promise<ModerationOutcome> {
  try {
    const llm = createLlmProvider();
    return await createModerator({
      llm,
      model: llm.name === "fake" ? "fake" : modelFor("moderator"),
      conversationModel:
        llm.name === "fake" ? "fake" : modelFor("conversation_moderator"),
      beforeJudge: async (count) => {
        await ctx.runMutation(internal.moderator.takeJudgeTokens, {
          ...buckets,
          count,
        });
      },
    }).moderate(input);
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    return MODERATOR_FAILED;
  }
}
