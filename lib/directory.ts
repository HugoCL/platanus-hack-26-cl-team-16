import { z } from "zod";
import type { Category } from "../shared/catalog";
import type { LlmProvider } from "../shared/providers/llm";

export const COMUNAS = [
  "Alhué",
  "Buin",
  "Calera de Tango",
  "Cerrillos",
  "Cerro Navia",
  "Colina",
  "Conchalí",
  "Curacaví",
  "El Bosque",
  "El Monte",
  "Estación Central",
  "Huechuraba",
  "Independencia",
  "Isla de Maipo",
  "La Cisterna",
  "La Florida",
  "La Granja",
  "La Pintana",
  "La Reina",
  "Lampa",
  "Las Condes",
  "Lo Barnechea",
  "Lo Espejo",
  "Lo Prado",
  "Macul",
  "Maipú",
  "María Pinto",
  "Melipilla",
  "Ñuñoa",
  "Padre Hurtado",
  "Paine",
  "Pedro Aguirre Cerda",
  "Peñaflor",
  "Peñalolén",
  "Pirque",
  "Providencia",
  "Pudahuel",
  "Puente Alto",
  "Quilicura",
  "Quinta Normal",
  "Recoleta",
  "Renca",
  "San Bernardo",
  "San Joaquín",
  "San José de Maipo",
  "San Miguel",
  "San Pedro",
  "San Ramón",
  "Santiago",
  "Talagante",
  "Tiltil",
  "Vitacura",
] as const;

const COMUNA_ALIASES: Record<string, (typeof COMUNAS)[number]> = {
  "santiago centro": "Santiago",
  "til til": "Tiltil",
};

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  salud: ["clinica", "centro de salud"],
  cardiologia: ["cardiologo", "cardiologa", "corazon"],
  medicina_general: [
    "medico",
    "medica",
    "doctor",
    "doctora",
    "medico general",
    "consulta medica",
  ],
  odontologia: ["dentista", "odontologo", "odontologa", "dental", "diente"],
  hoteleria: ["hotel", "hostal", "alojamiento", "hospedaje"],
  cafeteria: ["cafe", "cafecito"],
  panaderia: ["pan", "panadero", "marraqueta"],
  ferreteria: ["herramienta", "tornillo"],
  veterinaria: ["veterinario", "vet", "mascota"],
  peluqueria: [
    "peluquero",
    "peluquera",
    "barberia",
    "barbero",
    "corte de pelo",
  ],
  abogados: ["abogado", "abogada", "juridico", "estudio juridico"],
  gasfiteria: ["gasfiter", "plomero"],
  gimnasio: ["gym", "entrenamiento"],
  farmacia: ["remedio", "medicamento"],
};

export type DirectoryField = "category" | "comuna";

export type ParsedText = {
  category: string | null;
  comuna: string | null;
  unresolved: DirectoryField[];
};

export type TextInterpretation = ParsedText & {
  source: "parser" | "llm" | "none";
};

const STOPWORDS = new Set([
  "a",
  "agente",
  "agentes",
  "al",
  "algo",
  "alguien",
  "alguna",
  "alguno",
  "busco",
  "buscar",
  "cerca",
  "comuna",
  "con",
  "de",
  "del",
  "el",
  "en",
  "favor",
  "hay",
  "hola",
  "la",
  "las",
  "lo",
  "los",
  "me",
  "mi",
  "necesito",
  "o",
  "para",
  "por",
  "que",
  "quiero",
  "un",
  "una",
  "unas",
  "unos",
  "y",
]);

const PLACE_MARKER = /(?<![a-z0-9])(cerca de|comuna de|comuna|en)(?![a-z0-9])/g;

type Span = { start: number; end: number };

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function canonicalComuna(input: string): string | null {
  const key = normalize(input);
  return (
    COMUNAS.find((comuna) => normalize(comuna) === key) ??
    COMUNA_ALIASES[key] ??
    null
  );
}

export function resolveCategory(
  input: string,
  categories: readonly Category[],
): Category | null {
  const key = normalize(input);
  return (
    categories.find((c) => c.slug === input) ??
    categories.find(
      (c) => normalize(c.slug) === key || normalize(c.label) === key,
    ) ??
    null
  );
}

export function categoryWithDescendants(
  slug: string,
  categories: readonly Category[],
): Set<string> {
  const found = new Set([slug]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parent && found.has(c.parent) && !found.has(c.slug)) {
        found.add(c.slug);
        grew = true;
      }
    }
  }
  return found;
}

function firstMatch(text: string, phrases: readonly string[]): Span | null {
  let best: Span | null = null;
  for (const phrase of phrases) {
    const found = new RegExp(
      `(?<![a-z0-9])${phrase.replace(/ /g, "\\s+")}(?:s|es)?(?![a-z0-9])`,
    ).exec(text);
    if (!found) continue;
    const span = { start: found.index, end: found.index + found[0].length };
    if (
      !best ||
      span.start < best.start ||
      (span.start === best.start && span.end > best.end)
    ) {
      best = span;
    }
  }
  return best;
}

function isAncestor(
  ancestor: string,
  slug: string,
  categories: readonly Category[],
): boolean {
  return (
    ancestor !== slug && categoryWithDescendants(ancestor, categories).has(slug)
  );
}

function contentWords(text: string): string[] {
  return text.split(/[\s|]+/).filter((w) => w && !STOPWORDS.has(w));
}

function leftovers(text: string, spans: readonly Span[]) {
  const masked = [...text]
    .map((char, i) =>
      spans.some((s) => i >= s.start && i < s.end) ? "|" : char,
    )
    .join("");
  const marker = [...masked.matchAll(PLACE_MARKER)].at(-1);
  if (!marker) return { need: contentWords(masked), place: [] };
  const rest = masked.slice(marker.index + marker[0].length);
  const cut = rest.indexOf("|");
  return {
    need: contentWords(
      `${masked.slice(0, marker.index)} ${cut === -1 ? "" : rest.slice(cut)}`,
    ),
    place: contentWords(cut === -1 ? rest : rest.slice(0, cut)),
  };
}

export function parseDirectoryText(
  text: string,
  categories: readonly Category[],
): ParsedText {
  const normalized = normalize(text);

  const categoryHits = categories.flatMap((c) => {
    const span = firstMatch(normalized, [
      normalize(c.slug),
      normalize(c.label),
      ...(CATEGORY_SYNONYMS[c.slug] ?? []),
    ]);
    return span ? [{ slug: c.slug, span }] : [];
  });
  const category =
    categoryHits
      .filter(
        (hit) =>
          !categoryHits.some((other) =>
            isAncestor(hit.slug, other.slug, categories),
          ),
      )
      .sort((a, b) => a.span.start - b.span.start)[0]?.slug ?? null;

  const comunaHits = [
    ...COMUNAS.map((comuna) => ({ comuna, phrase: normalize(comuna) })),
    ...Object.entries(COMUNA_ALIASES).map(([phrase, comuna]) => ({
      comuna,
      phrase,
    })),
  ]
    .flatMap((hit) => {
      const span = firstMatch(normalized, [hit.phrase]);
      return span ? [{ comuna: hit.comuna, span }] : [];
    })
    .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  const comuna = comunaHits[0]?.comuna ?? null;

  const { need, place } = leftovers(
    normalized,
    [...categoryHits, ...comunaHits].map((hit) => hit.span),
  );
  const unresolved: DirectoryField[] = [];
  if (!category && need.length > 0) unresolved.push("category");
  if (!comuna && place.length > 0) unresolved.push("comuna");
  return { category, comuna, unresolved };
}

async function askLlm(
  text: string,
  categories: readonly Category[],
  getLlm: () => LlmProvider,
) {
  const schema = z.object({
    category: z
      .enum(categories.map((c) => c.slug) as [string, ...string[]])
      .nullable(),
    comuna: z.enum(COMUNAS).nullable(),
  });
  try {
    return await getLlm().generateObject({
      role: "agent",
      system:
        "Traduce una búsqueda del directorio de agentes a una categoría y una comuna. Responde null en lo que la búsqueda no diga o no esté en las listas.",
      prompt: [
        `Búsqueda: ${text}`,
        `Categorías: ${categories.map((c) => `${c.slug} (${c.label})`).join(", ")}`,
        `Comunas: ${COMUNAS.join(", ")}`,
      ].join("\n"),
      schema,
    });
  } catch (error) {
    console.warn("directory: LLM could not interpret the search", error);
    return null;
  }
}

export async function interpretDirectoryText(
  text: string,
  categories: readonly Category[],
  getLlm: () => LlmProvider,
): Promise<TextInterpretation> {
  const parsed = parseDirectoryText(text, categories);
  const answer =
    parsed.unresolved.length > 0 && categories.length > 0
      ? await askLlm(text, categories, getLlm)
      : null;
  const fromLlm = {
    category: parsed.unresolved.includes("category")
      ? (answer?.category ?? null)
      : null,
    comuna: parsed.unresolved.includes("comuna")
      ? (answer?.comuna ?? null)
      : null,
  };
  const category = parsed.category ?? fromLlm.category;
  const comuna = parsed.comuna ?? fromLlm.comuna;
  return {
    category,
    comuna,
    unresolved: parsed.unresolved.filter((field) =>
      field === "category" ? !category : !comuna,
    ),
    source:
      fromLlm.category || fromLlm.comuna
        ? "llm"
        : category || comuna
          ? "parser"
          : "none",
  };
}
