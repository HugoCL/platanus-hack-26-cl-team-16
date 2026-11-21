// @vitest-environment edge-runtime
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Message } from "../../shared/messages";
import { MODERATOR_TIMEOUT_MS } from "../../shared/moderator/moderator";
import * as rules from "../../shared/moderator/rules";
import {
  errorKind,
  ROOM_OWNER,
  roomWithHuman,
  seededRooms,
} from "./roomFixture";

let rooms: Awaited<ReturnType<typeof seededRooms>>;
let room: Awaited<ReturnType<typeof roomWithHuman>>;
beforeEach(async () => {
  rooms = await seededRooms();
  room = await roomWithHuman(rooms);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const text = (value: string) => ({ kind: "text" as const, text: value });

const send = (
  sender: Id<"participants">,
  recipient: Id<"participants"> | "all",
  content: unknown,
) =>
  rooms.t.action(internal.gate.sendAsParticipant, {
    sessionId: room.sessionId,
    senderParticipantId: sender,
    recipient,
    content: content as never,
  });

const history = (viewerParticipantId = room.consumer) =>
  rooms.t.query(internal.gate.historyForParticipant, {
    sessionId: room.sessionId,
    viewerParticipantId,
  });

const humanHistory = () =>
  rooms.t.withIdentity(ROOM_OWNER).query(api.gate.history, {
    sessionId: room.sessionId,
  });

function convexSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "_generated" ? [] : convexSources(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("E2 success criteria", () => {
  it("2. both agents and the human see each allowed message in the same order", async () => {
    const viewers = [room.consumer, room.provider, room.human];
    const snapshots = () =>
      Promise.all([
        history(room.consumer),
        history(room.provider),
        humanHistory(),
      ]);
    const [openingNotice] = await history();
    expect(openingNotice.content).toMatchObject({ code: "session_opened" });
    const expected = [openingNotice];

    for (const [i, sender] of viewers.entries()) {
      const content = text(`Message ${i + 1}`);
      const message =
        sender === room.human
          ? await rooms.t.withIdentity(ROOM_OWNER).action(api.gate.send, {
              sessionId: room.sessionId,
              recipient: "all",
              content,
            })
          : await send(sender, "all", content);
      expect(message).toMatchObject({
        status: "allowed",
        senderParticipantId: sender,
      });
      expected.push(message);
      expect(await snapshots()).toEqual(viewers.map(() => expected));
    }
  });

  it("3. the history returns every message in order, each with its verdict", async () => {
    const sent = [
      await send(room.consumer, "all", text("Busco hora esta semana")),
      await send(room.provider, room.human, text("Tengo jueves o viernes")),
      await send(room.human, "all", text("Prefiero el jueves")),
      await send(room.consumer, "all", text("Gracias")),
    ];

    const messages = await history();

    expect(messages.map((m) => m.content.kind)).toEqual([
      "system",
      "text",
      "text",
      "text",
      "text",
    ]);
    expect(messages[0].content).toMatchObject({ code: "session_opened" });
    expect(messages.slice(1)).toEqual(sent);
    for (const message of messages) {
      expect(Message.safeParse(message).error?.issues ?? []).toEqual([]);
      expect(message.verdict).not.toBeNull();
    }
    const times = messages.map((m) => m.sentAt);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("keeps the latest send visible in a long room and pages through older messages", async () => {
    await rooms.t.run(async (ctx) => {
      for (let n = 0; n < 500; n++) {
        await ctx.db.insert("messages", {
          sessionId: room.sessionId,
          senderParticipantId: room.human,
          recipient: "all",
          content: text(`Earlier message ${n}`),
          moderation: {
            status: "allowed",
            verdict: { decision: "allow", reason: "Test fixture." },
            reasons: [],
          },
        });
      }
    });
    const newest = await send(room.human, "all", text("Latest"));
    const latest = await history();
    expect(latest).toHaveLength(500);
    expect(latest.at(-1)).toEqual(newest);

    const all: Message[] = [];
    let cursor: string | null = null;
    while (true) {
      const result: FunctionReturnType<
        typeof internal.gate.historyPageForParticipant
      > = await rooms.t.query(internal.gate.historyPageForParticipant, {
        sessionId: room.sessionId,
        viewerParticipantId: room.consumer,
        paginationOpts: { numItems: 200, cursor },
      });
      all.push(...result.page);
      if (result.isDone) break;
      expect(result.continueCursor).not.toBe(cursor);
      cursor = result.continueCursor;
    }
    expect(all).toHaveLength(502);
    expect(all[0].content).toMatchObject({ code: "session_opened" });
    expect(all.slice(-500)).toEqual(latest);
  });

  it("6. only the gate module writes messages, and only the gate calls its commit", () => {
    const sources = convexSources("convex");
    const writers = sources.filter((path) =>
      /\.(insert|patch|replace)\(\s*"messages"/.test(
        readFileSync(path, "utf8"),
      ),
    );
    expect(writers).toEqual(["convex/roomMessages.ts"]);
    const inserters = sources.filter((path) =>
      /\binsertMessage\(/.test(readFileSync(path, "utf8")),
    );
    expect(inserters.sort()).toEqual([
      "convex/gate.ts",
      "convex/roomMessages.ts",
      "convex/seed.ts",
    ]);

    const committers = sources.filter((path) =>
      readFileSync(path, "utf8").includes("gate.commit"),
    );
    expect(committers).toEqual(["convex/gate.ts"]);
  });
});

describe("the moderation gate", () => {
  it("returns the stored message with the moderator's verdict", async () => {
    const message = await send(room.consumer, room.provider, text("Hola"));
    expect(message).toMatchObject({
      status: "allowed",
      verdict: { decision: "allow" },
      senderParticipantId: room.consumer,
      recipient: room.provider,
    });
  });

  it("asks the moderator with the content, sender, recipient, contract and history", async () => {
    const moderate = vi.spyOn(rules, "checkRules");
    await send(room.consumer, "all", text("Hola"));

    expect(moderate).toHaveBeenCalledOnce();
    const input = moderate.mock.calls[0][0];
    expect(input.content).toEqual(text("Hola"));
    expect(input.sender).toMatchObject({ participantId: room.consumer });
    expect(input.recipient).toBe("all");
    expect(input.participants).toEqual(room.room.participants);
    expect(input.contract).toEqual(room.room.contract);
    expect(input.history.map((m) => m.content.kind)).toEqual(["system"]);
  });

  it("stores a blocked verdict with its events and alerts the sender", async () => {
    rooms.judge.mockReturnValueOnce({
      decision: "block",
      rule: "scope",
      reason: "raw judge response",
    });

    const blocked = await send(
      room.consumer,
      room.provider,
      text("¿Hablamos del clima?"),
    );

    const reason =
      "El mensaje pide u ofrece algo fuera del alcance del contrato.";
    expect(blocked).toMatchObject({
      status: "blocked",
      verdict: { decision: "block", rule: "scope", reason },
    });
    const alert = (await history()).at(-1);
    expect(alert).toMatchObject({
      senderParticipantId: null,
      recipient: room.consumer,
      content: {
        kind: "ui",
        spec: {
          type: "moderator_alert",
          rule: "scope",
          reason,
          blockedMessageId: blocked.messageId,
        },
      },
    });
    expect((await history(room.consumer)).slice(1)).toEqual([blocked, alert]);
    expect((await humanHistory()).slice(1)).toEqual([blocked, alert]);
    expect(await history(room.provider)).toHaveLength(1);
    for (const [viewerParticipantId, expected] of [
      [room.consumer, [blocked, alert]],
      [room.provider, []],
    ] as const) {
      const { page } = await rooms.t.query(
        internal.gate.historyPageForParticipant,
        {
          sessionId: room.sessionId,
          viewerParticipantId,
          paginationOpts: { numItems: 10, cursor: null },
        },
      );
      expect(page.slice(1)).toEqual(expected);
    }
    const { page } = await rooms.t
      .withIdentity(ROOM_OWNER)
      .query(api.gate.historyPage, {
        sessionId: room.sessionId,
        paginationOpts: { numItems: 10, cursor: null },
      });
    expect(page.slice(1)).toEqual([blocked, alert]);

    const allowed = await send(room.consumer, "all", text("Gracias."));
    expect(allowed.status).toBe("allowed");
    expect((await history(room.consumer)).slice(1)).toEqual([
      blocked,
      alert,
      allowed,
    ]);
    expect((await humanHistory()).slice(1)).toEqual([blocked, alert, allowed]);
    expect((await history(room.provider)).slice(1)).toEqual([allowed]);
    const events = await rooms.t.run((ctx) =>
      ctx.db
        .query("moderationEvents")
        .withIndex("by_messageId", (q) =>
          q.eq("messageId", blocked.messageId as Id<"messages">),
        )
        .take(10),
    );
    expect(events).toMatchObject([
      {
        sessionId: room.sessionId,
        stage: "deterministic",
        action: "allow",
        reasons: [],
      },
      {
        sessionId: room.sessionId,
        stage: "injection",
        action: "allow",
        reasons: [],
      },
      {
        sessionId: room.sessionId,
        stage: "purpose",
        action: "block",
        reasons: [
          { stage: "purpose", code: "forbidden_topic", detail: reason },
        ],
      },
    ]);
  });

  it("runs only the deterministic stage when the content cannot be read", async () => {
    rooms.judge.mockClear();
    const message = await send(room.consumer, room.provider, {
      kind: "ciphertext",
      ciphertext: "aG9sYQ==",
      epoch: 0,
    });
    expect(message.status).toBe("blocked");
    expect(rooms.judge).not.toHaveBeenCalled();
    expect(
      await rooms.t.run((ctx) =>
        ctx.db
          .query("moderationEvents")
          .withIndex("by_messageId", (q) =>
            q.eq("messageId", message.messageId as Id<"messages">),
          )
          .take(10),
      ),
    ).toMatchObject([
      {
        stage: "deterministic",
        action: "block",
        reasons: [{ code: "malformed_payload" }],
      },
    ]);
  });

  it.each(["initialization", "execution"])(
    "fails closed on a moderator %s error",
    async (where) => {
      const fail = () => {
        throw new Error("raw provider error");
      };
      if (where === "initialization")
        rooms.createLlm.mockImplementationOnce(fail);
      else rooms.judge.mockImplementationOnce(fail);
      const message = await send(room.consumer, room.provider, text("Hola."));
      await expectFailure(message);
    },
  );

  it("does not allow through an unconfigured fake judge", async () => {
    rooms.createLlm.mockRestore();
    const message = await send(room.consumer, room.provider, text("Hola."));
    await expectFailure(message);
  });

  it("aborts two stalled judge attempts and persists the timeout as a block", async () => {
    vi.useFakeTimers();
    try {
      let started: (signal: AbortSignal | undefined) => void = () => {};
      const judging = new Promise<AbortSignal | undefined>((resolve) => {
        started = resolve;
      });
      const signals: (AbortSignal | undefined)[] = [];
      vi.spyOn(rooms.llm, "generateObject").mockImplementation(
        ({ abortSignal }) => {
          signals.push(abortSignal);
          started(abortSignal);
          return new Promise(() => {});
        },
      );
      const pending = send(room.consumer, room.provider, text("Hola."));
      const signal = await judging;
      await vi.advanceTimersByTimeAsync(MODERATOR_TIMEOUT_MS);
      expect(signal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(MODERATOR_TIMEOUT_MS);
      await expectFailure(await pending);
      expect(signals).toHaveLength(4);
      expect(signals[1]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  async function expectFailure(message: Message) {
    const view = await rooms.t.withIdentity(ROOM_OWNER).query(api.rooms.view, {
      sessionId: room.sessionId,
    });
    expect(view?.violationCount).toBe(0);
    expect(message).toMatchObject({
      status: "blocked",
      verdict: { decision: "block", rule: "purpose" },
    });
    const audit = await rooms.t.run((ctx) =>
      ctx.db
        .query("moderationEvents")
        .withIndex("by_messageId", (q) =>
          q.eq("messageId", message.messageId as Id<"messages">),
        )
        .take(10),
    );
    expect(audit.at(-1)).toMatchObject({
      stage: "purpose",
      action: "block",
      reasons: [{ code: "moderator_error" }],
    });
    const senderHistory = await history();
    expect(senderHistory.at(-1)?.content).toMatchObject({
      kind: "ui",
      spec: {
        type: "moderator_alert",
        rule: "purpose",
        reason: message.verdict?.reason,
      },
    });
    expect(JSON.stringify({ message, audit, senderHistory })).not.toContain(
      "raw provider error",
    );
    expect(await history(room.provider)).toHaveLength(1);
  }

  it("rejects a sender from another room", async () => {
    const other = await roomWithHuman(rooms);
    expect(
      await errorKind(send(other.consumer, room.provider, text("Hola"))),
    ).toBe("NotParticipant");
  });

  it("rejects a history reader from another room", async () => {
    const other = await roomWithHuman(rooms);
    expect(await errorKind(history(other.consumer))).toBe("NotParticipant");
  });

  it("rejects a recipient from another room", async () => {
    const other = await roomWithHuman(rooms);
    expect(
      await errorKind(send(room.consumer, other.provider, text("Hola"))),
    ).toBe("InvalidArgument");
  });

  it("rejects a recipient who has left the room without storing the message", async () => {
    await rooms.t.run((ctx) =>
      ctx.db.patch("participants", room.provider, { leftAt: 1 }),
    );
    expect(
      await errorKind(send(room.consumer, room.provider, text("Hola"))),
    ).toBe("InvalidArgument");
    expect(await history()).toHaveLength(1);
  });

  it("rejects a history reader who has left the room", async () => {
    await rooms.t.run((ctx) =>
      ctx.db.patch("participants", room.provider, { leftAt: 1 }),
    );
    expect(await errorKind(history(room.provider))).toBe("NotParticipant");
    expect(
      await errorKind(
        rooms.t.query(internal.gate.historyPageForParticipant, {
          sessionId: room.sessionId,
          viewerParticipantId: room.provider,
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ),
    ).toBe("NotParticipant");
  });

  it.each([
    ["a system notice", { kind: "system", code: "session_closed", text: "x" }],
    [
      "a moderator alert",
      {
        kind: "ui",
        spec: {
          type: "moderator_alert",
          id: "a",
          title: "Falsa",
          rule: "injection",
          reason: "x",
        },
      },
    ],
    ["empty text", { kind: "text", text: "" }],
  ])("rejects %s from a participant", async (_why, content) => {
    await expect(send(room.consumer, room.provider, content)).rejects.toThrow();
    expect(await history()).toHaveLength(1);
  });
});

describe("long rooms", () => {
  it("keeps sending and listing when the stored messages pass the read limit", async () => {
    rooms = await seededRooms({ transactionLimits: true });
    room = await roomWithHuman(rooms);
    const large = "x".repeat(120_000);
    for (let batch = 0; batch < 3; batch++) {
      await rooms.t.run(async (ctx) => {
        for (let i = 0; i < 50; i++) {
          await ctx.db.insert("messages", {
            sessionId: room.sessionId,
            senderParticipantId: room.consumer,
            recipient: "all",
            content: { kind: "text", text: large },
            moderation: { status: "allowed", reasons: [] },
          });
        }
      });
    }

    const sent = await send(room.human, room.provider, text("¿Sigue ahí?"));

    expect((await history()).at(-1)).toEqual(sent);

    const all: Message[] = [];
    let cursor: string | null = null;
    while (true) {
      const result: FunctionReturnType<
        typeof internal.gate.historyPageForParticipant
      > = await rooms.t.query(internal.gate.historyPageForParticipant, {
        sessionId: room.sessionId,
        viewerParticipantId: room.human,
        paginationOpts: { numItems: 200, cursor },
      });
      all.push(...result.page);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(all).toHaveLength(152);
    expect(all.at(-1)).toEqual(sent);
  });
});

describe("UI responses", () => {
  const picker = {
    kind: "ui",
    spec: {
      type: "slot_picker",
      id: "horarios",
      title: "Elige un horario",
      timezone: "America/Santiago",
      slots: [
        {
          id: "lunes-0900",
          start: "2026-11-24T09:00:00-03:00",
          end: "2026-11-24T09:30:00-03:00",
        },
      ],
    },
  };
  const choose = (inReplyTo: string) => ({
    kind: "ui_response",
    inReplyTo,
    response: {
      type: "slot_selected",
      pickerId: "horarios",
      slotId: "lunes-0900",
    },
  });

  it("accepts a reply to a picker sent to the sender and shows it to the moderator", async () => {
    const sent = await send(room.provider, room.human, picker);
    const moderate = vi.spyOn(rules, "checkRules");
    const reply = await send(room.human, room.provider, choose(sent.messageId));
    expect(reply.status).toBe("allowed");
    expect(moderate.mock.calls[0][0].history.map((m) => m.messageId)).toContain(
      sent.messageId,
    );
  });

  it("shows the picker to the moderator when it left the history window", async () => {
    const sent = await send(room.provider, room.human, picker);
    await rooms.t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        await ctx.db.insert("messages", {
          sessionId: room.sessionId,
          senderParticipantId: room.consumer,
          recipient: room.provider,
          content: { kind: "text", text: `relleno ${i}` },
          moderation: { status: "allowed", reasons: [] },
        });
      }
    });
    const moderate = vi.spyOn(rules, "checkRules");
    await send(room.human, room.provider, choose(sent.messageId));
    expect(moderate.mock.calls[0][0].history.map((m) => m.messageId)).toContain(
      sent.messageId,
    );
  });

  it("rejects a reply to a message that does not exist", async () => {
    expect(
      await errorKind(send(room.human, room.provider, choose("no-existe"))),
    ).toBe("InvalidArgument");
  });

  it("rejects a reply to a picker from another room", async () => {
    const other = await roomWithHuman(rooms);
    const sent = await rooms.t.action(internal.gate.sendAsParticipant, {
      sessionId: other.sessionId,
      senderParticipantId: other.provider,
      recipient: other.human,
      content: picker as never,
    });
    expect(
      await errorKind(send(room.human, room.provider, choose(sent.messageId))),
    ).toBe("InvalidArgument");
  });

  it("rejects a reply to a picker sent to someone else", async () => {
    const sent = await send(room.provider, room.consumer, picker);
    expect(
      await errorKind(send(room.human, room.provider, choose(sent.messageId))),
    ).toBe("InvalidArgument");
  });

  it("rejects a reply to a text message", async () => {
    const sent = await send(room.provider, room.human, text("Hola"));
    expect(
      await errorKind(send(room.human, room.provider, choose(sent.messageId))),
    ).toBe("InvalidArgument");
  });

  it("rejects a reply to a blocked picker", async () => {
    rooms.judge.mockReturnValueOnce({
      decision: "block",
      rule: "scope",
      reason: "x",
    });
    const sent = await send(room.provider, room.human, picker);
    expect(sent.status).toBe("blocked");
    expect(
      await errorKind(send(room.human, room.provider, choose(sent.messageId))),
    ).toBe("InvalidArgument");
  });
});

describe("participants who left", () => {
  it("rejects a message from a participant who left the room", async () => {
    await rooms.t.run((ctx) =>
      ctx.db.patch(room.human, { leftAt: Date.now() }),
    );
    expect(await errorKind(send(room.human, room.provider, text("Hola")))).toBe(
      "NotParticipant",
    );
  });
});

describe("redacted messages", () => {
  it("delivers the redacted text instead of the original body", async () => {
    await rooms.t.run((ctx) =>
      ctx.db.insert("messages", {
        sessionId: room.sessionId,
        senderParticipantId: room.consumer,
        recipient: room.provider,
        content: { kind: "text", text: "Mi RUT es 12.345.678-9" },
        moderation: {
          status: "redacted",
          redactedText: "Mi RUT es [retirado]",
          reasons: [],
        },
      }),
    );
    for (const viewer of [room.consumer, room.provider, room.human]) {
      expect((await history(viewer)).at(-1)?.content).toEqual({
        kind: "text",
        text: "Mi RUT es [retirado]",
      });
    }
  });
});
