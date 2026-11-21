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

export const MAX_QUERY_LENGTH = 300;

const COMUNA_ALIASES = new Map<string, (typeof COMUNAS)[number]>([
  ["santiago centro", "Santiago"],
  ["santiago de chile", "Santiago"],
  ["til til", "Tiltil"],
]);

const CATEGORY_SYNONYMS = new Map<string, string[]>(
  Object.entries({
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
  }),
);

export type DirectoryField = "category" | "comuna";

export type ParsedText = {
  category: string | null;
  comuna: string | null;
  unresolved: DirectoryField[];
};

export type TextInterpretation = ParsedText & {
  source: "parser" | "llm" | "none";
  diagnostic?: "llm_unavailable";
};

export type LlmFallback = {
  acquire: () => Promise<void>;
  createLlm: () => LlmProvider;
};

const STOPWORDS = new Set(
  `a agente agentes al algo alguien alguna alguno busco buscar con de del el
  ella en esta este favor hay hola hoy la las lo los manana me mi necesito noche
  o para por pronto proxima proximo que quiero semana tarde un una unas unos
  urgente y lunes martes miercoles jueves viernes sabado domingo`.split(/\s+/),
);
const PLACE_MARKERS = new Set(["en", "cerca", "comuna"]);
const NAME_CONNECTORS = new Set(["de", "del"]);
const ARTICLES = new Set(["el", "la", "los", "las"]);

type Phrase = { words: string[]; plural: boolean };
type Match = { start: number; end: number };
type Role = "category" | "comuna" | "marker" | "stop" | "other";

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
    COMUNA_ALIASES.get(key) ??
    null
  );
}

export function resolveCategory<C extends Pick<Category, "slug" | "label">>(
  input: string,
  categories: readonly C[],
): C | null {
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

function wordMatches(word: string, target: string, plural: boolean) {
  return (
    word === target ||
    (plural && (word === `${target}s` || word === `${target}es`))
  );
}

function firstMatch(words: string[], phrases: Phrase[]): Match | null {
  let best: Match | null = null;
  for (const phrase of phrases) {
    for (let start = 0; start + phrase.words.length <= words.length; start++) {
      const hit = phrase.words.every((target, k) =>
        wordMatches(
          words[start + k],
          target,
          phrase.plural && k === phrase.words.length - 1,
        ),
      );
      if (!hit) continue;
      const end = start + phrase.words.length;
      if (
        !best ||
        start < best.start ||
        (start === best.start && end > best.end)
      ) {
        best = { start, end };
      }
      break;
    }
  }
  return best;
}

const phrase = (text: string, plural: boolean): Phrase => ({
  words: normalize(text).split(" "),
  plural,
});

const inside = (i: number, match: Match) => i >= match.start && i < match.end;

function isAncestor(
  ancestor: string,
  slug: string,
  categories: readonly Category[],
): boolean {
  return (
    ancestor !== slug && categoryWithDescendants(ancestor, categories).has(slug)
  );
}

function extendsPlaceName(words: string[], roles: Role[], end: number) {
  if (!NAME_CONNECTORS.has(words[end] ?? "")) return false;
  let next = end + 1;
  while (ARTICLES.has(words[next] ?? "")) next++;
  return roles[next] === "other";
}

export function parseDirectoryText(
  text: string,
  categories: readonly Category[],
): ParsedText {
  const words = normalize(text).split(" ").filter(Boolean);

  const categoryHits = categories.flatMap((c) => {
    const match = firstMatch(words, [
      phrase(c.slug, true),
      phrase(c.label, true),
      ...(CATEGORY_SYNONYMS.get(c.slug) ?? []).map((p) => phrase(p, true)),
    ]);
    return match ? [{ slug: c.slug, match }] : [];
  });
  const category =
    categoryHits
      .filter(
        (hit) =>
          !categoryHits.some((other) =>
            isAncestor(hit.slug, other.slug, categories),
          ),
      )
      .sort((a, b) => a.match.start - b.match.start)[0]?.slug ?? null;

  const comunaHit = [
    ...COMUNAS.map((comuna) => ({ comuna, phrase: phrase(comuna, false) })),
    ...[...COMUNA_ALIASES].map(([alias, comuna]) => ({
      comuna,
      phrase: phrase(alias, false),
    })),
  ]
    .flatMap((hit) => {
      const match = firstMatch(words, [hit.phrase]);
      return match ? [{ comuna: hit.comuna, match }] : [];
    })
    .sort(
      (a, b) => a.match.start - b.match.start || b.match.end - a.match.end,
    )[0];

  const roles: Role[] = words.map((word, i) =>
    categoryHits.some((hit) => inside(i, hit.match))
      ? "category"
      : comunaHit && inside(i, comunaHit.match)
        ? "comuna"
        : PLACE_MARKERS.has(word)
          ? "marker"
          : STOPWORDS.has(word)
            ? "stop"
            : "other",
  );

  const needWords: string[] = [];
  const placeWords: string[] = [];
  let inPlace = false;
  roles.forEach((role, i) => {
    if (role === "marker") inPlace = true;
    else if (role === "category" || role === "comuna") inPlace = false;
    else if (role === "other")
      (inPlace ? placeWords : needWords).push(words[i]);
  });

  const extended =
    comunaHit !== undefined &&
    extendsPlaceName(words, roles, comunaHit.match.end);
  const comuna = comunaHit && !extended ? comunaHit.comuna : null;

  const unresolved: DirectoryField[] = [];
  if (!category && needWords.length > 0) unresolved.push("category");
  if (!comuna && (extended || placeWords.length > 0)) unresolved.push("comuna");
  return { category, comuna, unresolved };
}

async function askLlm(
  text: string,
  categories: readonly Category[],
  fallback: LlmFallback,
) {
  await fallback.acquire();
  const schema = z.object({
    category: z
      .enum(categories.map((c) => c.slug) as [string, ...string[]])
      .nullable(),
    comuna: z.enum(COMUNAS).nullable(),
  });
  try {
    return await fallback.createLlm().generateObject({
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
  } catch {
    console.warn("directory: LLM fallback unavailable");
    return null;
  }
}

export async function interpretDirectoryText(
  text: string,
  categories: readonly Category[],
  fallback: LlmFallback,
): Promise<TextInterpretation> {
  const parsed = parseDirectoryText(text, categories);
  const asked = parsed.unresolved.length > 0 && categories.length > 0;
  const answer = asked ? await askLlm(text, categories, fallback) : null;
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
    ...(asked && answer === null
      ? { diagnostic: "llm_unavailable" as const }
      : {}),
  };
}
