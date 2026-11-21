// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { chooseProvider, consumerTurn } from "../../lib/agents/consumer";
import { providerTurn } from "../../lib/agents/provider";
import type { AgentTurn } from "../../lib/agents/turn";
import type { Message } from "../../shared/messages";
import {
  createFakeLlmProvider,
  type LlmProvider,
} from "../../shared/providers/llm";
import { CLINIC_AGENT_SLUG } from "../../shared/seedData";
import {
  choose,
  insertRoom,
  type LoggedRoom,
  pickerOf,
  withLog,
} from "./rooms";

const modules = import.meta.glob("../../convex/**/*.ts");
const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;

beforeEach(async () => {
  t = createTest();
  rateLimiter.register(t);
  await t.mutation(internal.seed.ensure, {});
});

const REQUEST = "Necesito hora con un cardiólogo en Providencia";
const OPENING = "Hola, necesito una hora de cardiología. ¿Qué horarios tienen?";

const noLlm = createFakeLlmProvider();
const decide = (decision: object) =>
  createFakeLlmProvider({ object: () => decision });
const search = async (query: string) =>
  (await t.action(api.directory.searchText, { query })).agents;

const clinicId = () =>
  t
    .query(api.directory.get, { slug: CLINIC_AGENT_SLUG })
    .then((c) => c?.agentId);

const openRoom = async () =>
  withLog(await t.run((ctx) => insertRoom(ctx, CLINIC_AGENT_SLUG)));

function turnFor(room: LoggedRoom, self: string, incoming: Message): AgentTurn {
  return {
    self,
    contract: room.contract,
    participants: room.participants,
    history: [...room.history],
    incoming,
  };
}

describe("consumer agent", () => {
  it("finds the seed clinic with E1's search and opens with an intent the card allows", async () => {
    const prompts: string[] = [];
    const llm = createFakeLlmProvider({
      object: ({ prompt }) => {
        prompts.push(prompt);
        return { intent: "book", message: OPENING };
      },
    });

    const choice = await chooseProvider(REQUEST, { llm, search });

    expect(choice).toEqual({
      agentId: await clinicId(),
      name: "Agendamiento Clínica Providencia",
      intent: { name: "book", description: REQUEST },
      opening: OPENING,
    });
    expect(prompts[0]).toContain("check_availability");
    await expect(
      chooseProvider(REQUEST, {
        llm: decide({ intent: "place_order", message: OPENING }),
        search,
      }),
    ).rejects.toThrow();
  });

  it("chooses nothing when the directory has no match", async () => {
    await expect(
      chooseProvider("Necesito un gimnasio en Pirque", { llm: noLlm, search }),
    ).resolves.toBeNull();
  });

  it("closes the room once its provider sent the confirmation", async () => {
    const room = await openRoom();
    await room.post(room.recipient, room.owner, {
      kind: "ui",
      spec: {
        type: "confirmation",
        id: "horarios-1-reserva",
        title: "Reserva confirmada",
        summary: "Consulta cardiología, jueves 26 de noviembre, 10:30.",
        details: [],
        confirmLabel: "Listo",
        cancelLabel: "Cerrar",
      },
    });
    const notice = await room.post(room.recipient, room.initiator, {
      kind: "text",
      text: "Reserva confirmada.",
    });

    await expect(
      consumerTurn(turnFor(room, room.initiator, notice), { llm: noLlm }),
    ).resolves.toEqual([{ kind: "close" }]);
  });

  it("answers its provider through the model, or stays quiet", async () => {
    const room = await openRoom();
    const question = await room.post(room.recipient, room.initiator, {
      kind: "text",
      text: "¿Prefiere mañana o tarde?",
    });
    const turn = turnFor(room, room.initiator, question);

    await expect(
      consumerTurn(turn, {
        llm: decide({ action: "reply", text: "Mañana, por favor." }),
      }),
    ).resolves.toEqual([
      {
        kind: "send",
        recipient: room.recipient,
        content: { kind: "text", text: "Mañana, por favor." },
      },
    ]);
    await expect(
      consumerTurn(turn, { llm: decide({ action: "wait", text: "" }) }),
    ).resolves.toEqual([]);
    await expect(
      consumerTurn(
        turnFor(room, room.initiator, {
          ...question,
          senderParticipantId: room.owner,
        }),
        {
          llm: noLlm,
        },
      ),
    ).resolves.toEqual([]);
  });

  it("completes the reference request with the provider, before E2, behind an allow-all moderator", async () => {
    const choice = await chooseProvider(REQUEST, {
      llm: decide({ intent: "book", message: OPENING }),
      search,
    });
    if (!choice) throw new Error("the consumer chose no provider");
    expect(choice.agentId).toBe(await clinicId());
    const room = withLog(
      await t.run((ctx) =>
        insertRoom(ctx, CLINIC_AGENT_SLUG, { intent: choice.intent }),
      ),
    );
    const providerLlm: LlmProvider = decide({
      action: "offer_slots",
      offerings: [],
      text: "",
    });
    let closed = false;

    // A stand-in for E2's turn orchestration: a message to an agent gets that agent's turn.
    async function deliver(message: Message): Promise<void> {
      const self = message.recipient;
      if (self !== room.recipient && self !== room.initiator) return;
      const turn = turnFor(room, self, message);
      const actions =
        self === room.recipient
          ? await providerTurn(
              turn,
              await t.query(internal.providerAgent.context, {
                agentId: room.providerId,
              }),
              {
                llm: providerLlm,
                book: (slotId) =>
                  t.mutation(internal.bookings.book, {
                    sessionId: room.sessionId,
                    agentId: room.providerId,
                    availabilityId: slotId as Id<"availability">,
                  }),
              },
            )
          : await consumerTurn(turn, { llm: noLlm });
      for (const action of actions) {
        if (action.kind === "close") closed = true;
        else
          await deliver(
            await room.post(self, action.recipient, action.content),
          );
      }
    }

    await deliver(
      await room.post(room.initiator, room.recipient, {
        kind: "text",
        text: choice.opening,
      }),
    );
    const picker = room.history.at(-1) as Message;
    expect(picker.recipient).toBe(room.owner);
    const chosen = pickerOf(picker).slots[0].id;
    await deliver(await choose(room, picker, chosen));

    expect(closed).toBe(true);
    expect(
      room.history.map((m) =>
        m.content.kind === "ui" ? m.content.spec.type : m.content.kind,
      ),
    ).toEqual(["text", "slot_picker", "ui_response", "confirmation", "text"]);
    const slot = await t.run((ctx) =>
      ctx.db.get("availability", chosen as Id<"availability">),
    );
    expect(slot?.booked).toBe(1);
  });
});
