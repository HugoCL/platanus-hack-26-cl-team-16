import type { Moderator } from "../shared/moderation";

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
