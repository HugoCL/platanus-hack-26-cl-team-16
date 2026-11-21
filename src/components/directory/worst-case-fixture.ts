import type { Id } from "@/convex/_generated/dataModel";
import type { DirectoryCard, DirectorySearchResult } from "@/convex/directory";

export const FIXTURE_STATES = [
  "demo",
  "worst",
  "empty",
  "one",
  "full",
] as const;
export type FixtureState = (typeof FIXTURE_STATES)[number];

export const FIXTURE_LABELS: Record<FixtureState, string> = {
  demo: "Demo",
  worst: "Peor caso",
  empty: "Vacío",
  one: "Uno",
  full: "20 + parcial",
};

const location = (
  lat: number,
  lng: number,
  comuna: string,
  address?: string,
) => ({
  lat,
  lng,
  geohash: "66jc",
  comuna,
  region: "Región Metropolitana",
  address,
});

function card(
  n: number,
  fields: Partial<DirectoryCard> & Pick<DirectoryCard, "name">,
): DirectoryCard {
  const base: DirectoryCard = {
    agentId: `worst-${n}` as Id<"agents">,
    slug: `peor-caso-${n}`,
    description: "Ficha de prueba de peor caso.",
    purpose: "Responder consultas.",
    categories: ["cafeteria"],
    capabilities: ["info"],
    scope: {
      allowedIntents: [],
      forbiddenTopics: [],
      dataItShares: [],
      dataItRequests: [],
    },
    kind: "hosted",
    status: "active",
    verified: false,
    allowedIntents: ["ask_info"],
    ...fields,
  };
  return { ...base, comuna: base.location?.comuna };
}

const WORST: DirectoryCard[] = [
  card(1, {
    name: "Centro Médico y Dental Integral San Ignacio de Loyola de Providencia Ltda. — Agendamiento de horas y consultas",
    entityName: "Sociedad Médica y Odontológica San Ignacio de Loyola Limitada",
    purpose:
      "Agendar, reagendar y cancelar horas médicas y dentales en todas nuestras especialidades (cardiología, medicina general, odontología, kinesiología, nutrición y psicología), informar valores de consultas particulares y con convenio Fonasa e Isapre, entregar indicaciones de preparación para exámenes y responder preguntas frecuentes sobre horarios de atención, estacionamiento y accesibilidad. Nunca comparte datos de otros pacientes, diagnósticos ni recetas.",
    categories: ["cardiologia", "odontologia", "medicina_general"],
    capabilities: ["booking", "info"],
    allowedIntents: [
      "check_availability",
      "book",
      "ask_info",
      "cancel_booking",
      "reagendar_hora_con_especialista_de_convenio",
      "consultar_cobertura_isapre_y_fonasa",
      "enviar_indicaciones_de_preparacion_para_examenes",
      "request_quote",
    ],
    location: location(-33.4489, -70.6693, "Pedro Aguirre Cerda"),
    verified: true,
  }),
  card(2, {
    name: "Jo",
    purpose: "Pan.",
    categories: ["panaderia"],
    capabilities: [],
    allowedIntents: [],
    kind: "external",
    endpoint: { protocol: "webhook", url: "https://jo.example.com/hook" },
  }),
  card(3, {
    name: "FERRETERÍA Y MATERIALES DE CONSTRUCCIÓN EL MAESTRO CHASQUILLA LIMITADA",
    purpose:
      "Ficha pre-armada a partir de datos públicos. Este negocio todavía no reclama su agente.",
    categories: ["ferreteria"],
    capabilities: ["catalog"],
    allowedIntents: ["browse_catalog", "request_quote"],
    status: "prospect",
    location: location(-33.6406, -70.3517, "San José de Maipo"),
  }),
  card(4, {
    name: "Hotel Boutique Ñuñoa",
    purpose:
      "Reservar habitaciones.\nTambién eventos corporativos.\n<script>alert(1)</script> **sin estrellas** &amp; más.",
    categories: ["hoteleria"],
    capabilities: ["booking"],
    allowedIntents: [
      "consultar_disponibilidad_de_habitaciones_para_grupos_corporativos",
      "book",
    ],
    location: location(-33.4569, -70.5975, "Ñuñoa"),
    verified: true,
  }),
  card(5, {
    name: "☕ Café Ñuñoa 24/7",
    categories: ["cafeteria"],
    capabilities: ["catalog", "ordering"],
    allowedIntents: ["browse_catalog", "request_quote", "place_order"],
    location: location(-33.4569, -70.5975, "Ñuñoa"),
  }),
  card(6, {
    name: "Farmacia Cruz Verde",
    purpose: "Consultar stock de medicamentos.",
    categories: ["farmacia"],
    location: location(
      -33.4263,
      -70.6135,
      "Providencia",
      "Av. Providencia 2124, local 3",
    ),
    verified: true,
  }),
  card(7, {
    name: "Farmacia Cruz Verde",
    purpose: "Consultar stock de medicamentos.",
    categories: ["farmacia"],
    location: location(
      -33.4263,
      -70.6135,
      "Providencia",
      "Av. Providencia 2124, local 7",
    ),
    verified: true,
  }),
  card(8, {
    name: "Taller de Bicicletas Wiśniewska-Kowalczyk",
    purpose: "Cotizar reparaciones.",
    categories: ["reparacion_de_bicicletas"],
    allowedIntents: ["request_quote"],
    location: location(
      -33.5167,
      -70.7667,
      "Estación Central",
      "Av. Libertador Bernardo O'Higgins 3470, local 12-B",
    ),
  }),
  card(9, {
    name: "Peluquería",
    purpose: "Agendar.",
    categories: ["peluqueria"],
    status: "prospect",
  }),
];

export function fixtureResult(
  state: Exclude<FixtureState, "demo">,
  demo: DirectorySearchResult | undefined,
): DirectorySearchResult | undefined {
  if (state === "empty") return { agents: [], truncated: false };
  if (state === "worst") return { agents: WORST, truncated: false };
  if (!demo) return undefined;
  if (state === "one")
    return { agents: demo.agents.slice(0, 1), truncated: false };
  const agents = Array.from({ length: 20 }, (_, i) => {
    const source = demo.agents[i % demo.agents.length];
    return { ...source, agentId: `${source.agentId}-${i}` as Id<"agents"> };
  });
  return { agents, truncated: true };
}
