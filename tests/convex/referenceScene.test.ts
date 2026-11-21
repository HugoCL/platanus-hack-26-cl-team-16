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
