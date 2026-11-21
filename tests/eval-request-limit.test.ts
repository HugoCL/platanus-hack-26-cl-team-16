import { expect, it } from "vitest";
import { createRequestLimit } from "../evals/request-limit";

it.each([1, 2, 4])("caps concurrent judge requests at %i", async (limit) => {
  const run = createRequestLimit(limit);
  let active = 0;
  let peak = 0;
  const request = () =>
    run(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return "allow";
    });
  const samples = [
    () => Promise.all([request(), request()]),
    request,
    request,
    () => Promise.all([request(), request()]),
  ];
  expect(await Promise.all(samples.map((sample) => sample()))).toEqual([
    ["allow", "allow"],
    "allow",
    "allow",
    ["allow", "allow"],
  ]);
  expect(peak).toBe(limit);
  expect(active).toBe(0);
});

it("releases a slot after a failed request", async () => {
  const run = createRequestLimit(1);
  const failed = run(async () => {
    throw new Error("provider failure");
  });
  const next = run(async () => "allow");
  await expect(failed).rejects.toThrow("provider failure");
  await expect(next).resolves.toBe("allow");
});

it("makes no requests for an empty batch", async () => {
  const run = createRequestLimit(1);
  expect(await Promise.all([].map(() => run(async () => "allow")))).toEqual([]);
});

it.each([0, -1, 1.5, Number.NaN])("rejects invalid concurrency %s", (limit) => {
  expect(() => createRequestLimit(limit)).toThrow("positive integer");
});

it.each([2, 3, 4])(
  "reserves both judge slots before starting a sample at limit %i",
  async (limit) => {
    const run = createRequestLimit(limit);
    let active = 0;
    const starts: number[] = [];
    await Promise.all(
      [2, 1, 2, 1].map((weight) =>
        run(async () => {
          active += weight;
          starts.push(weight);
          expect(active).toBeLessThanOrEqual(limit);
          await Promise.resolve();
          active -= weight;
        }, weight),
      ),
    );
    expect(starts).toEqual([2, 1, 2, 1]);
    expect(active).toBe(0);
  },
);

it("releases all reserved slots after a sample fails", async () => {
  const run = createRequestLimit(2);
  const failed = run(async () => {
    throw new Error("sample failed");
  }, 2);
  const next = run(async () => "allow", 2);
  await expect(failed).rejects.toThrow("sample failed");
  await expect(next).resolves.toBe("allow");
});

it.each([0, -1, 1.5, Number.NaN, 3])(
  "rejects invalid sample weight %s",
  async (weight) => {
    await expect(
      createRequestLimit(2)(async () => "allow", weight),
    ).rejects.toThrow("request weight");
  },
);
