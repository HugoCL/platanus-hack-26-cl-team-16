import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEMO_CONTRACT,
  DEMO_PARTICIPANTS,
  DEMO_SCRIPT,
  DEMO_VIEWER,
} from "../src/components/room/demo-session";
import { RoomComposer } from "../src/components/room/room-composer";
import {
  countAgentTurns,
  openingNotice,
  type RoomMessage,
  violationOrdinals,
} from "../src/components/room/room-format";
import { RoomView } from "../src/components/room/room-view";

const messages = DEMO_SCRIPT.map((step) => step.message);

function composer(props: Partial<Parameters<typeof RoomComposer>[0]>) {
  return renderToStaticMarkup(
    createElement(RoomComposer, {
      readOnly: false,
      control: false,
      canControl: true,
      selfName: "Mi agente (Juan)",
      onTakeControl: () => {},
      onReturnControl: () => {},
      onSend: () => {},
      ...props,
    }),
  );
}

describe("room composer", () => {
  it("offers Tomar control and no text field while the agent speaks", () => {
    const html = composer({});
    expect(html).toContain("Tu agente está hablando por ti.");
    expect(html).toContain("Tomar control");
    expect(html).not.toContain("<textarea");
  });

  it("shows the field and who you speak as after taking control", () => {
    const html = composer({ control: true });
    expect(html).toContain("<textarea");
    expect(html).toContain("Devolver control");
    expect(html).toContain("Mi agente (Juan)");
    expect(html).not.toContain("Tomar control");
  });

  it("says Enviando… while a message is on its way", () => {
    expect(composer({ control: true, sending: true })).toContain("Enviando…");
    expect(composer({ control: true })).not.toContain("Enviando…");
  });

  it("gives an observer one sentence, and neither the button nor the field", () => {
    const html = composer({ control: true, canControl: false });
    expect(html).toContain("Estás observando esta sala.");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Tomar control");
  });
});

describe("room header and notices", () => {
  const html = renderToStaticMarkup(
    createElement(RoomView, {
      participants: DEMO_PARTICIPANTS,
      viewer: DEMO_VIEWER,
      contract: DEMO_CONTRACT,
      status: "active",
      messages,
      answers: {},
      onRespond: () => {},
      onSendText: () => {},
    }),
  );

  it("names the intent in words in the opening notice, never its code", () => {
    expect(html).toContain("sala abierta · contrato: agendar hora");
    expect(html).not.toContain("contrato: book");
  });

  it("always shows the turn and the faults in the header", () => {
    expect(html).toMatch(/turno <b>\d+<\/b> de (<!-- -->)?12/);
    expect(html).toMatch(/faltas <b>1<\/b> de (<!-- -->)?3/);
  });

  it("writes an edit and a block under the message", () => {
    expect(html).toContain("El moderador editó este mensaje.");
    expect(html).toContain("El moderador bloqueó este mensaje.");
    expect(html).toContain("Falta 1 de 3.");
  });
});

describe("room format", () => {
  const blocked = (id: string, extra: Partial<RoomMessage> = {}) =>
    ({
      ...messages[1],
      messageId: id,
      status: "blocked",
      ...extra,
    }) as RoomMessage;

  it("numbers faults in order and skips moderator failures", () => {
    const ordinals = violationOrdinals([
      blocked("a"),
      blocked("b", {
        reasons: [{ code: "moderator_error", stage: "purpose", detail: "" }],
      }),
      blocked("c"),
    ]);
    expect([...ordinals]).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });

  it("counts one turn per agent message, as the gate does", () => {
    const agents = messages.filter(
      (m) =>
        m.senderParticipantId !== null &&
        DEMO_PARTICIPANTS.find((p) => p.participantId === m.senderParticipantId)
          ?.kind === "agent",
    );
    expect(countAgentTurns(messages, DEMO_PARTICIPANTS)).toBe(agents.length);
    expect(countAgentTurns(messages, [])).toBe(0);
  });

  it("falls back to readable words for an intent with no label", () => {
    expect(openingNotice(messages[0].sentAt, "request_refund")).toContain(
      "contrato: request refund",
    );
  });
});
