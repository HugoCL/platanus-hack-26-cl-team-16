import type { Message } from "../shared/messages";
import { DELIVERABLE_STATUSES } from "../shared/moderation";
import { carriesRut } from "../shared/moderator/rules";
import type { Participant } from "../shared/session";

// The guest agent a viewer sees the room as: itself, or the one a human is in the room for.
// That side was invited into someone else's room, so it does not audit it.
export function guestOf(viewer: Participant, participants: Participant[]) {
  const agentId =
    viewer.kind === "agent" ? viewer.agentId : viewer.onBehalfOfAgentId;
  return participants.find(
    (p): p is Extract<Participant, { kind: "agent" }> =>
      p.kind === "agent" && p.role === "guest" && p.agentId === agentId,
  );
}

// A guest side sees its own messages, and of the rest only what was delivered after it joined
// and carries no RUT: the room lets the consumer hand a RUT to the provider, not to a guest.
export function visibleTo(
  message: Message,
  viewer: Participant,
  participants: Participant[],
): boolean {
  const guest = guestOf(viewer, participants);
  const audits = viewer.kind === "human" && !guest;
  const own: string[] = [viewer.participantId];
  if (guest) own.push(guest.participantId);
  const mine =
    message.senderParticipantId !== null &&
    own.includes(message.senderParticipantId);
  if (
    message.content.kind === "ui" &&
    message.content.spec.type === "moderator_alert"
  ) {
    return audits || own.includes(message.recipient);
  }
  if (message.status === "blocked") return audits || mine;
  if (!DELIVERABLE_STATUSES.includes(message.status)) return false;
  if (!guest || mine) return true;
  return (
    message.sentAt >= (guest.joinedAt ?? 0) && !carriesRut(message.content)
  );
}
