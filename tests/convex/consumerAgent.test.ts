// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import {
  chooseProvider,
  consumerTurn,
  type FoundCard,
} from "../../lib/agents/consumer";
import type { AgentTurn } from "../../lib/agents/turn";
import type { Message } from "../../shared/messages";
import {
  createFakeLlmProvider,
  type LlmProvider,
} from "../../shared/providers/llm";
import { CLINIC_AGENT_SLUG } from "../../shared/seedData";
import {
  askProvider,
  choose,
  insertRoom,
  type LoggedRoom,
  pickerOf,
  visibleTo,
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

const RUT = "12.345.678-5";
const REQUEST = `Necesito hora con un cardiólogo en Providencia, mi RUT es ${RUT}`;
const OPENING = "Hola, necesito una hora de cardiología. ¿Qué horarios tienen?";
const CLINIC = "Agendamiento Clínica Providencia";

const noLlm = createFakeLlmProvider();
const decide = (decision: object) =>
  createFakeLlmProvider({ object: () => decision });
const inTurn = (...decisions: object[]) =>
  createFakeLlmProvider({
    object: () => {
      const next = decisions.shift();
      if (!next) throw new Error("fake LLM: no decision left");
      return next;
    },
  });
const search = async (query: string) =>
  (await t.action(api.directory.searchText, { query })).agents;

// The key the consumer's prompt gives to the card with this name.
const keyOf = (prompt: string, name: string) => {
  const line = prompt.split("\n").find((l) => l.includes(name));
  if (!line) throw new Error(`${name} is not among the candidates`);
  return JSON.parse(line).clave as string;
};
const pickClinic = (intent: string) =>
  createFakeLlmProvider({
    object: ({ prompt }) => ({
      choice: `${keyOf(prompt, CLINIC)}:${intent}`,
      message: OPENING,
    }),
  });

const clinicId = () =>
  t
    .query(api.directory.get, { slug: CLINIC_AGENT_SLUG })
    .then((c) => c?.agentId);

const openRoom = async () =>
  withLog(await t.run((ctx) => insertRoom(ctx, CLINIC_AGENT_SLUG)));

// The consumer's turn on `incoming`, seeing the room as E2 delivers it to the consumer.
function consumerSees(room: LoggedRoom, incoming: Message): AgentTurn {
  return {
    self: room.initiator,
    contract: room.contract,
    participants: room.participants,
    history: visibleTo(room, room.initiator),
    incoming,
  };
}

describe("consumer agent", () => {
  it("finds the seed clinic with E1's search and opens with an intent the card allows", async () => {
    const prompts: string[] = [];
    const llm = createFakeLlmProvider({
      object: (args) => {
        prompts.push(args.prompt);
        return {
          choice: `${keyOf(args.prompt, CLINIC)}:book`,
          message: OPENING,
        };
      },
    });

    const choice = await chooseProvider(REQUEST, { llm, search });

    expect(choice).toEqual({
      agentId: await clinicId(),
      name: CLINIC,
      intent: {
        name: "book",
        description: `Solicitud "book" a ${CLINIC}`,
      },
      opening: OPENING,
    });
    expect(prompts[0]).toContain("check_availability");
    await expect(
      chooseProvider(REQUEST, { llm: pickClinic("place_order"), search }),
    ).rejects.toThrow();
  });

  it("chooses the card that can do what was asked, not the first one", async () => {
    const card = (name: string, allowedIntents: string[]): FoundCard => ({
      agentId: name,
      name,
      description: name,
      purpose: name,
      allowedIntents,
    });
    const results = [
      card("Clínica que solo informa", ["ask_info"]),
      card("Clínica que agenda", ["ask_info", "book"]),
    ];

    const choice = await chooseProvider(REQUEST, {
      llm: decide({ choice: "p2:book", message: OPENING }),
      search: async () => results,
    });

    expect(choice?.agentId).toBe("Clínica que agenda");
    await expect(
      chooseProvider(REQUEST, {
        llm: decide({ choice: "p1:book", message: OPENING }),
        search: async () => results,
      }),
    ).rejects.toThrow();
    await expect(
      chooseProvider(REQUEST, {
        llm: decide({ choice: "ninguno", message: OPENING }),
        search: async () => results,
      }),
    ).resolves.toBeNull();
  });

  it("chooses nothing when the directory has no match", async () => {
    await expect(
      chooseProvider("Necesito un gimnasio en Pirque", { llm: noLlm, search }),
    ).resolves.toBeNull();
    await expect(
      chooseProvider("Necesito un gimnasio en Pirque. ".repeat(12), {
        llm: decide({ query: "gimnasio en Pirque" }),
        search,
      }),
    ).resolves.toBeNull();
  });

  it("searches a request too long for the directory with a short query the model writes", async () => {
    const long = `${"Hola, te cuento mi situación. ".repeat(12)}${REQUEST}`;
    const prompts: string[] = [];
    const llm = createFakeLlmProvider({
      object: ({ prompt }) => {
        prompts.push(prompt);
        return prompt.includes("<proveedores>")
          ? { choice: `${keyOf(prompt, CLINIC)}:book`, message: OPENING }
          : { query: "cardiólogo en Providencia" };
      },
    });

    const choice = await chooseProvider(long, { llm, search });

    expect(long.length).toBeGreaterThan(300);
    expect(prompts[0]).toContain(RUT);
    expect(choice?.agentId).toBe(await clinicId());
  });

  it("answers its provider through the model, or stays quiet", async () => {
    const room = await openRoom();
    const question = await room.post(room.recipient, room.initiator, {
      kind: "text",
      text: "¿Prefiere mañana o tarde?",
    });
    const turn = consumerSees(room, question);

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
    for (const ignored of [
      { ...question, senderParticipantId: room.owner },
      { ...question, recipient: room.owner },
      {
        ...question,
        status: "blocked" as const,
        verdict: {
          decision: "block" as const,
          rule: "injection" as const,
          reason: "Bloqueado.",
        },
      },
    ]) {
      await expect(
        consumerTurn(consumerSees(room, ignored), { llm: noLlm }),
      ).resolves.toEqual([]);
    }
  });

  it("keeps its opening in view, however long the room gets", async () => {
    const room = await openRoom();
    await room.post(room.initiator, room.recipient, {
      kind: "text",
      text: "Solo puedo el martes a las 8",
    });
    let last = await room.post(room.recipient, room.initiator, {
      kind: "text",
      text: "¿Algo más?",
    });
    for (let i = 0; i < 14; i++) {
      last = await room.post(room.recipient, room.initiator, {
        kind: "text",
        text: `Pregunta ${i}`,
      });
    }
    const prompts: string[] = [];
    const llm = createFakeLlmProvider({
      object: ({ prompt }) => {
        prompts.push(prompt);
        return { action: "wait", text: "" };
      },
    });

    await consumerTurn(consumerSees(room, last), { llm });

    expect(prompts[0]).toContain("Solo puedo el martes a las 8");
  });

  it("completes the reference request with the provider, before E2, behind an allow-all moderator", async () => {
    const choice = await chooseProvider(REQUEST, {
      llm: pickClinic("book"),
      search,
    });
    if (!choice) throw new Error("the consumer chose no provider");
    expect(choice.agentId).toBe(await clinicId());
    const room = withLog(
      await t.run((ctx) =>
        insertRoom(ctx, CLINIC_AGENT_SLUG, { intent: choice.intent }),
      ),
    );
    const providerPrompts: string[] = [];
    const scripted = inTurn(
      { action: "reply", offerings: [], text: "¿Prefiere mañana o tarde?" },
      { action: "offer_slots", offerings: [], text: "" },
    );
    const providerLlm: LlmProvider = {
      ...scripted,
      generateObject: (args) => {
        providerPrompts.push(args.prompt);
        return scripted.generateObject(args);
      },
    };
    const consumerLlm = decide({
      action: "reply",
      text: "En la mañana, por favor.",
    });
    let closed = false;

    // A stand-in for E2's turn orchestration: each agent a message reaches gets its turn, and
    // sees only what E2 would deliver to it.
    async function deliver(message: Message): Promise<void> {
      const agents = [room.recipient, room.initiator].filter(
        (id) =>
          id !== message.senderParticipantId &&
          (message.recipient === id || message.recipient === "all"),
      );
      for (const self of agents) {
        const actions =
          self === room.recipient
            ? await askProvider(t, room, message, providerLlm)
            : await consumerTurn(consumerSees(room, message), {
                llm: consumerLlm,
              });
        for (const action of actions) {
          if (action.kind === "close") closed = true;
          else
            await deliver(
              await room.post(self, action.recipient, action.content),
            );
        }
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
    ).toEqual([
      "text",
      "text",
      "text",
      "slot_picker",
      "ui_response",
      "confirmation",
    ]);
    expect(room.history.at(-1)?.recipient).toBe(room.owner);
    const slot = await t.run((ctx) =>
      ctx.db.get("availability", chosen as Id<"availability">),
    );
    expect(slot?.booked).toBe(1);
    expect(providerPrompts.join("\n")).not.toContain(RUT);
    expect(JSON.stringify(room.contract)).not.toContain(RUT);
  });
});
