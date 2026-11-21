export const SOURCE_TEXT_LIMIT = 20_000;
export const KNOWLEDGE_LIMIT = 24_000;
export const WEBSITE_BYTE_LIMIT = 2 * 1024 * 1024;

export function decodeWebsiteBody(
  bytes: Uint8Array,
  contentType?: string,
): string {
  const charset = /\bcharset\s*=\s*["']?\s*([^\s"';>]+)/i;
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 4096))
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const meta = head.match(/<meta\b[^>]*>/gi) ?? [];
  const label =
    contentType?.match(charset)?.[1] ??
    meta.map((tag) => tag.match(charset)?.[1]).find(Boolean) ??
    "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export function validateWebsiteUrl(input: string): string {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    host.includes(":") ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.endsWith(".local")
  )
    throw new Error(
      "Usa una dirección web pública con http o https y puerto estándar.",
    );
  return url.href;
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    ntilde: "ñ",
    uuml: "ü",
  };
  return text.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const code =
          entity[1].toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return code > 0 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : " ";
      }
      return entities[entity] ?? match;
    },
  );
}

export function htmlToText(html: string): { label: string; text: string } {
  const clean = (value: string) =>
    decodeEntities(value.replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  const safe = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  return {
    label: clean(
      safe.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "",
    ).slice(0, 200),
    text: clean(safe).slice(0, SOURCE_TEXT_LIMIT),
  };
}

export function formatKnowledge(
  sources: { label: string; text?: string; status: string }[],
): string {
  return sources
    .filter((source) => source.status === "ready" && source.text)
    .map((source) => `${source.label}\n${source.text}`)
    .join("\n\n")
    .slice(0, KNOWLEDGE_LIMIT);
}

export function knowledgePrompt(knowledge?: string): string {
  return knowledge
    ? `<conocimiento>\n${JSON.stringify(knowledge).replace(/</g, "\\u003c")}\n</conocimiento>`
    : "";
}
