import type { Session } from "@/shared/session";
import type { GenUiAnswer } from "./genui-block";
import {
  type RoomMessage,
  type RoomParticipant,
  responseTargetId,
  type Viewer,
} from "./room-format";

export function agentTurnsExhausted(session: Session) {
  return (
    session.contract !== null && session.turnCount >= session.contract.maxTurns
  );
}

export function mapLiveRoom(
  session: Session,
  names: {
    participantId: string;
    name: string;
    slug?: string;
    verified?: boolean;
  }[],
  humanParticipantId: string,
) {
  const nameOf = (id: string) =>
    names.find((p) => p.participantId === id)?.name;
  const human = session.participants.find(
    (p) => p.participantId === humanParticipantId,
  );
  const ownAgentId = human?.kind === "human" && human.onBehalfOfAgentId;
  // The viewer's agent: the one they are here for, which for an invited friend is the guest.
  const ownAgent =
    session.participants.find(
      (p) => p.kind === "agent" && p.agentId === ownAgentId,
    ) ??
    session.participants.find(
      (p) => p.kind === "agent" && p.role === "initiator",
    );
  const ownParticipantIds = [
    humanParticipantId,
    ...(ownAgent ? [ownAgent.participantId] : []),
  ];
  const participants: RoomParticipant[] = session.participants.map((p) => ({
    participantId: p.participantId,
    name:
      nameOf(p.participantId) ??
      (p.kind === "human" ? p.displayName : "Agente"),
    kind: p.kind,
    ...(p.kind === "agent"
      ? {
          verified:
            names.find((name) => name.participantId === p.participantId)
              ?.verified === true,
        }
      : {}),
    side: ownParticipantIds.includes(p.participantId) ? "self" : "other",
    ...(p.kind === "human" && p.participantId === humanParticipantId && ownAgent
      ? { onBehalfOf: nameOf(ownAgent.participantId) ?? "Agente" }
      : {}),
  }));
  const viewer: Viewer = { role: "owner", ownParticipantIds };
  return {
    participants,
    viewer,
    contract: session.contract,
    status: session.status,
    answersReadOnly: agentTurnsExhausted(session),
  };
}

export function liveAnswers(messages: RoomMessage[]) {
  const answers: Record<string, GenUiAnswer> = {};
  for (const m of messages) {
    if (m.content.kind === "ui_response" && m.status === "allowed") {
      answers[responseTargetId(m.content.response)] = {
        response: m.content.response,
        at: m.sentAt,
      };
    }
  }
  return answers;
}

export function sendError(error: unknown) {
  const kind = (error as { data?: { kind?: string } } | null)?.data?.kind;
  switch (kind) {
    case "RateLimited":
      return "Demasiados mensajes. Espera un momento.";
    case "RoomClosed":
      return "La sala está cerrada.";
    case "InvalidArgument":
      return "Revisa el mensaje o la respuesta.";
    default:
      return "No se pudo completar la acción. Inténtalo de nuevo.";
  }
}

export function inviteError(error: unknown) {
  const kind = (error as { data?: { kind?: string } } | null)?.data?.kind;
  switch (kind) {
    case "NotFriend":
      return "Solo puedes invitar agentes de tus amigos.";
    case "AlreadyInvited":
      return "Ese agente ya tiene una invitación pendiente.";
    case "AlreadyParticipant":
      return "Ese agente ya está en la sala.";
    case "AlreadyAnswered":
      return "Esa invitación ya fue respondida.";
    case "OwnerHasGuest":
      return "Ese amigo ya tiene un agente en la sala.";
    case "RoomFull":
      return "La sala está llena.";
    case "RoomNotActive":
      return "La sala está cerrada.";
    default:
      return sendError(error);
  }
}

// The agent's owner answering an invitation: the same failures, read from their side.
export function respondError(error: unknown) {
  const kind = (error as { data?: { kind?: string } } | null)?.data?.kind;
  return kind === "NotFriend"
    ? "Ya no eres amigo de quien te invitó, así que no puedes aprobar esta invitación."
    : inviteError(error);
}

export function openRoomError(error: unknown) {
  const data = (error as { data?: { kind?: string; message?: unknown } } | null)
    ?.data;
  switch (data?.kind) {
    case "RequestBlocked":
      return `El moderador rechazó la solicitud${typeof data.message === "string" && data.message ? `: ${data.message}` : "."}`;
    case "InvalidArgument":
      return "Revisa la intención y la descripción de la solicitud.";
    case "NotFound":
      return "No se encontró el agente. Vuelve al directorio.";
    case "Unauthorized":
      return "Inicia sesión para abrir una sala.";
    default:
      return sendError(error);
  }
}
