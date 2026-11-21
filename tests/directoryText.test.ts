import { describe, expect, it } from "vitest";
import {
  canonicalComuna,
  interpretDirectoryText,
  parseDirectoryText,
} from "../lib/directory";
import { createFakeLlmProvider } from "../shared/providers/llm";
import { SEED_CATEGORIES } from "../shared/seedData";

const parse = (text: string) => parseDirectoryText(text, SEED_CATEGORIES);

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
    ["algo en Estación Central", null, "Estación Central"],
    ["hola", null, null],
  ])("%s", (text, category, comuna) => {
    expect(parse(text)).toEqual({ category, comuna });
  });

  it("canonicalizes comunas", () => {
    expect(canonicalComuna("las condes")).toBe("Las Condes");
    expect(canonicalComuna("Narnia")).toBeNull();
  });
});

describe("LLM fallback", () => {
  it("is not called when the parser finds something", async () => {
    const llm = createFakeLlmProvider({
      object: () => {
        throw new Error("must not be called");
      },
    });
    await expect(
      interpretDirectoryText("cardiólogo en Providencia", SEED_CATEGORIES, llm),
    ).resolves.toEqual({
      category: "cardiologia",
      comuna: "Providencia",
      source: "parser",
    });
  });

  it("is used when the parser finds nothing", async () => {
    const llm = createFakeLlmProvider({
      object: ({ prompt }) =>
        prompt.includes("me duele el pecho")
          ? { category: "cardiologia", comuna: "Providencia" }
          : { category: null, comuna: null },
    });
    await expect(
      interpretDirectoryText(
        "me duele el pecho, algo cerca de la oficina",
        SEED_CATEGORIES,
        llm,
      ),
    ).resolves.toEqual({
      category: "cardiologia",
      comuna: "Providencia",
      source: "llm",
    });
  });

  it("ignores answers outside the known categories and comunas", async () => {
    const llm = createFakeLlmProvider({
      object: () => ({ category: "astrologia", comuna: "Narnia" }),
    });
    await expect(
      interpretDirectoryText("lectura de tarot", SEED_CATEGORIES, llm),
    ).resolves.toEqual({ category: null, comuna: null, source: "none" });
  });
});
