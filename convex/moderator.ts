import {
  isRateLimitError,
  MINUTE,
  RateLimiter,
} from "@convex-dev/rate-limiter";
import { modelFor } from "../shared/models";
import type { ModerationInput, ModerationOutcome } from "../shared/moderation";
import { createModerator } from "../shared/moderator/moderator";
import { createLlmProvider } from "../shared/providers/llm";
import { components } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

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

const rateLimiter = new RateLimiter(components.rateLimiter, {
  roomJudgeSender: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  roomJudgeRoom: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 20,
  },
});

export type JudgeBuckets = { sender: string; room: string };

export async function moderate(
  ctx: ActionCtx,
  input: ModerationInput,
  buckets: JudgeBuckets,
): Promise<ModerationOutcome> {
  const limits = [
    ["roomJudgeSender", buckets.sender],
    ["roomJudgeRoom", buckets.room],
  ] as const;
  try {
    const llm = createLlmProvider();
    return await createModerator({
      llm,
      model: llm.name === "fake" ? "fake" : modelFor("moderator"),
      beforeJudge: async () => {
        for (const [name, key] of limits) {
          await rateLimiter.check(ctx, name, { key, throws: true });
        }
        for (const [name, key] of limits) {
          await rateLimiter.limit(ctx, name, { key, throws: true });
        }
      },
    }).moderate(input);
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    return MODERATOR_FAILED;
  }
}
