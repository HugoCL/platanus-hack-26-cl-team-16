import { modelFor } from "../shared/models";
import type { ModerationInput, ModerationOutcome } from "../shared/moderation";
import { createModerator } from "../shared/moderator/moderator";
import { createLlmProvider } from "../shared/providers/llm";

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

export async function moderate(
  input: ModerationInput,
): Promise<ModerationOutcome> {
  try {
    const llm = createLlmProvider();
    return await createModerator({
      llm,
      model: llm.name === "fake" ? "fake" : modelFor("moderator"),
    }).moderate(input);
  } catch {
    return MODERATOR_FAILED;
  }
}
