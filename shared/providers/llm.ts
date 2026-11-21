import { createGateway, embed, generateText, Output } from "ai";
import type { z } from "zod";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  LLM_MODELS,
  type LlmTier,
} from "../models";

type Prompt = { system?: string; prompt: string; tier?: LlmTier };

export interface LlmProvider {
  generateText(args: Prompt): Promise<string>;
  generateObject<T>(args: Prompt & { schema: z.ZodType<T> }): Promise<T>;
  embed(text: string): Promise<number[]>;
}

export function createGatewayLlmProvider(
  apiKey = process.env.AI_GATEWAY_API_KEY,
): LlmProvider {
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is not set");
  }
  const gateway = createGateway({ apiKey });
  const model = (tier: LlmTier = "fast") => gateway(LLM_MODELS[tier]);

  return {
    async generateText({ system, prompt, tier }) {
      const { text } = await generateText({
        model: model(tier),
        system,
        prompt,
      });
      return text;
    },
    async generateObject({ system, prompt, tier, schema }) {
      const { output } = await generateText({
        model: model(tier),
        system,
        prompt,
        output: Output.object({ schema }),
      });
      return output;
    },
    async embed(text) {
      const { embedding } = await embed({
        model: gateway.embeddingModel(EMBEDDING_MODEL),
        value: text,
      });
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `expected ${EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}`,
        );
      }
      return embedding;
    },
  };
}
