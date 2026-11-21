import { describe, expect, it } from "vitest";
import { AgentCard, effectiveAllowedIntents } from "../shared/agent";
import {
  Availability,
  Category,
  Offering,
  validateOfferingAttributes,
} from "../shared/catalog";
import {
  CLINIC_AGENT_SLUG,
  SEED_AGENTS,
  SEED_AVAILABILITY,
  SEED_CATEGORIES,
  SEED_OFFERINGS,
} from "../shared/seedData";

const categorySlugs = new Set(SEED_CATEGORIES.map((c) => c.slug));

describe("seed data", () => {
  it.each(SEED_AGENTS.map(({ card }) => [card.slug, card]))(
    "card %s is valid and uses known categories",
    (_slug, card) => {
      expect(AgentCard.safeParse(card).error?.issues ?? []).toEqual([]);
      for (const slug of card.categories) {
        expect(categorySlugs).toContain(slug);
      }
    },
  );

  it("has at least 10 cards across distinct categories", () => {
    expect(SEED_AGENTS.length).toBeGreaterThanOrEqual(10);
    const primaries = new Set(
      SEED_AGENTS.map(({ card }) => card.categories[0]),
    );
    expect(primaries.size).toBeGreaterThanOrEqual(10);
  });

  it("categories are valid and every parent exists", () => {
    for (const category of SEED_CATEGORIES) {
      expect(Category.safeParse(category).success).toBe(true);
      if (category.parent) expect(categorySlugs).toContain(category.parent);
    }
  });

  it.each(SEED_OFFERINGS.map((seed) => [seed.key, seed]))(
    "offering %s is valid against its category schema",
    (_key, seed) => {
      expect(Offering.safeParse(seed.offering).error?.issues ?? []).toEqual([]);
      const attributes = validateOfferingAttributes(
        seed.offering,
        SEED_CATEGORIES,
      );
      expect(attributes.error?.issues ?? []).toEqual([]);
      expect(SEED_AGENTS.map(({ card }) => card.slug)).toContain(
        seed.agentSlug,
      );
    },
  );

  it("rejects offering attributes outside the category schema", () => {
    const missing = validateOfferingAttributes(
      { category: "cardiologia", attributes: { specialty: "Cardiología" } },
      SEED_CATEGORIES,
    );
    expect(missing.success).toBe(false);
    const extra = validateOfferingAttributes(
      {
        category: "hoteleria",
        attributes: { beds: 2, capacity: 2, pool: true },
      },
      SEED_CATEGORIES,
    );
    expect(extra.success).toBe(false);
  });

  it("every availability is valid and belongs to a bookable offering", () => {
    const bookable = new Set(
      SEED_OFFERINGS.filter((s) => s.offering.kind === "bookable").map(
        (s) => s.key,
      ),
    );
    for (const seed of SEED_AVAILABILITY) {
      expect(Availability.safeParse(seed.availability).success).toBe(true);
      expect(bookable).toContain(seed.offeringKey);
    }
  });

  it("the clinic has 2 practitioners with 4 open slots", () => {
    const clinicOfferings = SEED_OFFERINGS.filter(
      (s) => s.agentSlug === CLINIC_AGENT_SLUG,
    );
    const practitioners = new Set(
      clinicOfferings.map((s) => s.offering.attributes.practitioner),
    );
    expect(practitioners.size).toBe(2);
    const keys = new Set(clinicOfferings.map((s) => s.key));
    const slots = SEED_AVAILABILITY.filter((s) => keys.has(s.offeringKey));
    expect(slots).toHaveLength(4);
    for (const { availability } of slots) {
      expect(availability).toMatchObject({
        unit: "slot",
        capacity: 1,
        booked: 0,
      });
    }
  });

  it("covers hotel nights and commerce products with price and image", () => {
    expect(SEED_AVAILABILITY.some((s) => s.availability.unit === "night")).toBe(
      true,
    );
    const commerceAgents = new Set(
      SEED_OFFERINGS.filter(
        (s) =>
          s.offering.kind === "product" &&
          s.offering.price &&
          s.offering.images.some((img) => img.kind === "url"),
      ).map((s) => s.agentSlug),
    );
    expect(commerceAgents.size).toBeGreaterThanOrEqual(2);
  });

  it("capabilities feed the allowed intents", () => {
    const clinic = SEED_AGENTS.find(
      ({ card }) => card.slug === CLINIC_AGENT_SLUG,
    );
    expect(clinic && effectiveAllowedIntents(clinic.card)).toEqual(
      expect.arrayContaining([
        "check_availability",
        "book",
        "ask_info",
        "cancel_booking",
      ]),
    );
  });
});
