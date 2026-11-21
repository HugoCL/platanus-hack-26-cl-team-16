import { beforeEach, vi } from "vitest";

const fetchSpy = vi.fn(async (input: unknown) => {
  throw new Error(`outbound network is disabled in tests: ${String(input)}`);
});

vi.stubGlobal("fetch", fetchSpy);

beforeEach(() => {
  fetchSpy.mockClear();
});
