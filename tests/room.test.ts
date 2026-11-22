import { describe, expect, it, vi } from "vitest";
import { UiSpec } from "../shared/genui";
import { Message } from "../shared/messages";
import { SessionContract } from "../shared/session";
import {
  DEMO_CONTRACT,
  DEMO_SCRIPT,
  DEMO_VIEWER,
} from "../src/components/room/demo-session";
import {
  auditMetrics,
  canAnswerUi,
  canSeeContent,
  countViolations,
  describeUiResponse,
  formatLastActivity,
  formatTime,
  groupSlotsByDay,
  initials,
  primaryReason,
  splitRedacted,
  uiInteractionState,
  violationTone,
} from "../src/components/room/room-format";

const messages = DEMO_SCRIPT.map((step) => step.message);

describe("countViolations", () => {
  it("counts only participant blocks unrelated to moderator failures", () => {
    const blocked = {
      ...messages[0],
      senderParticipantId: "agent",
      status: "blocked" as const,
    };
    expect(countViolations([])).toBe(0);
    expect(countViolations([blocked])).toBe(1);
    expect(
      countViolations([
        blocked,
        { ...blocked, status: "allowed" },
        { ...blocked, senderParticipantId: null },
        {
          ...blocked,
          reasons: [
            {
              code: "moderator_error",
              stage: "purpose",
              detail: "Unavailable",
            },
          ],
        },
      ]),
    ).toBe(1);
  });
});
const slotPicker = messages.find(
  (m) => m.content.kind === "ui" && m.content.spec.type === "slot_picker",
);

describe("initials", () => {
  it("preserves graphemes and prefers capitalized words", () => {
    expect(initials("Agendamiento y Reservas")).toBe("AR");
    expect(initials("mi asistente 🦊")).toBe("MA");
    expect(initials("a\u0301ngel pérez")).toBe("A\u0301P");
    expect(initials("")).toBe("");
    expect(initials("🦊")).toBe("");
  });

  it("imports and builds initials without Intl.Segmenter", async () => {
    vi.stubGlobal(
      "Intl",
      Object.create(Intl, { Segmenter: { value: undefined } }),
    );
    vi.resetModules();
    try {
      const { initials } = await import("../src/components/room/room-format");
      expect(initials("Agendamiento y Reservas")).toBe("AR");
      expect(initials("mi asistente 🦊")).toBe("MA");
      expect(initials("𐐨lvaro pérez")).toBe("𐐀P");
      expect(initials("Ángel Pérez".normalize("NFD"))).toBe("ÁP");
      expect(initials("Q\u0301uinn Pérez")).toBe("Q\u0301P");
      expect(initials("")).toBe("");
      expect(initials("🦊")).toBe("");
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe("demo fixture", () => {
  it.each(messages.map((m) => [m.messageId, m] as const))(
    "message %s matches the Message contract",
    (_id, message) => {
      expect(Message.safeParse(message).error?.issues ?? []).toEqual([]);
    },
  );

  it("uses a valid session contract", () => {
    expect(SessionContract.safeParse(DEMO_CONTRACT).success).toBe(true);
  });

  it("covers the §11 moderation states and closes the session", () => {
    const statuses = new Set(messages.map((m) => m.status));
    expect(statuses).toEqual(new Set(["allowed", "redacted", "blocked"]));
    const last = messages.at(-1)?.content;
    expect(last?.kind === "system" && last.code).toBe("session_closed");
  });

  it("pauses on every card the human answers", () => {
    const awaited = DEMO_SCRIPT.filter((s) => s.awaitsResponse).map(
      (s) => s.message.content.kind === "ui" && s.message.content.spec.type,
    );
    expect(awaited).toEqual(["slot_picker", "form", "confirmation"]);
  });
});

describe("GenUI validation", () => {
  it("rejects a component outside the closed catalog", () => {
    expect(
      UiSpec.safeParse({ type: "iframe", id: "x", src: "https://evil" })
        .success,
    ).toBe(false);
  });

  it("rejects a slot picker without slots", () => {
    expect(
      UiSpec.safeParse({ type: "slot_picker", id: "x", title: "t", slots: [] })
        .success,
    ).toBe(false);
  });
});

describe("visibility", () => {
  it("hides a blocked message from the recipient but not from its sender's owner", () => {
    expect(canSeeContent("blocked", "p-clinica", DEMO_VIEWER)).toBe(false);
    expect(canSeeContent("blocked", "p-mi-agente", DEMO_VIEWER)).toBe(true);
    expect(canSeeContent("redacted", "p-clinica", DEMO_VIEWER)).toBe(true);
  });

  it("keeps a pending message from the other side hidden until it is reviewed", () => {
    expect(canSeeContent("pending", "p-clinica", DEMO_VIEWER)).toBe(false);
    expect(canSeeContent("pending", "p-juan", DEMO_VIEWER)).toBe(true);
  });

  it("lets only the owner or operator answer GenUI", () => {
    expect(canAnswerUi({ ...DEMO_VIEWER, role: "owner" })).toBe(true);
    expect(canAnswerUi({ ...DEMO_VIEWER, role: "operator" })).toBe(true);
    expect(canAnswerUi({ ...DEMO_VIEWER, role: "observer" })).toBe(false);
  });

  it("lets only the side a card was sent to answer it", () => {
    const [own] = DEMO_VIEWER.ownParticipantIds;
    expect(canAnswerUi(DEMO_VIEWER, own)).toBe(true);
    expect(canAnswerUi(DEMO_VIEWER, "someone-else")).toBe(false);
  });
});

describe("GenUI interaction state", () => {
  it.each(["owner", "operator", "observer"] as const)(
    "distinguishes role permissions from read-only cards for %s",
    (role) => {
      const canInteract = canAnswerUi({ ...DEMO_VIEWER, role });
      expect(uiInteractionState(canInteract, false, false)).toEqual({
        disabled: role === "observer",
        showOwnerOnly: role === "observer",
      });
      expect(uiInteractionState(canInteract, true, false)).toEqual({
        disabled: true,
        showOwnerOnly: role === "observer",
      });
      expect(uiInteractionState(canInteract, false, true)).toEqual({
        disabled: true,
        showOwnerOnly: false,
      });
    },
  );
});

describe("formatLastActivity", () => {
  const now = Date.parse("2026-11-22T16:20:00-03:00");
  it.each([
    ["2026-11-22T09:05:00-03:00", "09:05"],
    ["2026-11-21T16:20:00-03:00", "Sáb 21"],
    ["2026-03-22T12:00:00-03:00", "22 mar"],
    ["2026-02-22T09:30:00-03:00", "22 feb"],
    ["2025-11-22T10:00:00-03:00", "22 nov 2025"],
    ["2020-11-22T10:00:00-03:00", "22 nov 2020"],
  ])("formats %s as %s", (at, label) => {
    expect(formatLastActivity(Date.parse(at), now)).toBe(label);
  });

  it("includes the year for recent activity on the previous Santiago year", () => {
    const at = Date.parse("2026-01-01T02:59:00Z");
    const nextYear = Date.parse("2026-01-01T03:01:00Z");
    expect(formatLastActivity(at, nextYear)).toBe("31 dic 2025");
  });
});

describe("formatting", () => {
  it("shows 24h Santiago time", () => {
    expect(formatTime("2026-11-26T13:30:00Z")).toBe("10:30");
  });

  it("describes a chosen slot", () => {
    if (slotPicker?.content.kind !== "ui") throw new Error("no slot picker");
    expect(
      describeUiResponse(
        { type: "slot_selected", pickerId: "slots-cardio", slotId: "s2" },
        slotPicker.content.spec,
      ),
    ).toBe("Eligió: Jue 26, 10:30 – Dra. Carolina Muñoz");
  });

  it("groups slots by day in order", () => {
    if (slotPicker?.content.kind !== "ui") throw new Error("no slot picker");
    const spec = slotPicker.content.spec;
    if (spec.type !== "slot_picker") throw new Error("wrong spec");
    expect(groupSlotsByDay(spec.slots).map((d) => d.slots.length)).toEqual([
      1, 2,
    ]);
  });

  it("names form fields by label, not by value", () => {
    expect(
      describeUiResponse({
        type: "form_submit",
        formId: "f",
        values: { rut: "11.111.111-1" },
      }),
    ).toBe("Envió: rut");
  });

  it("splits redacted text into hidden and visible parts", () => {
    expect(splitRedacted("pide el RUT y ████.")).toEqual([
      { at: 0, text: "pide el RUT y ", hidden: false },
      { at: 14, text: "████", hidden: true },
      { at: 18, text: ".", hidden: false },
    ]);
  });
});

describe("moderation summary", () => {
  it("turns the violation counter amber past half and red at the max", () => {
    expect(violationTone(1, 3)).toBe("neutral");
    expect(violationTone(2, 3)).toBe("warning");
    expect(violationTone(3, 3)).toBe("danger");
  });

  it("picks the highest-scoring reason", () => {
    const blocked = messages.find((m) => m.status === "blocked");
    expect(primaryReason(blocked?.reasons)?.code).toBe("prompt_injection");
  });

  it("prefers confirmed violations over moderator errors, then orders by score", () => {
    const error = {
      code: "moderator_error",
      stage: "injection",
      detail: "Falló la verificación.",
      score: 1,
    } as const;
    const leak = {
      code: "data_leak",
      stage: "purpose",
      detail: "Datos no permitidos.",
    } as const;
    const purpose = {
      code: "off_purpose",
      stage: "purpose",
      detail: "Fuera de propósito.",
      score: 0.8,
    } as const;
    expect(primaryReason([error, leak])).toBe(leak);
    expect(primaryReason([leak, error])).toBe(leak);
    expect(primaryReason([error, leak, purpose])).toBe(purpose);
    expect(primaryReason([error])).toBe(error);
    expect(primaryReason([])).toBeUndefined();
    expect(primaryReason()).toBeUndefined();
  });

  it("counts reviewed messages and interventions", () => {
    const metrics = auditMetrics(messages);
    expect(metrics.reviewed).toBe(8);
    expect(metrics.interventions).toBe(2);
    expect(metrics.averageLatencyMs).toBeGreaterThan(0);
  });
});
