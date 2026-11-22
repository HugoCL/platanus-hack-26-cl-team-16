import type { AgentCard } from "./agent";
import type { Attributes, Category } from "./catalog";
import type { UiSpec } from "./genui";

// Data for the resettable live demo room (docs/demo.md): a buyer who wants a board made from
// their drawing and a PCB manufacturer in Shenzhen. `convex/demo.ts` writes it; nothing here
// is part of the regular seed.

export const DEMO_PROVIDER_SLUG = "shenzhen-pcb-works";
export const DEMO_CATEGORY: Category = {
  slug: "fabricacion_pcb",
  parent: null,
  label: "Fabricación de PCB",
  attributeSchema: [],
};

export const DEMO_PROVIDER_CARD: AgentCard = {
  slug: DEMO_PROVIDER_SLUG,
  name: "Don Huang",
  description:
    "Fabricante de circuitos impresos (PCB) en Shenzhen. Cotiza y fabrica desde tus archivos Gerber, con envío a Chile.",
  purpose:
    "Cotizar y coordinar la fabricación de PCB a partir del plano del cliente: precios por cantidad, acabados, plazos, revisión de fabricabilidad, pago y envío. Nunca comparte diseños ni datos de otros clientes.",
  categories: [DEMO_CATEGORY.slug],
  capabilities: ["catalog", "info"],
  scope: {
    allowedIntents: [],
    forbiddenTopics: [
      "diseños o archivos de otros clientes",
      "evadir aduanas o declarar un valor menor",
    ],
    dataItShares: ["precios", "plazos", "capacidad_de_fabricacion", "envio"],
    dataItRequests: ["nombre", "email", "direccion_de_envio"],
  },
  kind: "hosted",
  // A draft stays out of the directory: the agent exists only for the demo room.
  status: "draft",
  verified: true,
};

export const DEMO_PROVIDER_INSTRUCTIONS =
  "Eres el agente de ventas de Don Huang, fabricante de PCB en Shenzhen. Cotizas con la lista de precios de tu conocimiento: para una cotización da el precio por unidad, el subtotal, el envío, el total en USD y el plazo. Responde en español, breve y concreto, en seis líneas como máximo. Del pago di solo las condiciones: no pidas ni ofrezcas coordinar datos de pago en la sala.";

export const DEMO_OFFERINGS: {
  name: string;
  description: string;
  attributes: Attributes;
}[] = [
  {
    name: "PCB de 2 capas",
    description:
      "FR-4 de 1,6 mm, hasta 100 × 100 mm. Acabado HASL sin plomo. Desde USD 1,10 por unidad.",
    attributes: { layers: 2, lead_time_days: 5 },
  },
  {
    name: "PCB de 4 capas",
    description:
      "FR-4 de 1,6 mm, hasta 100 × 100 mm. Acabado HASL sin plomo o ENIG. Desde USD 2,70 por unidad.",
    attributes: { layers: 4, lead_time_days: 7 },
  },
  {
    name: "Fabricación urgente",
    description: "Fabricación en 3 días hábiles, con un recargo de 30 %.",
    attributes: { lead_time_days: 3 },
  },
];

export const DEMO_KNOWLEDGE = {
  label: "Lista de precios y condiciones",
  text: [
    "Precios en USD por unidad, PCB FR-4 de 1,6 mm de hasta 100 × 100 mm:",
    "- 2 capas, HASL sin plomo: 50 unidades 1,90; 100 unidades 1,40; 200 unidades 1,10.",
    "- 4 capas, HASL sin plomo: 50 unidades 4,20; 100 unidades 3,30; 200 unidades 2,70.",
    "- 4 capas, ENIG: 50 unidades 5,10; 100 unidades 4,00; 200 unidades 3,30.",
    "Plazo de fabricación: 2 capas, 5 días hábiles; 4 capas, 7 días hábiles. Urgente: 3 días hábiles con un recargo de 30 % sobre el subtotal.",
    "Envío a Chile: DHL Express, 4 a 6 días, USD 68. Courier económico, 12 a 15 días, USD 34. Los aranceles y el IVA de importación los paga el comprador.",
    "Capacidad: pista y separación mínima de 0,09 mm, perforación mínima de 0,2 mm, hasta 8 capas. Control de impedancia: USD 35 por pedido.",
    "Revisión de fabricabilidad (DFM) de los archivos Gerber: gratis, antes de fabricar, toma un día hábil.",
    "Pago: 50 % al confirmar y 50 % antes del despacho, por transferencia o PayPal.",
    "Pedido mínimo: 5 unidades. El ensamblaje de componentes (SMT) se cotiza aparte con la lista de materiales.",
    "Descuentos: el agente no los ofrece; solo una persona del equipo comercial puede mejorar un precio.",
  ].join("\n"),
};

export const DEMO_INTENT = {
  name: "request_quote",
  description:
    "Cotizar la fabricación de 50 PCB de 4 capas a partir de un plano",
};
export const DEMO_MAX_TURNS = 40;

export const DEMO_SEATS = {
  buyer: { displayName: "Comprador", placeholder: "demo|buyer" },
  merchant: { displayName: "Fabricante", placeholder: "demo|merchant" },
} as const;
export type DemoSeat = keyof typeof DEMO_SEATS;

export const DEMO_ORDER_FORM: UiSpec = {
  type: "form",
  id: "pedido-pcb",
  title: "Confirma tu pedido",
  description:
    "Con estos datos te envío la cotización en firme, con el total y el plazo.",
  fields: [
    {
      name: "cantidad",
      label: "Cantidad",
      input: "select",
      required: true,
      options: [
        { value: "50", label: "50 unidades" },
        { value: "100", label: "100 unidades" },
        { value: "200", label: "200 unidades" },
      ],
    },
    {
      name: "acabado",
      label: "Acabado",
      input: "select",
      required: true,
      options: [
        { value: "hasl", label: "HASL sin plomo" },
        { value: "enig", label: "ENIG (oro)" },
      ],
    },
    {
      name: "envio",
      label: "Envío a Chile",
      input: "select",
      required: true,
      options: [
        { value: "dhl", label: "DHL Express, 4 a 6 días" },
        { value: "economico", label: "Courier económico, 12 a 15 días" },
      ],
    },
    {
      name: "notas",
      label: "Notas para la fábrica",
      input: "textarea",
      required: false,
      placeholder: "Color de la máscara, panelizado, fecha límite…",
    },
  ],
  submitLabel: "Pedir cotización en firme",
};

type DemoSpeaker = "buyerAgent" | "providerAgent" | DemoSeat;

// The conversation the room opens with. The last line is the request still waiting for an
// answer: the manufacturer's form, addressed to the buyer.
export const DEMO_SCRIPT: {
  from: DemoSpeaker;
  to: DemoSpeaker | "all";
  content: { kind: "text"; text: string } | { kind: "ui"; spec: UiSpec };
}[] = [
  {
    from: "buyerAgent",
    to: "providerAgent",
    content: {
      kind: "text",
      text: "Hola. Mi usuario quiere fabricar un PCB a partir de su plano: 4 capas, 80 × 60 mm, FR-4 de 1,6 mm. Necesita 50 unidades para un primer lote. ¿Pueden fabricarlo y cuánto cuesta?",
    },
  },
  {
    from: "providerAgent",
    to: "buyerAgent",
    content: {
      kind: "text",
      text: "Sí, lo fabricamos en nuestra planta de Shenzhen. Para 50 unidades de 4 capas el precio es USD 4,20 por unidad con acabado HASL sin plomo, o USD 5,10 con ENIG. La fabricación toma 7 días hábiles.",
    },
  },
  {
    from: "buyer",
    to: "all",
    content: {
      kind: "text",
      text: "El plano usa pistas de 0,1 mm y un conector USB-C. ¿Lo pueden fabricar sin cambios?",
    },
  },
  {
    from: "providerAgent",
    to: "buyer",
    content: {
      kind: "text",
      text: "Sí. Nuestra pista y separación mínima es de 0,09 mm, así que tu diseño entra sin cambios. Antes de fabricar revisamos gratis los archivos Gerber.",
    },
  },
  {
    from: "providerAgent",
    to: "buyer",
    content: { kind: "ui", spec: DEMO_ORDER_FORM },
  },
];
