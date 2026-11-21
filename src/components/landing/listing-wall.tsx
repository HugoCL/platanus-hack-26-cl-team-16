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
type Section = { category: string; entries: Entry[] };

function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildSections(): Section[] {
  let seed = 26;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  return CATEGORIES.map(([category, noun]) => {
    const entries = Array.from({ length: 22 + (next() % 12) }, (_, index) => {
      const place = NAMES[next() % NAMES.length];
      return {
        id: `${category}-${index}`,
        name: `${noun} ${place}`,
        comuna: COMUNAS[next() % COMUNAS.length],
        handle: `@${slug(place).split("-").at(-1)}${(next() % 900) + 100}`,
        featured: next() % 17 === 0,
      };
    });
    return { category, entries };
  });
}

const SECTIONS = buildSections();

export function ListingWall() {
  return (
    <div className="landing-wall">
      {SECTIONS.map((section) => (
        <section key={section.category}>
          <strong>{section.category}</strong>
          {section.entries.map((entry) => (
            <p key={entry.id} data-featured={entry.featured || undefined}>
              <span>
                {entry.name} · {entry.comuna}
              </span>
              <span>{entry.handle}</span>
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
