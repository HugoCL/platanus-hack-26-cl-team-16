// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { referenceLlm } from "../../convex/referenceLlm";
import schema from "../../convex/schema";
import { DEMO_PROVIDER_SLUG, DEMO_SCRIPT } from "../../shared/demo-pcb";
import * as providers from "../../shared/providers/llm";
import { errorKind } from "./roomFixture";

vi.mock("../../convex/referenceLlm", () => ({ referenceLlm: vi.fn() }));

const modules = import.meta.glob("../../convex/**/*.ts");
const QUOTE = "Cotización en firme: USD 323 en total.";

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  vi.useFakeTimers();
  // An unseeded deployment, like production: reset has to bring everything the room needs.
  t = convexTest({ schema, modules });
  rateLimiter.register(t);
  const llm = providers.createFakeLlmProvider({
    object: (args) =>
      args.role === "agent"
        ? { action: "reply", offerings: [], text: QUOTE }
        : { decision: "allow", rule: "purpose" },
  });
  vi.spyOn(providers, "createLlmProvider").mockReturnValue(llm);
  vi.mocked(referenceLlm).mockReturnValue(llm);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ana = () => t.withIdentity({ subject: "ana", name: "Ana Rojas" });
const li = () => t.withIdentity({ subject: "li", name: "Li Wei" });
const caro = () => t.withIdentity({ subject: "caro", name: "Caro Vidal" });

const reset = () => t.mutation(internal.demo.reset, {});
const history = (as: ReturnType<typeof ana>, sessionId: Id<"sessions">) =>
  as.query(api.gate.history, { sessionId });
const texts = async (as: ReturnType<typeof ana>, sessionId: Id<"sessions">) =>
  (await history(as, sessionId)).flatMap((m) =>
    m.content.kind === "text" ? [m.content.text] : [],
  );
const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);

async function seated() {
  const { sessionId } = await reset();
  await ana().mutation(api.demo.join, { seat: "buyer" });
  await li().mutation(api.demo.join, { seat: "merchant" });
  return sessionId;
}

describe("demo room", () => {
  it("stays off until someone runs reset", async () => {
    expect(await ana().query(api.demo.state, {})).toBeNull();
    expect(
      await errorKind(ana().mutation(api.demo.join, { seat: "buyer" })),
    ).toBe("NotFound");
    expect(await errorKind(ana().mutation(api.demo.restart, {}))).toBe(
      "NotFound",
    );
  });

  it("opens mid-conversation with the manufacturer's form waiting for the buyer", async () => {
    const sessionId = await seated();
    const messages = await history(ana(), sessionId);
    expect(messages).toHaveLength(DEMO_SCRIPT.length + 1);
    expect(messages.at(-1)?.content).toMatchObject({
      kind: "ui",
      spec: { type: "form", id: "pedido-pcb" },
    });
    const view = await li().query(api.rooms.view, { sessionId });
    expect(view?.session.status).toBe("active");
    expect(view?.participantNames.map((p) => p.name)).toEqual(
      expect.arrayContaining(["Shenzhen PCB Works", "Ana Rojas", "Li Wei"]),
    );
  });

  it("gives each seat to one person and lets a seated person switch sides", async () => {
    await seated();
    expect(
      await errorKind(caro().mutation(api.demo.join, { seat: "buyer" })),
    ).toBe("SeatTaken");
    await li().mutation(api.demo.leave, {});
    await ana().mutation(api.demo.join, { seat: "merchant" });
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      mySeat: "merchant",
      seats: expect.arrayContaining([
        { seat: "buyer", taken: false, displayName: "Comprador" },
        { seat: "merchant", taken: true, displayName: "Ana Rojas" },
      ]),
    });
  });

  it("restarts for a seated person only, keeping both seats and dropping what was said", async () => {
    const first = await seated();
    await ana().action(api.gate.send, {
      sessionId: first,
      recipient: "all",
      content: { kind: "text", text: "¿Y si pido 100 unidades?" },
    });
    await settle();
    expect(await errorKind(caro().mutation(api.demo.restart, {}))).toBe(
      "Forbidden",
    );
    const { sessionId } = await li().mutation(api.demo.restart, {});
    expect(sessionId).not.toBe(first);
    expect(await history(ana(), sessionId)).toHaveLength(
      DEMO_SCRIPT.length + 1,
    );
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      sessionId,
      mySeat: "buyer",
    });
    expect(await li().query(api.demo.state, {})).toMatchObject({
      mySeat: "merchant",
    });
    expect(await errorKind(history(ana(), first))).toBe("NotParticipant");
  });

  it("frees both seats when reset is asked to", async () => {
    await seated();
    await t.mutation(internal.demo.reset, { clearSeats: true });
    expect(await ana().query(api.demo.state, {})).toMatchObject({
      mySeat: null,
      seats: [
        { seat: "buyer", taken: false },
        { seat: "merchant", taken: false },
      ],
    });
  });

  it("answers the buyer's submitted form with a quote", async () => {
    const sessionId = await seated();
    const form = (await history(ana(), sessionId)).at(-1);
    await ana().action(api.gate.send, {
      sessionId,
      recipient: form?.senderParticipantId as Id<"participants">,
      content: {
        kind: "ui_response",
        inReplyTo: form?.messageId as string,
        response: {
          type: "form_submit",
          formId: "pedido-pcb",
          values: { cantidad: "50", acabado: "enig", envio: "dhl" },
        },
      },
    });
    await settle();
    expect((await texts(ana(), sessionId)).at(-1)).toBe(QUOTE);
  });

  it("keeps the manufacturer's agent quiet when its own person writes", async () => {
    const sessionId = await seated();
    await li().action(api.gate.send, {
      sessionId,
      recipient: "all",
      content: { kind: "text", text: "Soy Li. Te dejo el envío gratis." },
    });
    await settle();
    expect(await texts(ana(), sessionId)).not.toContain(QUOTE);
    await ana().action(api.gate.send, {
      sessionId,
      recipient: "all",
      content: { kind: "text", text: "Acepto. ¿Cuál es el total?" },
    });
    await settle();
    expect((await texts(ana(), sessionId)).at(-1)).toBe(QUOTE);
  });

  it("keeps the manufacturer out of the directory", async () => {
    await seated();
    const listed = await t.query(api.directory.search, {});
    expect(JSON.stringify(listed)).not.toContain(DEMO_PROVIDER_SLUG);
  });

  it("turns off when removed", async () => {
    const sessionId = await seated();
    await t.mutation(internal.demo.remove, {});
    expect(await ana().query(api.demo.state, {})).toBeNull();
    expect(await errorKind(history(ana(), sessionId))).toBe("NotParticipant");
  });
});
