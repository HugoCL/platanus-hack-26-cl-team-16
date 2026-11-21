export type LlmRole = "agent" | "moderator" | "conversation_moderator";
export type Env = Record<string, string | undefined>;

export const DEFAULT_MODELS: Record<LlmRole, string> = {
  agent: "anthropic/claude-sonnet-5.5",
  conversation_moderator: "anthropic/claude-haiku-5.5",
  moderator: "anthropic/claude-haiku-5.5",
};

const MODEL_ENV: Record<LlmRole, string> = {
  agent: "AGENT_MODEL",
  moderator: "MODERATOR_MODEL",
  conversation_moderator: "CONVERSATION_MODERATOR_MODEL",
};

export function modelFor(role: LlmRole, env: Env = process.env): string {
  return env[MODEL_ENV[role]] || DEFAULT_MODELS[role];
}

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
