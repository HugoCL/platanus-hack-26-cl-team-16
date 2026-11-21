import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  DEMO_CONTRACT,
  DEMO_PARTICIPANTS,
  DEMO_VIEWER,
} from "../src/components/room/demo-session";
import { RoomView } from "../src/components/room/room-view";

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
