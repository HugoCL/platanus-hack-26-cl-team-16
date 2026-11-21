"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { SEED_AGENTS } from "@/shared/seed-data";

/*
 * The hero's background: a page of the yellow pages, after Vercel's 404 wall of names. Columns
 * of listings (name, comuna, dotted leader, phone) under ruled headings, in alphabetical rubros.
 * The businesses from the seed sit in their rubro with their real phone and are the only entries
 * marked in yellow; a few others are drawn a little brighter. Everything is drawn into one canvas,
 * so the wall costs one DOM node, and redrawn only on resize or theme change.
 */
const CATEGORIES = [
  ["Abogados", "Estudio Jurídico", "abogados"],
  ["Almacenes", "Almacén"],
  ["Cafeterías", "Café", "cafeteria"],
  ["Cardiólogos", "Centro Cardiológico", "cardiologia"],
  ["Carpinteros", "Carpintería"],
  ["Cerrajeros", "Cerrajería"],
  ["Clínicas dentales", "Clínica Dental", "odontologia"],
  ["Electricistas", "Eléctrica"],
  ["Farmacias", "Farmacia", "farmacia"],
  ["Ferreterías", "Ferretería", "ferreteria"],
  ["Florerías", "Florería"],
  ["Gasfíteres", "Gasfitería", "gasfiteria"],
  ["Gimnasios", "Gimnasio", "gimnasio"],
  ["Hoteles", "Hotel", "hoteleria"],
  ["Imprentas", "Imprenta"],
  ["Lavanderías", "Lavandería"],
  ["Librerías", "Librería"],
  ["Médicos", "Centro Médico", "medicina_general"],
  ["Mudanzas", "Mudanzas"],
  ["Ópticas", "Óptica"],
  ["Panaderías", "Panadería", "panaderia"],
  ["Peluquerías", "Peluquería", "peluqueria"],
  ["Restaurantes", "Restorán"],
  ["Talleres mecánicos", "Taller"],
  ["Veterinarias", "Veterinaria", "veterinaria"],
  ["Zapaterías", "Zapatería"],
] as const;

const PLACES = [
  "Altamira",
  "Los Andes",
  "Bellavista",
  "Los Aromos",
  "Don Lucho",
  "El Roble",
  "Esmeralda",
  "La Esquina",
  "Los Leones",
  "Manquehue",
  "Matta",
  "Pocuro",
  "San Diego",
  "Santa Isabel",
  "El Sauce",
  "Tobalaba",
  "Irarrázaval",
  "Lastarria",
  "Huérfanos",
  "Las Palmas",
  "Los Castaños",
  "Doña Rosa",
  "Plaza Egaña",
  "El Golf",
  "Vicuña Mackenna",
  "Pedro de Valdivia",
];

const SEED_LISTINGS = SEED_AGENTS.flatMap(({ card, entity }) =>
  entity && card.location
    ? [
        {
          name: entity.name,
          comuna: card.location.comuna,
          phone: entity.contact.phone,
          categories: card.categories,
        },
      ]
    : [],
);

const COMUNAS = [
  ...new Set([
    ...SEED_LISTINGS.map((listing) => listing.comuna),
    "Macul",
    "San Miguel",
    "Independencia",
  ]),
];

type Entry = { label: string; phone: string; tone?: "seed" | "bright" };
type Section = { heading: string; entries: Entry[] };

function buildSections(): Section[] {
  let seed = 26;
  const next = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor((seed / 2147483648) * max);
  };
  const phone = () =>
    `+56 2 2${100 + next(900)} ${String(next(10000)).padStart(4, "0")}`;

  return Array.from({ length: CATEGORIES.length * 3 }, (_, index) => {
    const [heading, noun, slug] = CATEGORIES[index % CATEGORIES.length];
    const seeded = SEED_LISTINGS.filter(
      (listing) => slug && listing.categories[0] === slug,
    ).map(
      (listing): Entry => ({
        label: `${listing.name}, ${listing.comuna}`,
        phone: listing.phone ?? "sin teléfono",
        tone: "seed",
      }),
    );
    const generated: Entry[] = Array.from({ length: 9 + next(14) }, () => ({
      label: `${noun} ${PLACES[next(PLACES.length)]}, ${COMUNAS[next(COMUNAS.length)]}`,
      phone: phone(),
      tone: next(23) === 0 ? "bright" : undefined,
    }));
    generated.splice(next(generated.length), 0, ...seeded);
    return { heading: heading.toUpperCase(), entries: generated };
  });
}

const SECTIONS = buildSections();

const ROW = 12;
const HEADING = { before: 10, height: 13, after: 2 };
const GAP = 20;

export function ListingWall() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !resolvedTheme) return;
    let cancelled = false;

    const resolve = (property: "color" | "fontFamily", value: string) => {
      canvas.style[property] = value;
      return getComputedStyle(canvas)[property];
    };

    const draw = async () => {
      await document.fonts.ready;
      if (cancelled) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.textBaseline = "middle";

      const color = {
        text: resolve("color", "var(--landing-wall-text)"),
        bright: resolve("color", "var(--landing-wall-bright)"),
        rule: resolve("color", "var(--landing-wall-rule)"),
        markBg: resolve("color", "var(--landing-wall-mark-bg)"),
        markFg: resolve("color", "var(--landing-wall-mark-fg)"),
      };
      const sans = resolve("fontFamily", "var(--ui-font-sans)");
      const mono = resolve("fontFamily", "var(--ui-font-mono)");
      const column = width < 640 ? 176 : 232;

      context.font = `500 8px ${mono}`;
      const dot = context.measureText(" .").width;
      let section = 0;
      let entry = -1;
      for (let x = 12; x < width; x += column + GAP) {
        context.fillStyle = color.rule;
        context.fillRect(x - GAP / 2, 0, 1, height);
        let y = 0;
        while (y < height) {
          const current = SECTIONS[section % SECTIONS.length];
          if (entry === -1) {
            y += HEADING.before;
            context.fillStyle = color.bright;
            context.fillRect(x, y, column, 1.5);
            context.font = `800 8.5px ${sans}`;
            context.fillText(current.heading, x, y + 1.5 + HEADING.height / 2);
            y += HEADING.height + HEADING.after;
            entry = 0;
            continue;
          }
          const listing = current.entries[entry];
          const middle = y + ROW / 2;
          if (listing.tone === "seed") {
            context.fillStyle = color.markBg;
            context.fillRect(x - 2, y, column + 4, ROW);
          }
          context.fillStyle =
            listing.tone === "seed"
              ? color.markFg
              : listing.tone === "bright"
                ? color.bright
                : color.text;
          context.font = `500 8px ${mono}`;
          const phoneWidth = context.measureText(listing.phone).width;
          context.fillText(listing.phone, x + column - phoneWidth, middle);
          context.font = `${listing.tone === "seed" ? 700 : 500} 9px ${sans}`;
          let label = listing.label;
          const room = column - phoneWidth - 8;
          while (label.length > 1 && context.measureText(label).width > room) {
            label = label.slice(0, -1);
          }
          const labelWidth = context.measureText(label).width;
          context.fillText(label, x, middle);
          context.font = `500 8px ${mono}`;
          const dots = Math.floor((room - labelWidth) / dot);
          if (dots > 0)
            context.fillText(" .".repeat(dots), x + labelWidth, middle);
          y += ROW;
          entry += 1;
          if (entry === current.entries.length) {
            section += 1;
            entry = -1;
          }
        }
      }
      setReady(true);
    };

    draw();
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(draw, 150);
    });
    observer.observe(canvas);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [resolvedTheme]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="landing-wall"
      data-ready={ready || undefined}
    />
  );
}
