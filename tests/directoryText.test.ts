import { describe, expect, it, vi } from "vitest";
import {
  canonicalComuna,
  interpretDirectoryText,
  type LlmFallback,
  parseDirectoryText,
} from "../lib/directory";
import {
  createFakeLlmProvider,
  type LlmProvider,
} from "../shared/providers/llm";
import { SEED_CATEGORIES } from "../shared/seedData";

const parse = (text: string) => parseDirectoryText(text, SEED_CATEGORIES);

const fallback = (createLlm: () => LlmProvider): LlmFallback => ({
  acquire: async () => {},
  createLlm,
});
const noLlm = fallback(() => {
  throw new Error("the LLM must not be created");
});
noLlm.acquire = async () => {
  throw new Error("the LLM must not be requested");
};

describe("free-text parser", () => {
  it.each([
    ["cardiólogo en Providencia", "cardiologia", "Providencia"],
    ["Necesito una CARDIÓLOGA en providencia", "cardiologia", "Providencia"],
    ["dentista en Ñuñoa", "odontologia", "Ñuñoa"],
    ["dentistas en nunoa", "odontologia", "Ñuñoa"],
    ["clínica en Providencia", "salud", "Providencia"],
    ["clínica de cardiología", "cardiologia", null],
    ["un café en Las Condes", "cafeteria", "Las Condes"],
    ["gasfiter Maipu urgente", "gasfiteria", "Maipú"],
    ["abogado en Santiago Centro", "abogados", "Santiago"],
    ["abogado en Santiago de Chile", "abogados", "Santiago"],
    ["dentista barato", "odontologia", null],
    ["algo en Estación Central", null, "Estación Central"],
    ["cardiólogo en Providencia este sábado", "cardiologia", "Providencia"],
    ["dentista en Ñuñoa barato", "odontologia", "Ñuñoa"],
    ["cardiólogo en Providencia en la tarde", "cardiologia", "Providencia"],
    ["dentista en Ñuñoa cerca del metro", "odontologia", "Ñuñoa"],
    ["hola", null, null],
  ])("%s", (text, category, comuna) => {
    expect(parse(text)).toEqual({ category, comuna, unresolved: [] });
  });

  it.each([
    ["cardiólogo en Narnia", "cardiologia", null, ["comuna"]],
    ["cardiólogo en Providencias", "cardiologia", null, ["comuna"]],
    ["abogado en Santiago de Compostela", "abogados", null, ["comuna"]],
    ["abogado Santiago de Compostela", "abogados", null, ["comuna"]],
    ["me duele el pecho en Providencia", null, "Providencia", ["category"]],
    ["xyzzy qwerty", null, null, ["category"]],
  ])(
    "flags what it could not resolve: %s",
    (text, category, comuna, unresolved) => {
      expect(parse(text)).toEqual({ category, comuna, unresolved });
    },
  );

  it("canonicalizes comunas", () => {
    expect(canonicalComuna("las condes")).toBe("Las Condes");
    expect(canonicalComuna("Providencias")).toBeNull();
    expect(canonicalComuna("Narnia")).toBeNull();
  });

  it("ignores inherited object properties in its dictionaries", () => {
    for (const word of ["constructor", "__proto__", "toString"]) {
      expect(canonicalComuna(word)).toBeNull();
      expect(
        parseDirectoryText(word, [
          ...SEED_CATEGORIES,
          {
            slug: word === "__proto__" ? "proto" : word.toLowerCase(),
            parent: null,
            label: "Rara",
            attributeSchema: [],
          },
        ]),
      ).toMatchObject({ comuna: null });
    }
  });
});

describe("LLM fallback", () => {
  it("leaves what the parser cannot read unresolved when there is no fallback", async () => {
    await expect(
      interpretDirectoryText("me duele el pecho", SEED_CATEGORIES, null),
    ).resolves.toEqual({
      category: null,
      comuna: null,
      unresolved: ["category"],
      source: "none",
    });
  });

  it("is not requested when the parser resolves everything", async () => {
    await expect(
      interpretDirectoryText(
        "cardiólogo en Providencia",
        SEED_CATEGORIES,
        noLlm,
      ),
    ).resolves.toEqual({
      category: "cardiologia",
      comuna: "Providencia",
      unresolved: [],
      source: "parser",
    });
    await expect(
      interpretDirectoryText("hola", SEED_CATEGORIES, noLlm),
    ).resolves.toEqual({
      category: null,
      comuna: null,
      unresolved: [],
      source: "none",
    });
  });

  it("is not requested for a field the caller already supplied", async () => {
    await expect(
      interpretDirectoryText(
        "cardiólogo en Valparaíso",
        SEED_CATEGORIES,
        noLlm,
        ["comuna"],
      ),
    ).resolves.toEqual({
      category: "cardiologia",
      comuna: null,
      unresolved: [],
      source: "parser",
    });
    await expect(
      interpretDirectoryText("algo rarísimo zzz", SEED_CATEGORIES, noLlm, [
        "category",
      ]),
    ).resolves.toEqual({
      category: null,
      comuna: null,
      unresolved: [],
      source: "none",
    });
    await expect(
      interpretDirectoryText("dentista en Ñuñoa", SEED_CATEGORIES, noLlm, [
        "category",
        "comuna",
      ]),
    ).resolves.toEqual({
      category: null,
      comuna: null,
      unresolved: [],
      source: "none",
    });
  });

  it("fills only the half the parser could not resolve", async () => {
    const llm = createFakeLlmProvider({
      object: () => ({ category: "cardiologia", comuna: "Las Condes" }),
    });
    await expect(
      interpretDirectoryText(
        "me duele el pecho en Providencia",
        SEED_CATEGORIES,
        fallback(() => llm),
      ),
    ).resolves.toEqual({
      category: "cardiologia",
      comuna: "Providencia",
      unresolved: [],
      source: "llm",
    });
  });

  it("keeps a half unresolved when the LLM cannot name it", async () => {
    const llm = createFakeLlmProvider({
      object: () => ({ category: null, comuna: null }),
    });
    await expect(
      interpretDirectoryText(
        "cardiólogo en Narnia",
        SEED_CATEGORIES,
        fallback(() => llm),
      ),
    ).resolves.toEqual({
      category: "cardiologia",
      comuna: null,
      unresolved: ["comuna"],
      source: "parser",
    });
  });

  it("reports an unavailable LLM with a fixed diagnostic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failures: Array<() => LlmProvider> = [
      () => {
        throw new Error("OPENROUTER_API_KEY is not set");
      },
      () =>
        createFakeLlmProvider({
          object: () => ({ category: "astrologia", comuna: "Narnia" }),
        }),
    ];
    for (const createLlm of failures) {
      await expect(
        interpretDirectoryText(
          "lectura de tarot",
          SEED_CATEGORIES,
          fallback(createLlm),
        ),
      ).resolves.toEqual({
        category: null,
        comuna: null,
        unresolved: ["category"],
        source: "none",
        diagnostic: "llm_unavailable",
      });
    }
    expect(warn.mock.calls).toEqual([
      ["directory: LLM fallback unavailable"],
      ["directory: LLM fallback unavailable"],
    ]);
    warn.mockRestore();
  });

  it("lets a refused rate-limit token reach the caller", async () => {
    await expect(
      interpretDirectoryText("me duele el pecho", SEED_CATEGORIES, {
        acquire: async () => {
          throw new Error("RateLimited");
        },
        createLlm: () => createFakeLlmProvider(),
      }),
    ).rejects.toThrow("RateLimited");
  });
});
