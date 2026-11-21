import type { Message } from "../shared/messages";
import { DELIVERABLE_STATUSES } from "../shared/moderation";
import type { Participant } from "../shared/session";

export function visibleTo(message: Message, viewer: Participant): boolean {
  if (
    message.content.kind === "ui" &&
    message.content.spec.type === "moderator_alert"
  ) {
    return (
      viewer.kind === "human" || message.recipient === viewer.participantId
    );
  }
  if (message.status === "blocked") {
    return (
      viewer.kind === "human" ||
      message.senderParticipantId === viewer.participantId
    );
  }
  return DELIVERABLE_STATUSES.includes(message.status);
}
