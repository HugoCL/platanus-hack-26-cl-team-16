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

export type TextInterpretation = {
  category: string | null;
  comuna: string | null;
  source: "parser" | "llm" | "none";
};

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

function firstMatch(text: string, phrases: readonly string[]): number {
  let best = -1;
  for (const phrase of phrases) {
    const pattern = new RegExp(
      `(?<![a-z0-9])${phrase.replace(/ /g, "\\s+")}(?:s|es)?(?![a-z0-9])`,
    );
    const index = text.search(pattern);
    if (index !== -1 && (best === -1 || index < best)) best = index;
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

export function parseDirectoryText(
  text: string,
  categories: readonly Category[],
): Omit<TextInterpretation, "source"> {
  const normalized = normalize(text);

  const categoryHits = categories
    .map((c) => ({
      slug: c.slug,
      index: firstMatch(normalized, [
        normalize(c.slug),
        normalize(c.label),
        ...(CATEGORY_SYNONYMS[c.slug] ?? []),
      ]),
    }))
    .filter((hit) => hit.index !== -1);
  const category =
    categoryHits
      .filter(
        (hit) =>
          !categoryHits.some((other) =>
            isAncestor(hit.slug, other.slug, categories),
          ),
      )
      .sort((a, b) => a.index - b.index)[0]?.slug ?? null;

  const comunaHits = [
    ...COMUNAS.map((comuna) => ({ comuna, phrase: normalize(comuna) })),
    ...Object.entries(COMUNA_ALIASES).map(([phrase, comuna]) => ({
      comuna,
      phrase,
    })),
  ]
    .map((hit) => ({ ...hit, index: firstMatch(normalized, [hit.phrase]) }))
    .filter((hit) => hit.index !== -1)
    .sort((a, b) => a.index - b.index || b.phrase.length - a.phrase.length);
  const comuna = comunaHits[0]?.comuna ?? null;

  return { category, comuna };
}

export async function interpretDirectoryText(
  text: string,
  categories: readonly Category[],
  llm: LlmProvider,
): Promise<TextInterpretation> {
  const parsed = parseDirectoryText(text, categories);
  if (parsed.category || parsed.comuna) return { ...parsed, source: "parser" };
  if (categories.length === 0) return { ...parsed, source: "none" };

  const schema = z.object({
    category: z
      .enum(categories.map((c) => c.slug) as [string, ...string[]])
      .nullable(),
    comuna: z.enum(COMUNAS).nullable(),
  });
  try {
    const answer = await llm.generateObject({
      role: "agent",
      system:
        "Traduce una búsqueda del directorio de agentes a una categoría y una comuna. Responde null en lo que la búsqueda no diga.",
      prompt: [
        `Búsqueda: ${text}`,
        `Categorías: ${categories.map((c) => `${c.slug} (${c.label})`).join(", ")}`,
        `Comunas: ${COMUNAS.join(", ")}`,
      ].join("\n"),
      schema,
    });
    if (!answer.category && !answer.comuna)
      return { ...answer, source: "none" };
    return { ...answer, source: "llm" };
  } catch (error) {
    console.warn("directory: LLM could not interpret the search", error);
    return { category: null, comuna: null, source: "none" };
  }
}
