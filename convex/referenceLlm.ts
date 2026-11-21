import { createLlmProvider, type LlmProvider } from "../shared/providers/llm";

export function referenceLlm(): LlmProvider | null {
  const llm = createLlmProvider();
  return llm.name === "fake" ? null : llm;
}
