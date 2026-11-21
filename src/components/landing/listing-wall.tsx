"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

const CATEGORIES = [
  ["Abogados", "Estudio"],
  ["Almacenes", "Almacén"],
  ["Cafeterías", "Café"],
  ["Carpinteros", "Carpintería"],
  ["Cerrajeros", "Cerrajería"],
  ["Clínicas dentales", "Clínica Dental"],
  ["Electricistas", "Eléctrica"],
  ["Ferreterías", "Ferretería"],
  ["Florerías", "Florería"],
  ["Gasfíteres", "Gasfitería"],
  ["Gimnasios", "Gimnasio"],
  ["Imprentas", "Imprenta"],
  ["Kinesiólogos", "Kine"],
  ["Lavanderías", "Lavandería"],
  ["Librerías", "Librería"],
  ["Mudanzas", "Mudanzas"],
  ["Ópticas", "Óptica"],
  ["Panaderías", "Panadería"],
  ["Peluquerías", "Peluquería"],
  ["Restaurantes", "Restorán"],
  ["Talleres mecánicos", "Taller"],
  ["Veterinarias", "Veterinaria"],
  ["Viveros", "Vivero"],
  ["Zapaterías", "Zapatería"],
] as const;

const NAMES = [
  "Altamira",
  "Andes",
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
  "Providencia",
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
  "Macul",
  "El Golf",
  "Vicuña",
  "Pedro de Valdivia",
];

const COMUNAS = [
  "Providencia",
  "Ñuñoa",
  "Las Condes",
  "Santiago",
  "La Reina",
  "Vitacura",
  "Maipú",
  "San Miguel",
  "Macul",
  "Recoleta",
];

type Entry = {
  id: string;
  name: string;
  comuna: string;
  handle: string;
  featured: boolean;
};
type Section = { id: string; category: string; entries: Entry[] };

const COLUMN_COUNT = 16;
const SECTIONS_PER_COLUMN = 3;

function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildColumns(): Section[][] {
  let seed = 26;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const sections = Array.from(
    { length: COLUMN_COUNT * SECTIONS_PER_COLUMN },
    (_, sectionIndex) => {
      const [category, noun] = CATEGORIES[sectionIndex % CATEGORIES.length];
      const id = `${sectionIndex}`;
      const entries = Array.from({ length: 24 + (next() % 12) }, (_, index) => {
        const place = NAMES[next() % NAMES.length];
        return {
          id: `${id}-${index}`,
          name: `${noun} ${place}`,
          comuna: COMUNAS[next() % COMUNAS.length],
          handle: `@${slug(place).split("-").at(-1)}${(next() % 900) + 100}`,
          featured: next() % 17 === 0,
        };
      });
      return { id, category, entries };
    },
  );
  return Array.from({ length: COLUMN_COUNT }, (_, column) =>
    sections.slice(
      column * SECTIONS_PER_COLUMN,
      (column + 1) * SECTIONS_PER_COLUMN,
    ),
  );
}

const COLUMNS = buildColumns();

/*
 * The wall used to be ~6,200 DOM nodes. Now each visible column's listings are drawn once into a
 * canvas, exported as an image, and shown twice in a track that CSS slides (landing.css). Metrics
 * mirror the old CSS: 9px mono rows on a 13px line, 10px sans headings, 13rem columns (9.5rem on
 * phones) with a 1.25rem gap.
 */
const ROW = 13;
const HEADING = 15;
const HEADING_GAP = { before: 8, after: 3 };

type Palette = {
  text: string;
  heading: string;
  yellow: string;
  ink: string;
  mono: string;
  sans: string;
};

function drawColumn(
  sections: Section[],
  width: number,
  scale: number,
  palette: Palette,
) {
  const height = sections.reduce(
    (total, section) =>
      total +
      HEADING_GAP.before +
      HEADING +
      HEADING_GAP.after +
      section.entries.length * ROW,
    0,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(scale, scale);
  context.textBaseline = "middle";

  let y = 0;
  for (const section of sections) {
    y += HEADING_GAP.before;
    context.fillStyle = palette.yellow;
    context.fillRect(0, y, width, 2);
    context.fillStyle = palette.heading;
    context.font = `800 10px ${palette.sans}`;
    context.fillText(
      section.category.toUpperCase(),
      0,
      y + 2 + (HEADING - 2) / 2,
    );
    y += HEADING + HEADING_GAP.after;

    for (const entry of section.entries) {
      const middle = y + ROW / 2;
      context.font = `${entry.featured ? 700 : 500} 9px ${palette.mono}`;
      if (entry.featured) {
        context.fillStyle = palette.yellow;
        context.fillRect(0, y, width, ROW);
      }
      context.fillStyle = entry.featured ? palette.ink : palette.text;
      const handleWidth = context.measureText(entry.handle).width;
      context.fillText(entry.handle, width - handleWidth - 2, middle);

      let label = `${entry.name} · ${entry.comuna}`;
      const room = width - handleWidth - 10;
      while (label.length > 1 && context.measureText(label).width > room) {
        label = label.slice(0, -1);
      }
      context.fillText(label, 2, middle);

      context.globalAlpha = entry.featured ? 1 : 0.5;
      const dot = context.measureText(". ").width;
      for (
        let x = context.measureText(label).width + 6;
        x < width - handleWidth - 6;
        x += dot
      ) {
        context.fillText(".", x, middle);
      }
      context.globalAlpha = 1;
      y += ROW;
    }
  }
  return { canvas, width, height };
}

type Column = { src: string; width: number; height: number };

export function ListingWall() {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let urls: string[] = [];
    let layout = "";
    let cancelled = false;

    const render = async () => {
      const rem = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const width = (matchMedia("(max-width: 40rem)").matches ? 9.5 : 13) * rem;
      const count = Math.min(
        COLUMNS.length,
        Math.ceil((element.clientWidth - rem) / (width + 1.25 * rem)),
      );
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const next = `${count}:${width}:${scale}:${resolvedTheme}`;
      if (next === layout) return;
      layout = next;

      await document.fonts.ready;
      const style = getComputedStyle(element);
      const palette: Palette = {
        text: style.color,
        heading: style.getPropertyValue("--landing-wall-heading"),
        yellow: style.getPropertyValue("--sm-yellow"),
        ink: style.getPropertyValue("--landing-ink"),
        mono: style.fontFamily,
        sans: getComputedStyle(document.body).fontFamily,
      };
      const drawn = await Promise.all(
        COLUMNS.slice(0, count).map(async (sections) => {
          const column = drawColumn(sections, width, scale, palette);
          if (!column) return null;
          const blob = await new Promise<Blob | null>((resolve) =>
            column.canvas.toBlob(resolve),
          );
          return blob
            ? {
                src: URL.createObjectURL(blob),
                width: column.width,
                height: column.height,
              }
            : null;
        }),
      );
      const ready = drawn.filter((column): column is Column => column !== null);
      if (cancelled) {
        for (const column of ready) URL.revokeObjectURL(column.src);
        return;
      }
      for (const url of urls) URL.revokeObjectURL(url);
      urls = ready.map((column) => column.src);
      setColumns(ready);
    };

    render();
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(render, 200);
    });
    observer.observe(element);
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
        <div key={column.src} className="landing-column">
          <div
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
        </div>
      ))}
    </div>
  );
}
