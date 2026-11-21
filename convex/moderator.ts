import type {
  ModerationInput,
  ModerationOutcome,
  Moderator,
} from "../shared/moderation";

export const allowAllModerator: Moderator = {
  async moderate() {
    return {
      verdict: {
        decision: "allow",
        reason: "Moderador de prueba: permite todo hasta E3.",
      },
      events: [],
    };
  },
};

export function currentModerator(): Moderator {
  return allowAllModerator;
}

const MODERATOR_FAILED: ModerationOutcome = {
  verdict: {
    decision: "block",
    rule: "purpose",
    reason: "El moderador no respondió; el mensaje se bloqueó.",
  },
  events: [
    {
      stage: "purpose",
      action: "block",
      reasons: [
        {
          code: "moderator_error",
          stage: "purpose",
          detail: "the moderator threw instead of returning a verdict",
        },
      ],
    },
  ],
};

export async function moderate(
  input: ModerationInput,
): Promise<ModerationOutcome> {
  try {
    return await currentModerator().moderate(input);
  } catch {
    return MODERATOR_FAILED;
  }
}
