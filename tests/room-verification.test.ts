import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  DEMO_CONTRACT,
  DEMO_PARTICIPANTS,
  DEMO_SCRIPT,
  DEMO_VIEWER,
} from "../src/components/room/demo-session";
import { GenUiBlock } from "../src/components/room/genui-block";
import { RoomView } from "../src/components/room/room-view";

vi.mock("../src/components/header-account", () => ({
  HeaderAccount: () => null,
}));

it("keeps an explicit confirmation action for keyboard slot selection", () => {
  const message = DEMO_SCRIPT.find(
    ({ message }) =>
      message.content.kind === "ui" &&
      message.content.spec.type === "slot_picker",
  )?.message;
  if (message?.content.kind !== "ui") throw new Error("Missing slot picker");
  const html = renderToStaticMarkup(
    createElement(GenUiBlock, {
      spec: message.content.spec,
      canInteract: true,
      onRespond: () => {},
    }),
  );
  expect(html).toContain("Elegir horario");
});

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
