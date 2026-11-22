import type { RoomMessage } from "../room/room-format";
import type { ReplayStep } from "./room-replay-script";

// Turns the replay script into frames: what the room shows at each beat and for how long. Each
// agent message plays as three beats (its sender types, the moderator reviews it, it lands), so
// the replay shows the moderator ruling on every message before anyone else sees it.

export const TYPING_MS = 800;
export const REVIEW_MS = 1200;
export const HOLD_MS = 1500;
export const NOTICE_MS = 1100;
// Pause on the last frame before the loop starts over.
export const REST_MS = 5000;

export type ReplayFrame = {
  messages: RoomMessage[];
  typing?: string;
  holdMs: number;
};

export function buildReplayFrames(script: ReplayStep[]): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  let messages: RoomMessage[] = [];
  const push = (holdMs: number, typing?: string) =>
    frames.push({ messages, typing, holdMs });

  for (const { message, holdMs } of script) {
    if (message.senderParticipantId === null) {
      messages = [...messages, message];
      push(holdMs ?? NOTICE_MS);
      continue;
    }
    push(TYPING_MS, message.senderParticipantId);
    messages = [...messages, underReview(message)];
    push(REVIEW_MS);
    messages = [...messages.slice(0, -1), message];
    push(holdMs ?? HOLD_MS);
  }
  return frames;
}

// The message as it waits for the moderator. A message the moderator will redact already shows
// its redacted text, so the replay never flashes the data it is about to hide.
function underReview(message: RoomMessage): RoomMessage {
  const { content, redactedText } = message;
  return {
    ...message,
    content:
      content.kind === "text" && redactedText
        ? { ...content, text: redactedText }
        : content,
    status: "pending",
    verdict: null,
    reasons: undefined,
    redactedText: undefined,
  };
}
