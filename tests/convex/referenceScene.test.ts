// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { referenceLlm } from "../../convex/referenceLlm";
import { createFakeLlmProvider } from "../../shared/providers/llm";
import { errorKind, REQUEST, seededRooms } from "./roomFixture";
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
      t.action(internal.referenceScene.start, {
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
    await t.action(internal.referenceScene.start, {
      request: "Necesito un gimnasio en Pirque",
      displayName: "Juan",
    }),
  ).toBeNull();
});
