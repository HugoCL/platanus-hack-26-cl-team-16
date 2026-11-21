"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { SEED_AGENTS } from "@/shared/seed-data";

/*
 * The hero's background: a page of the yellow pages, after Vercel's 404 wall of names. Columns
 * of listings (name, comuna, dotted leader, phone) under ruled headings, in alphabetical rubros.
 * The businesses from the seed sit in their rubro with their real phone and are the only entries
 * marked in yellow; a few others are drawn a little brighter. Columns are redrawn only on resize or
 * theme change.
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

type Column = { src: string; width: number; height: number };

/*
 * Each column is drawn once into its own canvas, exported as an image and shown twice in a track
 * that CSS slides by one copy (landing.css), so the loop is seamless and only transform animates.
 * Columns start at different rubros and alternate up and down.
 */
export function ListingWall() {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const wall = ref.current;
    if (!wall || !resolvedTheme) return;
    let cancelled = false;
    let layout = "";
    let urls: string[] = [];

    const resolve = (property: "color" | "fontFamily", value: string) => {
      wall.style[property] = value;
      const resolved = getComputedStyle(wall)[property];
      wall.style[property] = "";
      return resolved;
    };

    const draw = async () => {
      await document.fonts.ready;
      if (cancelled) return;
      const width = wall.clientWidth;
      const height = wall.clientHeight;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const column = width < 640 ? 176 : 232;
      const count = Math.ceil(width / (column + GAP));
      const next = `${count}:${column}:${height}:${scale}:${resolvedTheme}`;
      if (next === layout) return;
      layout = next;

      const color = {
        text: resolve("color", "var(--landing-wall-text)"),
        bright: resolve("color", "var(--landing-wall-bright)"),
        rule: resolve("color", "var(--landing-wall-rule)"),
        markBg: resolve("color", "var(--landing-wall-mark-bg)"),
        markFg: resolve("color", "var(--landing-wall-mark-fg)"),
      };
      const sans = resolve("fontFamily", "var(--ui-font-sans)");
      const mono = resolve("fontFamily", "var(--ui-font-mono)");
      const stripWidth = column + GAP;
      const x = GAP / 2;

      const strips = Array.from({ length: count }, (_, index) => {
        const sections: Section[] = [];
        let stripHeight = 0;
        for (let s = index * 5; stripHeight < height; s += 1) {
          const section = SECTIONS[s % SECTIONS.length];
          sections.push(section);
          stripHeight +=
            HEADING.before +
            HEADING.height +
            HEADING.after +
            section.entries.length * ROW;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(stripWidth * scale);
        canvas.height = Math.ceil(stripHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.textBaseline = "middle";
        context.fillStyle = color.rule;
        context.fillRect(0, 0, 1, stripHeight);
        context.font = `500 8px ${mono}`;
        const dot = context.measureText(" .").width;

        let y = 0;
        for (const section of sections) {
          y += HEADING.before;
          context.fillStyle = color.bright;
          context.fillRect(x, y, column, 1.5);
          context.font = `800 8.5px ${sans}`;
          context.fillText(section.heading, x, y + 1.5 + HEADING.height / 2);
          y += HEADING.height + HEADING.after;
          for (const listing of section.entries) {
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
            while (
              label.length > 1 &&
              context.measureText(label).width > room
            ) {
              label = label.slice(0, -1);
            }
            const labelWidth = context.measureText(label).width;
            context.fillText(label, x, middle);
            context.font = `500 8px ${mono}`;
            const dots = Math.floor((room - labelWidth) / dot);
            if (dots > 0)
              context.fillText(" .".repeat(dots), x + labelWidth, middle);
            y += ROW;
          }
        }
        return { canvas, width: stripWidth, height: stripHeight };
      });

      const drawn = await Promise.all(
        strips.map(async (strip) => {
          if (!strip) return null;
          const blob = await new Promise<Blob | null>((done) =>
            strip.canvas.toBlob(done),
          );
          return blob
            ? {
                src: URL.createObjectURL(blob),
                width: strip.width,
                height: strip.height,
              }
            : null;
        }),
      );
      const ready = drawn.filter((strip): strip is Column => strip !== null);
      if (cancelled) {
        for (const strip of ready) URL.revokeObjectURL(strip.src);
        return;
      }
      for (const url of urls) URL.revokeObjectURL(url);
      urls = ready.map((strip) => strip.src);
      setColumns(ready);
    };

    draw();
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(draw, 150);
    });
    observer.observe(wall);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      observer.disconnect();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [resolvedTheme]);

  return (
    <div
      ref={ref}
      className="landing-wall"
      data-ready={columns.length > 0 || undefined}
    >
      {columns.map((column, index) => (
        <div
          key={column.src}
          className="landing-track"
          data-direction={index % 2 === 0 ? "up" : "down"}
        >
          {["a", "b"].map((copy) => (
            // biome-ignore lint/performance/noImgElement: a blob URL from a canvas, not an asset next/image can optimize.
            <img
              key={copy}
              src={column.src}
              alt=""
              width={column.width}
              height={column.height}
              decoding="async"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
