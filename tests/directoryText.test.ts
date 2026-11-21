import { describe, expect, it, vi } from "vitest";
import {
  canonicalComuna,
  interpretDirectoryText,
  parseDirectoryText,
} from "../lib/directory";
import {
  createFakeLlmProvider,
  type LlmProvider,
} from "../shared/providers/llm";
import { SEED_CATEGORIES } from "../shared/seedData";

const parse = (text: string) => parseDirectoryText(text, SEED_CATEGORIES);

const noLlm = async (): Promise<LlmProvider> => {
  throw new Error("the LLM must not be created");
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
    ["dentista barato", "odontologia", null],
    ["algo en Estación Central", null, "Estación Central"],
    ["hola", null, null],
  ])("%s", (text, category, comuna) => {
    expect(parse(text)).toEqual({ category, comuna, unresolved: [] });
  });

  it("flags the half it could not resolve", () => {
    expect(parse("cardiólogo en Narnia")).toEqual({
      category: "cardiologia",
      comuna: null,
      unresolved: ["comuna"],
    });
    expect(parse("me duele el pecho en Providencia")).toEqual({
      category: null,
      comuna: "Providencia",
      unresolved: ["category"],
    });
    expect(parse("xyzzy qwerty").unresolved).toEqual(["category"]);
    expect(parse("abogado en Santiago de Compostela")).toEqual({
      category: "abogados",
      comuna: null,
      unresolved: ["comuna"],
    });
  });

  it("accepts a comuna followed by another place or a time", () => {
    expect(parse("cardiólogo en Providencia en la tarde")).toEqual({
      category: "cardiologia",
      comuna: "Providencia",
      unresolved: [],
    });
    expect(parse("dentista en Ñuñoa cerca del metro")).toEqual({
      category: "odontologia",
      comuna: "Ñuñoa",
      unresolved: [],
    });
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

  it("canonicalizes comunas", () => {
    expect(canonicalComuna("las condes")).toBe("Las Condes");
    expect(canonicalComuna("Narnia")).toBeNull();
  });
});

describe("LLM fallback", () => {
  it("is not created when the parser resolves everything", async () => {
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

  it("fills only the half the parser could not resolve", async () => {
    const llm = createFakeLlmProvider({
      object: () => ({ category: "cardiologia", comuna: "Las Condes" }),
    });
    await expect(
      interpretDirectoryText(
        "me duele el pecho en Providencia",
        SEED_CATEGORIES,
        async () => llm,
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
        async () => llm,
      ),
    ).resolves.toEqual({
      category: "cardiologia",
      comuna: null,
      unresolved: ["comuna"],
      source: "parser",
    });
  });

  it("ignores answers outside the known categories and comunas", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = createFakeLlmProvider({
      object: () => ({ category: "astrologia", comuna: "Narnia" }),
    });
    await expect(
      interpretDirectoryText(
        "lectura de tarot",
        SEED_CATEGORIES,
        async () => llm,
      ),
    ).resolves.toEqual({
      category: null,
      comuna: null,
      unresolved: ["category"],
      source: "none",
    });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
