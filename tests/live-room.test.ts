import { describe, expect, it } from "vitest";
import type { Session } from "../shared/session";
import { DEMO_CONTRACT } from "../src/components/room/demo-session";
import {
  agentTurnsExhausted,
  liveAnswers,
  mapLiveRoom,
  openRoomError,
  sendError,
} from "../src/components/room/live-room";
import {
  type RoomMessage,
  responseTargetId,
} from "../src/components/room/room-format";

const session: Session = {
  sessionId: "room",
  status: "active",
  mode: "moderated",
  intent: DEMO_CONTRACT.intent,
  contract: DEMO_CONTRACT,
  turnCount: 0,
  participants: [
    {
      participantId: "consumer",
      kind: "agent",
      agentId: "a1",
      role: "initiator",
    },
    {
      participantId: "provider",
      kind: "agent",
      agentId: "a2",
      role: "recipient",
    },
    {
      participantId: "human",
      kind: "human",
      displayName: "Ana",
      role: "owner",
    },
    {
      participantId: "observer",
      kind: "human",
      displayName: "Luis",
      role: "observer",
    },
  ],
};
const names = [
  { participantId: "consumer", name: "Mi agente", slug: "consumer" },
  { participantId: "provider", name: "Clínica", slug: "clinic" },
  { participantId: "human", name: "Ana" },
];

describe("agent turn limit", () => {
  it("leaves answers editable before the limit", () => {
    expect(agentTurnsExhausted(session)).toBe(false);
    expect(
      agentTurnsExhausted({
        ...session,
        turnCount: DEMO_CONTRACT.maxTurns - 1,
      }),
    ).toBe(false);
  });

  it.each([0, 1])("disables answers at or past the limit (+%s)", (extra) => {
    const exhausted = {
      ...session,
      turnCount: DEMO_CONTRACT.maxTurns + extra,
    };
    expect(agentTurnsExhausted(exhausted)).toBe(true);
    expect(mapLiveRoom(exhausted, names, "human").answersReadOnly).toBe(true);
  });

  it("handles a room without a contract", () => {
    expect(agentTurnsExhausted({ ...session, contract: null })).toBe(false);
  });
});

describe("live room mapping", () => {
  it("assigns the caller and initiator to self, with names and representation", () => {
    const mapped = mapLiveRoom(session, names, "human");
    expect(mapped.viewer).toEqual({
      role: "owner",
      ownParticipantIds: ["human", "consumer"],
    });
    expect(mapped.participants).toEqual([
      {
        participantId: "consumer",
        name: "Mi agente",
        kind: "agent",
        side: "self",
      },
      {
        participantId: "provider",
        name: "Clínica",
        kind: "agent",
        side: "other",
      },
      {
        participantId: "human",
        name: "Ana",
        kind: "human",
        side: "self",
        onBehalfOf: "Mi agente",
      },
      { participantId: "observer", name: "Luis", kind: "human", side: "other" },
    ]);
    expect(mapped.contract).toBe(DEMO_CONTRACT);
  });

  it.each(["active", "closed", "terminated", "requested"] as const)(
    "preserves %s so only active rooms allow input",
    (status) => {
      expect(
        mapLiveRoom({ ...session, status, contract: null }, [], "human"),
      ).toMatchObject({ status, contract: null });
    },
  );

  it("handles empty participants and missing names", () => {
    expect(
      mapLiveRoom({ ...session, participants: [] }, [], "human").participants,
    ).toEqual([]);
    expect(mapLiveRoom(session, [], "human").participants[0].name).toBe(
      "Agente",
    );
  });

  it("derives answers only from allowed responses", () => {
    const response: RoomMessage = {
      messageId: "answer",
      sessionId: "room",
      senderParticipantId: "human",
      recipient: "provider",
      status: "allowed",
      verdict: null,
      sentAt: 123,
      content: {
        kind: "ui_response",
        inReplyTo: "card-message",
        response: {
          type: "confirmation",
          confirmationId: "card",
          confirmed: true,
        },
      },
    };
    const messages = [response];
    const answers = liveAnswers(messages);
    if (response.content.kind !== "ui_response")
      throw new Error("missing response fixture");
    expect(answers[responseTargetId(response.content.response)]).toEqual({
      response: response.content.response,
      at: response.sentAt,
    });
    expect(liveAnswers([])).toEqual({});
    expect(liveAnswers([{ ...response, status: "blocked" }])).toEqual({});
    expect(liveAnswers([{ ...response, status: "pending" }])).toEqual({});
  });

  it.each([
    ["RateLimited", "Demasiados mensajes. Espera un momento."],
    ["RoomClosed", "La sala está cerrada."],
    ["InvalidArgument", "Revisa el mensaje o la respuesta."],
  ])("explains %s", (kind, message) => {
    expect(sendError({ data: { kind } })).toBe(message);
  });
  it("handles unexpected errors", () => {
    expect(sendError(new Error("private details"))).toBe(
      "No se pudo completar la acción. Inténtalo de nuevo.",
    );
    expect(sendError(null)).toBe(sendError({}));
  });

  it.each([
    ["RateLimited", "Demasiados mensajes. Espera un momento."],
    [
      "InvalidArgument",
      "Revisa la intención y la descripción de la solicitud.",
    ],
    ["NotFound", "No se encontró el agente. Vuelve al directorio."],
    ["Unauthorized", "Inicia sesión para abrir una sala."],
  ])("explains opening errors: %s", (kind, message) => {
    expect(openRoomError({ data: { kind } })).toBe(message);
  });

  it("includes the moderator reason without exposing other errors", () => {
    expect(
      openRoomError({
        data: { kind: "RequestBlocked", message: "Fuera del propósito" },
      }),
    ).toBe("El moderador rechazó la solicitud: Fuera del propósito");
    expect(openRoomError({ data: { kind: "RequestBlocked" } })).toBe(
      "El moderador rechazó la solicitud.",
    );
    expect(
      openRoomError({ data: { kind: "RequestBlocked", message: {} } }),
    ).toBe("El moderador rechazó la solicitud.");
    expect(openRoomError(new Error("private details"))).toBe(sendError(null));
    expect(openRoomError(null)).toBe(sendError(null));
  });
});
