import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  DEMO_CONTRACT,
  DEMO_PARTICIPANTS,
  DEMO_SCRIPT,
  DEMO_VIEWER,
} from "../src/components/room/demo-session";
import { MessageItem } from "../src/components/room/message-item";
import { RoomView } from "../src/components/room/room-view";

vi.mock("../src/components/header-account", () => ({
  HeaderAccount: () => null,
}));

it("keeps block reasons reachable when the sender can see the original card", () => {
  const message = DEMO_SCRIPT.find(
    ({ message }) => message.content.kind === "ui",
  )?.message;
  if (!message) throw new Error("Missing UI message");
  const html = renderToStaticMarkup(
    createElement(MessageItem, {
      message: {
        ...message,
        senderParticipantId: "self",
        status: "blocked",
        reasons: [
          {
            code: "off_purpose",
            stage: "purpose",
            detail: "Fuera del contrato",
          },
        ],
      },
      viewer: { role: "owner", ownParticipantIds: ["self"] },
      answers: {},
      uiSpecsByMessage: {},
      onRespond: () => {},
      onShowAudit: () => {},
    }),
  );
  expect(html).toContain("Bloqueado: ver razones del moderador");
});

it.each([0, 1])(
  "uses the live violation counter (%s), not blocked history",
  (violationCount) => {
    const message = DEMO_SCRIPT[0].message;
    const html = renderToStaticMarkup(
      createElement(RoomView, {
        participants: DEMO_PARTICIPANTS,
        viewer: DEMO_VIEWER,
        contract: DEMO_CONTRACT,
        status: "active",
        messages: [{ ...message, status: "blocked" }],
        violationCount,
        answers: {},
        onRespond: () => {},
        onSendText: () => {},
      }),
    );
    expect(html.includes("La sala se")).toBe(violationCount > 0);
    expect(html.includes("El moderador bloqueó")).toBe(violationCount > 0);
  },
);

it.each([true, false, undefined])(
  "shows the room badge only for an explicitly verified agent (%s)",
  (verified) => {
    const html = renderToStaticMarkup(
      createElement(RoomView, {
        participants: DEMO_PARTICIPANTS.map((p) =>
          p.side === "other" ? { ...p, verified } : p,
        ),
        viewer: DEMO_VIEWER,
        contract: DEMO_CONTRACT,
        status: "active",
        messages: [],
        answers: {},
        onRespond: () => {},
        onSendText: () => {},
      }),
    );
    expect(html.includes('aria-label="Verificada"')).toBe(verified === true);
  },
);
