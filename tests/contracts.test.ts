import { describe, expect, it } from "vitest";
import { CONTRACT_EXAMPLES } from "../shared/examples";
import { PHASE1_UI_COMPONENTS } from "../shared/genui";

describe.each(Object.entries(CONTRACT_EXAMPLES))("%s", (_name, examples) => {
  it("has at least one valid and one invalid example", () => {
    expect(examples.valid.length).toBeGreaterThan(0);
    expect(examples.invalid.length).toBeGreaterThan(0);
  });

  it.each(examples.valid.map((value, i) => [i, value]))(
    "accepts valid example %i",
    (_i, value) => {
      const result = examples.schema.safeParse(value);
      expect(result.error?.issues ?? []).toEqual([]);
    },
  );

  it.each(examples.invalid.map(({ why, value }) => [why, value]))(
    "rejects: %s",
    (_why, value) => {
      expect(examples.schema.safeParse(value).success).toBe(false);
    },
  );
});

it("phase-1 catalog is the four agreed components", () => {
  expect([...PHASE1_UI_COMPONENTS].sort()).toEqual(
    ["card", "confirmation", "moderator_alert", "slot_picker"].sort(),
  );
});
