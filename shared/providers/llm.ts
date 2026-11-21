import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { embed, generateText, Output } from "ai";
import type { z } from "zod";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type Env,
  type LlmRole,
  modelFor,
} from "../models";

export type LlmPrompt = {
  role: LlmRole;
  system?: string;
  prompt: string;
  abortSignal?: AbortSignal;
};

export interface LlmProvider {
  readonly name: "openrouter" | "fake";
  generateText(args: LlmPrompt): Promise<string>;
  generateObject<T>(args: LlmPrompt & { schema: z.ZodType<T> }): Promise<T>;
  embed(text: string): Promise<number[]>;
}

export function createLlmProvider(env: Env = process.env): LlmProvider {
  const kind = env.LLM_PROVIDER ?? "fake";
  if (kind === "fake") return createFakeLlmProvider();
  if (kind !== "openrouter") {
    throw new Error(`unknown LLM_PROVIDER "${kind}" (use fake or openrouter)`);
  }
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  const openrouter = createOpenRouter({ apiKey });
  const model = (role: LlmRole) => openrouter.chat(modelFor(role, env));

  return {
    name: "openrouter",
    async generateText({ role, system, prompt, abortSignal }) {
      const { text } = await generateText({
        model: model(role),
        system,
        prompt,
        abortSignal,
      });
      return text;
    },
    async generateObject({ role, system, prompt, schema, abortSignal }) {
      const { output } = await generateText({
        model: model(role),
        system,
        prompt,
        output: Output.object({ schema }),
        abortSignal,
      });
      return output;
    },
    async embed(text) {
      const { embedding } = await embed({
        model: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
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

export type FakeLlmScript = {
  text?: (args: LlmPrompt) => string;
  object?: (args: LlmPrompt) => unknown;
};

export function createFakeLlmProvider(script: FakeLlmScript = {}): LlmProvider {
  return {
    name: "fake",
    async generateText(args) {
      return script.text
        ? script.text(args)
        : `[fake ${args.role}] ${args.prompt.slice(0, 200)}`;
    },
    async generateObject(args) {
      if (!script.object) {
        throw new Error("fake LLM: no object response scripted");
      }
      return args.schema.parse(script.object(args));
    },
    async embed(text) {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      for (const token of tokens) {
        let hash = 2166136261;
        for (let i = 0; i < token.length; i++) {
          hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
        }
        vector[(hash >>> 0) % EMBEDDING_DIMENSIONS] += 1;
      }
      const norm = Math.hypot(...vector);
      if (norm === 0) {
        vector[0] = 1;
        return vector;
      }
      return vector.map((x) => x / norm);
    },
  };
}
