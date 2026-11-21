import type { AgentCard } from "./agent";
import type { Availability, Category, Offering } from "./catalog";
import { encodeGeohash, type Location } from "./geo";
import type { BusinessContact } from "./prospecting";
import type { AgentScope } from "./scope";

function place(
  lat: number,
  lng: number,
  comuna: string,
  address: string,
): Location {
  return {
    lat,
    lng,
    geohash: encodeGeohash(lat, lng),
    comuna,
    region: "Región Metropolitana",
    address,
  };
}

function scope(
  dataItShares: string[],
  dataItRequests: string[],
  forbiddenTopics: string[] = ["datos de otros clientes"],
  allowedIntents: string[] = [],
): AgentScope {
  return { allowedIntents, forbiddenTopics, dataItShares, dataItRequests };
}

function image(key: string) {
  return {
    kind: "url" as const,
    url: `https://picsum.photos/seed/${key}/600/400`,
  };
}

function clp(amount: number) {
  return { amount, currency: "CLP" };
}

export const SEED_CATEGORIES: Category[] = [
  {
    slug: "salud",
    parent: null,
    label: "Salud",
    attributeSchema: [
      {
        key: "practitioner",
        label: "Profesional",
        type: "string",
        required: true,
      },
    ],
  },
  {
    slug: "cardiologia",
    parent: "salud",
    label: "Cardiología",
    attributeSchema: [
      {
        key: "specialty",
        label: "Especialidad",
        type: "string",
        required: true,
      },
    ],
  },
  {
    slug: "medicina_general",
    parent: "salud",
    label: "Medicina general",
    attributeSchema: [],
  },
  {
    slug: "odontologia",
    parent: "salud",
    label: "Odontología",
    attributeSchema: [
      {
        key: "procedure",
        label: "Procedimiento",
        type: "string",
        required: false,
      },
    ],
  },
  {
    slug: "hoteleria",
    parent: null,
    label: "Hotelería",
    attributeSchema: [
      { key: "beds", label: "Camas", type: "number", required: true },
      { key: "capacity", label: "Huéspedes", type: "number", required: true },
    ],
  },
  {
    slug: "cafeteria",
    parent: null,
    label: "Cafetería",
    attributeSchema: [
      { key: "size", label: "Tamaño", type: "string", required: false },
      {
        key: "allergens",
        label: "Alérgenos",
        type: "string_list",
        required: false,
      },
    ],
  },
  {
    slug: "panaderia",
    parent: null,
    label: "Panadería",
    attributeSchema: [
      {
        key: "allergens",
        label: "Alérgenos",
        type: "string_list",
        required: false,
      },
      { key: "weight_g", label: "Peso (g)", type: "number", required: false },
    ],
  },
  {
    slug: "ferreteria",
    parent: null,
    label: "Ferretería",
    attributeSchema: [
      { key: "brand", label: "Marca", type: "string", required: false },
    ],
  },
  {
    slug: "veterinaria",
    parent: null,
    label: "Veterinaria",
    attributeSchema: [
      {
        key: "species",
        label: "Especies",
        type: "string_list",
        required: true,
      },
    ],
  },
  {
    slug: "peluqueria",
    parent: null,
    label: "Peluquería",
    attributeSchema: [
      {
        key: "duration_min",
        label: "Duración (min)",
        type: "number",
        required: true,
      },
    ],
  },
  {
    slug: "abogados",
    parent: null,
    label: "Abogados",
    attributeSchema: [
      { key: "practice_area", label: "Área", type: "string", required: true },
    ],
  },
  {
    slug: "gasfiteria",
    parent: null,
    label: "Gasfitería",
    attributeSchema: [
      {
        key: "service_area",
        label: "Zona de servicio",
        type: "string",
        required: false,
      },
    ],
  },
  {
    slug: "gimnasio",
    parent: null,
    label: "Gimnasio",
    attributeSchema: [
      {
        key: "class_type",
        label: "Tipo de clase",
        type: "string",
        required: false,
      },
    ],
  },
  {
    slug: "farmacia",
    parent: null,
    label: "Farmacia",
    attributeSchema: [
      {
        key: "requires_prescription",
        label: "Requiere receta",
        type: "boolean",
        required: true,
      },
    ],
  },
  {
    slug: "asistente_personal",
    parent: null,
    label: "Asistente personal",
    attributeSchema: [],
  },
];

export type SeedAgent = {
  card: AgentCard;
  entity?: { name: string; contact: BusinessContact };
};

const provider = (
  card: Omit<AgentCard, "kind" | "status"> & Partial<Pick<AgentCard, "status">>,
  entity: SeedAgent["entity"],
): SeedAgent => ({
  card: { kind: "hosted", status: "active", ...card },
  entity,
});

export const CLINIC_AGENT_SLUG = "clinica-providencia-agenda";
export const CONSUMER_AGENT_SLUG = "mi-agente-juan";

export const SEED_AGENTS: SeedAgent[] = [
  provider(
    {
      slug: CLINIC_AGENT_SLUG,
      name: "Agendamiento Clínica Providencia",
      description:
        "Agenda horas con especialistas de Clínica Providencia Salud.",
      purpose:
        "Ofrecer horarios disponibles y reservar horas médicas. Nunca comparte datos de otros pacientes.",
      categories: ["cardiologia", "medicina_general"],
      capabilities: ["booking", "info"],
      scope: scope(
        ["especialidades", "horarios_disponibles", "direccion", "precios"],
        ["rut", "nombre_paciente", "telefono"],
        ["datos de otros pacientes", "diagnósticos médicos", "recetas"],
        ["cancel_booking"],
      ),
      location: place(-33.4263, -70.617, "Providencia", "Av. Providencia 1650"),
      verified: true,
    },
    {
      name: "Clínica Providencia Salud",
      contact: {
        phone: "+56 2 2345 6789",
        website: "https://clinica-providencia.example.cl",
      },
    },
  ),
  provider(
    {
      slug: "hotel-providencia-suites",
      name: "Hotel Providencia Suites",
      description: "Reservas de habitaciones por noche en Providencia.",
      purpose: "Informar disponibilidad y tarifas, y reservar noches de hotel.",
      categories: ["hoteleria"],
      capabilities: ["booking", "info"],
      scope: scope(
        ["tarifas", "disponibilidad", "servicios"],
        ["nombre", "telefono", "email"],
      ),
      location: place(
        -33.4229,
        -70.6107,
        "Providencia",
        "Av. Nueva Providencia 2100",
      ),
      verified: true,
    },
    {
      name: "Hotel Providencia Suites",
      contact: { email: "reservas@providencia-suites.example.cl" },
    },
  ),
  provider(
    {
      slug: "cafe-apoquindo",
      name: "Café Apoquindo",
      description: "Cafetería de especialidad frente al metro Escuela Militar.",
      purpose: "Mostrar el menú con precios y tomar pedidos para retirar.",
      categories: ["cafeteria"],
      capabilities: ["catalog", "ordering"],
      scope: scope(["menu", "precios", "horario"], ["nombre", "telefono"]),
      location: place(-33.4152, -70.5893, "Las Condes", "Av. Apoquindo 4900"),
      verified: true,
    },
    {
      name: "Café Apoquindo",
      contact: { website: "https://cafe-apoquindo.example.cl" },
    },
  ),
  provider(
    {
      slug: "tostaduria-el-golf",
      name: "Tostaduría El Golf",
      description: "Tostaduría con café en grano y barra en el barrio El Golf.",
      purpose: "Vender café en grano y bebidas para llevar.",
      categories: ["cafeteria"],
      capabilities: ["catalog", "ordering"],
      scope: scope(["menu", "precios", "stock"], ["nombre", "telefono"]),
      location: place(
        -33.4146,
        -70.6006,
        "Las Condes",
        "Isidora Goyenechea 2930",
      ),
      verified: false,
    },
    { name: "Tostaduría El Golf", contact: { phone: "+56 9 8765 4321" } },
  ),
  provider(
    {
      slug: "ferreteria-el-perno",
      name: "Ferretería El Perno",
      description: "Herramientas y materiales con despacho en Santiago Centro.",
      purpose: "Cotizar y vender herramientas con stock disponible.",
      categories: ["ferreteria"],
      capabilities: ["catalog", "ordering"],
      scope: scope(
        ["catalogo", "precios", "stock"],
        ["nombre", "direccion_despacho"],
      ),
      location: place(-33.4489, -70.6693, "Santiago", "San Diego 1020"),
      verified: true,
    },
    {
      name: "Ferretería El Perno",
      contact: { email: "ventas@el-perno.example.cl" },
    },
  ),
  provider(
    {
      slug: "panaderia-recoleta",
      name: "Panadería La Recoleta",
      description: "Pan amasado y marraquetas del día en Recoleta.",
      purpose: "Tomar pedidos de pan para retirar.",
      categories: ["panaderia"],
      capabilities: ["catalog", "ordering"],
      scope: scope(["catalogo", "precios", "horario"], ["nombre"]),
      location: place(-33.4205, -70.6421, "Recoleta", "Av. Recoleta 350"),
      verified: false,
    },
    { name: "Panadería La Recoleta", contact: { phone: "+56 2 2777 1234" } },
  ),
  provider(
    {
      slug: "dental-nunoa",
      name: "Centro Dental Ñuñoa",
      description: "Limpiezas, tapaduras y urgencias dentales.",
      purpose: "Agendar horas dentales.",
      categories: ["odontologia"],
      capabilities: ["booking"],
      scope: scope(
        ["horarios_disponibles", "precios"],
        ["rut", "nombre_paciente"],
        ["datos de otros pacientes"],
      ),
      location: place(-33.4545, -70.6011, "Ñuñoa", "Av. Irarrázaval 2800"),
      verified: true,
    },
    { name: "Centro Dental Ñuñoa", contact: { phone: "+56 2 2204 5566" } },
  ),
  provider(
    {
      slug: "veterinaria-la-reina",
      name: "Veterinaria La Reina",
      description: "Consultas y vacunas para perros y gatos.",
      purpose: "Agendar consultas veterinarias e informar vacunas.",
      categories: ["veterinaria"],
      capabilities: ["booking", "info"],
      scope: scope(
        ["horarios_disponibles", "vacunas", "precios"],
        ["nombre_tutor", "especie"],
      ),
      location: place(-33.4466, -70.5501, "La Reina", "Av. Larraín 6200"),
      verified: true,
    },
    { name: "Veterinaria La Reina", contact: { phone: "+56 2 2273 9900" } },
  ),
  provider(
    {
      slug: "peluqueria-vitacura",
      name: "Estudio Corte Vitacura",
      description: "Cortes, color y peinados con hora.",
      purpose: "Agendar horas de peluquería.",
      categories: ["peluqueria"],
      capabilities: ["booking"],
      scope: scope(
        ["servicios", "precios", "horarios_disponibles"],
        ["nombre", "telefono"],
      ),
      location: place(-33.3938, -70.5847, "Vitacura", "Av. Vitacura 5250"),
      verified: false,
    },
    { name: "Estudio Corte Vitacura", contact: { phone: "+56 9 5555 0101" } },
  ),
  provider(
    {
      slug: "estudio-juridico-centro",
      name: "Estudio Jurídico Centro",
      description: "Orientación legal en arriendos, laboral y familia.",
      purpose: "Responder dudas generales y agendar una primera reunión.",
      categories: ["abogados"],
      capabilities: ["info", "booking"],
      scope: scope(
        ["areas_de_practica", "honorarios_referenciales"],
        ["nombre", "email"],
        ["asesoría legal vinculante", "datos de otros clientes"],
      ),
      location: place(-33.4378, -70.6504, "Santiago", "Huérfanos 1160"),
      verified: true,
    },
    {
      name: "Estudio Jurídico Centro",
      contact: { email: "contacto@juridico-centro.example.cl" },
    },
  ),
  provider(
    {
      slug: "gasfiter-maipu",
      name: "Gasfitería Maipú 24/7",
      description: "Gasfitería a domicilio: filtraciones, calefont y destapes.",
      purpose: "Cotizar y agendar visitas de gasfitería.",
      categories: ["gasfiteria"],
      capabilities: ["booking", "info"],
      scope: scope(
        ["zonas_de_servicio", "precios"],
        ["nombre", "direccion", "telefono"],
      ),
      location: place(-33.5106, -70.7572, "Maipú", "Av. Pajaritos 2500"),
      verified: false,
    },
    { name: "Gasfitería Maipú 24/7", contact: { phone: "+56 9 4444 2424" } },
  ),
  provider(
    {
      slug: "gimnasio-nunoa",
      name: "Gimnasio Plaza Ñuñoa",
      description: "Clases de spinning, yoga y funcional.",
      purpose: "Mostrar planes y reservar cupos en clases.",
      categories: ["gimnasio"],
      capabilities: ["booking", "catalog"],
      scope: scope(
        ["planes", "horarios_de_clases", "precios"],
        ["nombre", "email"],
      ),
      location: place(-33.4569, -70.5975, "Ñuñoa", "Av. Irarrázaval 3450"),
      verified: true,
    },
    {
      name: "Gimnasio Plaza Ñuñoa",
      contact: { website: "https://gimnasio-nunoa.example.cl" },
    },
  ),
  provider(
    {
      slug: "farmacia-providencia",
      name: "Farmacia Providencia",
      description:
        "Consulta de stock y precios de medicamentos de venta libre.",
      purpose: "Informar stock y precios. No entrega recetas ni diagnósticos.",
      categories: ["farmacia"],
      capabilities: ["catalog", "info"],
      scope: scope(
        ["catalogo", "precios", "stock"],
        [],
        ["recetas", "diagnósticos médicos"],
      ),
      location: place(
        -33.4318,
        -70.6205,
        "Providencia",
        "Av. Providencia 1308",
      ),
      verified: true,
    },
    { name: "Farmacia Providencia", contact: { phone: "+56 2 2233 4455" } },
  ),
  {
    card: {
      slug: CONSUMER_AGENT_SLUG,
      name: "Mi agente (Juan)",
      description: "Asistente personal de Juan para agendar y comprar.",
      purpose:
        "Buscar proveedores y negociar reservas o pedidos en nombre de Juan.",
      categories: ["asistente_personal"],
      capabilities: [],
      scope: scope(["rut", "nombre_paciente", "telefono", "nombre"], [], []),
      kind: "hosted",
      status: "active",
      verified: true,
    },
  },
  {
    card: {
      slug: "cafe-los-dominicos",
      name: "Café Los Dominicos",
      description: "Agente pre-hecho a partir de la prospección de Las Condes.",
      purpose: "Mostrar el menú y tomar pedidos para retirar.",
      categories: ["cafeteria"],
      capabilities: ["catalog", "ordering"],
      scope: scope(["menu", "precios"], ["nombre"]),
      location: place(-33.4085, -70.5452, "Las Condes", "Av. Apoquindo 9085"),
      kind: "hosted",
      status: "prospect",
      verified: false,
    },
  },
];

export type SeedOffering = {
  agentSlug: string;
  key: string;
  offering: Offering;
};

const bookable = (
  agentSlug: string,
  key: string,
  offering: Omit<Offering, "kind" | "active" | "images"> &
    Partial<Pick<Offering, "images">>,
): SeedOffering => ({
  agentSlug,
  key,
  offering: { kind: "bookable", active: true, images: [], ...offering },
});

const product = (
  agentSlug: string,
  key: string,
  offering: Omit<Offering, "kind" | "active" | "images">,
): SeedOffering => ({
  agentSlug,
  key,
  offering: {
    kind: "product",
    active: true,
    images: [image(key)],
    ...offering,
  },
});

export const SEED_OFFERINGS: SeedOffering[] = [
  bookable(CLINIC_AGENT_SLUG, "consulta-munoz", {
    category: "cardiologia",
    name: "Consulta cardiología · Dra. Carolina Muñoz",
    description: "Consulta de 30 minutos con cardióloga.",
    price: clp(45000),
    attributes: {
      practitioner: "Dra. Carolina Muñoz",
      specialty: "Cardiología",
    },
  }),
  bookable(CLINIC_AGENT_SLUG, "consulta-rojas", {
    category: "cardiologia",
    name: "Consulta cardiología · Dr. Felipe Rojas",
    description: "Consulta de 30 minutos con cardiólogo.",
    price: clp(42000),
    attributes: { practitioner: "Dr. Felipe Rojas", specialty: "Cardiología" },
  }),
  bookable("hotel-providencia-suites", "doble-estandar", {
    category: "hoteleria",
    name: "Habitación doble estándar",
    description: "Dos camas, desayuno incluido.",
    images: [image("doble-estandar")],
    price: clp(85000),
    attributes: { beds: 2, capacity: 2 },
  }),
  bookable("hotel-providencia-suites", "suite-ejecutiva", {
    category: "hoteleria",
    name: "Suite ejecutiva",
    description: "Cama king, escritorio y vista a la cordillera.",
    images: [image("suite-ejecutiva")],
    price: clp(140000),
    attributes: { beds: 1, capacity: 2 },
  }),
  product("cafe-apoquindo", "latte", {
    category: "cafeteria",
    name: "Latte",
    description: "Espresso doble con leche vaporizada.",
    price: clp(3500),
    attributes: { size: "16 oz", allergens: ["lactosa"] },
  }),
  product("cafe-apoquindo", "croissant", {
    category: "cafeteria",
    name: "Croissant de mantequilla",
    description: "Horneado cada mañana.",
    price: clp(2800),
    attributes: { allergens: ["gluten", "lactosa"] },
  }),
  product("tostaduria-el-golf", "grano-250g", {
    category: "cafeteria",
    name: "Café en grano 250 g",
    description: "Origen Colombia, tueste medio.",
    price: clp(9900),
    stock: 20,
    attributes: { size: "250 g", allergens: [] },
  }),
  product("ferreteria-el-perno", "taladro-percutor", {
    category: "ferreteria",
    name: "Taladro percutor 650 W",
    description: "Incluye maletín y set de brocas.",
    price: clp(59990),
    stock: 7,
    attributes: { brand: "Bosch" },
  }),
  product("ferreteria-el-perno", "set-destornilladores", {
    category: "ferreteria",
    name: "Set de 12 destornilladores",
    description: "Punta plana y cruz, mango ergonómico.",
    price: clp(12990),
    stock: 15,
    attributes: { brand: "Stanley" },
  }),
  product("panaderia-recoleta", "marraqueta-kg", {
    category: "panaderia",
    name: "Marraqueta (1 kg)",
    description: "Pan del día.",
    price: clp(2200),
    stock: 40,
    attributes: { allergens: ["gluten"], weight_g: 1000 },
  }),
];

export type SeedAvailability = {
  offeringKey: string;
  availability: Availability;
};

const slot = (
  offeringKey: string,
  start: string,
  end: string,
): SeedAvailability => ({
  offeringKey,
  availability: {
    start: Date.parse(start),
    end: Date.parse(end),
    unit: "slot",
    capacity: 1,
    booked: 0,
  },
});

const night = (
  offeringKey: string,
  date: string,
  rooms: number,
): SeedAvailability => {
  const start = Date.parse(`${date}T15:00:00-03:00`);
  return {
    offeringKey,
    availability: {
      start,
      end: start + 21 * 60 * 60 * 1000,
      unit: "night",
      capacity: rooms,
      booked: 0,
    },
  };
};

export const SEED_AVAILABILITY: SeedAvailability[] = [
  slot(
    "consulta-munoz",
    "2026-11-24T09:00:00-03:00",
    "2026-11-24T09:30:00-03:00",
  ),
  slot(
    "consulta-munoz",
    "2026-11-27T16:00:00-03:00",
    "2026-11-27T16:30:00-03:00",
  ),
  slot(
    "consulta-rojas",
    "2026-11-26T10:30:00-03:00",
    "2026-11-26T11:00:00-03:00",
  ),
  slot(
    "consulta-rojas",
    "2026-11-26T12:00:00-03:00",
    "2026-11-26T12:30:00-03:00",
  ),
  night("doble-estandar", "2026-11-27", 5),
  night("doble-estandar", "2026-11-28", 5),
  night("doble-estandar", "2026-11-29", 5),
  night("suite-ejecutiva", "2026-11-27", 2),
  night("suite-ejecutiva", "2026-11-28", 2),
];
