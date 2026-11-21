export const LLM_MODELS = {
  fast: "anthropic/claude-haiku-5.5",
  smart: "anthropic/claude-sonnet-5.5",
} as const;
export type LlmTier = keyof typeof LLM_MODELS;

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
