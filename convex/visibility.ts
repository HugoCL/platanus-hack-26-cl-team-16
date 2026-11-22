import type { Message } from "../shared/messages";
import { DELIVERABLE_STATUSES } from "../shared/moderation";
import type { Participant } from "../shared/session";

// The guest agent a human is in the room for, if any. Such a human was invited into someone
// else's room, so they do not audit it: they see withheld messages of their own side only.
export function guestOf(viewer: Participant, participants: Participant[]) {
  if (viewer.kind !== "human") return undefined;
  return participants.find(
    (p) =>
      p.kind === "agent" &&
      p.role === "guest" &&
      p.agentId === viewer.onBehalfOfAgentId,
  );
}

export function visibleTo(
  message: Message,
  viewer: Participant,
  participants: Participant[],
): boolean {
  const guest = guestOf(viewer, participants);
  const audits = viewer.kind === "human" && !guest;
  const own: string[] = [viewer.participantId];
  if (guest) own.push(guest.participantId);
  if (
    message.content.kind === "ui" &&
    message.content.spec.type === "moderator_alert"
  ) {
    return audits || own.includes(message.recipient);
  }
  if (message.status === "blocked") {
    return (
      audits ||
      (message.senderParticipantId !== null &&
        own.includes(message.senderParticipantId))
    );
  }
  return DELIVERABLE_STATUSES.includes(message.status);
}
