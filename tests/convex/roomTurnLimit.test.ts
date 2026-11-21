// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { testRoomAgent } from "../../convex/roomAgent";
import * as rules from "../../shared/moderator/rules";
import { DEFAULT_MAX_TURNS, Session } from "../../shared/session";
import {
  errorKind,
  ROOM_OWNER,
  roomWithHuman,
  seededRooms,
} from "./roomFixture";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup(maxTurns?: number) {
  const fixture = await seededRooms();
  const { t } = fixture;
  const { sessionId, consumer, provider, human } = await roomWithHuman(
    fixture,
    maxTurns,
  );
  return {
    consumer,
    provider,
    human,
    send: (
      senderParticipantId: Id<"participants">,
      recipient: Id<"participants"> | "all",
    ) =>
      t.action(internal.gate.sendAsParticipant, {
        sessionId,
        senderParticipantId,
        recipient,
        content: { kind: "text", text: "Tell me more." },
      }),
    history: () =>
      t.query(internal.gate.historyForParticipant, {
        sessionId,
        viewerParticipantId: human,
      }),
    room: () => t.withIdentity(ROOM_OWNER).query(api.rooms.get, { sessionId }),
    finishReplies: () => t.finishAllScheduledFunctions(vi.runAllTimers),
  };
}

it.each([
  ["the default", undefined, DEFAULT_MAX_TURNS],
  ["a custom cap", 3, 3],
])(
  "5. stops two agents that always answer at %s",
  async (_name, maxTurns, expectedTurns) => {
    const { consumer, provider, human, send, history, room, finishReplies } =
      await setup(maxTurns);
    const reply = vi
      .spyOn(testRoomAgent, "reply")
      .mockImplementation(async ({ message }) => [
        {
          kind: "send",
          recipient: message.senderParticipantId as Id<"participants">,
          content: { kind: "text", text: "Tell me more." },
        },
      ]);

    await send(consumer, provider);
    await finishReplies();
    const messages = await history();
    expect(messages).toHaveLength(expectedTurns + 2);
    expect(
      messages.slice(1, -1).map((message) => message.senderParticipantId),
    ).toEqual(
      Array.from({ length: expectedTurns }, (_, i) =>
        i % 2 ? provider : consumer,
      ),
    );
    expect(messages.at(-1)).toMatchObject({
      senderParticipantId: null,
      content: { kind: "system", code: "turn_limit_reached" },
    });
    expect(Session.parse(await room())).toMatchObject({
      status: "active",
      turnCount: expectedTurns,
    });
    expect(await errorKind(send(consumer, provider))).toBe("TurnLimitReached");
    expect(await send(human, provider)).toMatchObject({ status: "allowed" });
    await finishReplies();
    expect(reply).toHaveBeenCalledTimes(expectedTurns - 1);
    expect(await history()).toHaveLength(expectedTurns + 3);
    expect((await room())?.turnCount).toBe(expectedTurns);
  },
);

it("only admits one agent send when two compete for the last turn", async () => {
  const { consumer, provider, send, history, room } = await setup(1);
  const moderate = vi.spyOn(rules, "checkRules");
  const results = await Promise.allSettled([
    send(consumer, "all"),
    send(provider, "all"),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(moderate).toHaveBeenCalledTimes(2);
  expect((await room())?.turnCount).toBe(1);
  expect((await history()).map((message) => message.content)).toMatchObject([
    { code: "session_opened" },
    { kind: "text" },
    { code: "turn_limit_reached" },
  ]);
});

it("keeps two answering agents going past the judge's rate limit until the turn cap", async () => {
  const { consumer, provider, send, history, room, finishReplies } =
    await setup(30);
  vi.spyOn(testRoomAgent, "reply").mockImplementation(async ({ message }) => [
    {
      kind: "send",
      recipient: message.senderParticipantId as Id<"participants">,
      content: { kind: "text", text: "Tell me more." },
    },
  ]);

  await send(consumer, provider);
  await finishReplies();

  expect((await room())?.turnCount).toBe(30);
  expect((await history()).at(-1)).toMatchObject({
    content: { kind: "system", code: "turn_limit_reached" },
  });
});
