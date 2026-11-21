// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { referenceLlm } from "../../convex/referenceLlm";
import { createFakeLlmProvider } from "../../shared/providers/llm";
import { errorKind, REQUEST, ROOM_OWNER, seededRooms } from "./roomFixture";
import { NOW } from "./rooms";

vi.mock("../../convex/referenceLlm", () => ({ referenceLlm: vi.fn() }));

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("does not open a room without a configured reference model", async () => {
  const { t } = await seededRooms();
  vi.mocked(referenceLlm).mockReturnValue(null);

  expect(
    await errorKind(
      t.withIdentity(ROOM_OWNER).action(api.referenceScene.start, {
        request: REQUEST,
        displayName: "Juan",
      }),
    ),
  ).toBe("NotConfigured");
});

it("returns no room when the directory finds no provider", async () => {
  const { t } = await seededRooms();
  vi.mocked(referenceLlm).mockReturnValue(createFakeLlmProvider());

  expect(
    await t.withIdentity(ROOM_OWNER).action(api.referenceScene.start, {
      request: "Necesito un gimnasio en Pirque",
      displayName: "Juan",
    }),
  ).toBeNull();
});

it("checks authentication before acquiring a model or opening a room", async () => {
  const { t } = await seededRooms();

  expect(
    await errorKind(
      t.action(api.referenceScene.start, {
        request: REQUEST,
        displayName: "Juan",
      }),
    ),
  ).toBe("Unauthorized");
  expect(referenceLlm).not.toHaveBeenCalled();
});

it("takes the opener's rate limit token before searching or calling a model", async () => {
  const rooms = await seededRooms();
  const object = vi.fn();
  vi.mocked(referenceLlm).mockReturnValue(createFakeLlmProvider({ object }));
  for (let i = 0; i < 10; i++) {
    await rooms.open({ human: { displayName: "Juan" } });
  }
  rooms.createLlm.mockClear();
  rooms.judge.mockClear();

  expect(
    await errorKind(
      rooms.t.withIdentity(ROOM_OWNER).action(api.referenceScene.start, {
        request: REQUEST,
        displayName: "Juan",
      }),
    ),
  ).toBe("RateLimited");
  expect(object).not.toHaveBeenCalled();
  expect(rooms.createLlm).not.toHaveBeenCalled();
  expect(rooms.judge).not.toHaveBeenCalled();
});

it("spends a token on every launch, even one that opens no room", async () => {
  const { t } = await seededRooms();
  vi.mocked(referenceLlm).mockReturnValue(createFakeLlmProvider());
  const start = () =>
    t.withIdentity(ROOM_OWNER).action(api.referenceScene.start, {
      request: "Necesito un gimnasio en Pirque",
      displayName: "Juan",
    });
  for (let i = 0; i < 10; i++) expect(await start()).toBeNull();
  expect(await errorKind(start())).toBe("RateLimited");
});
