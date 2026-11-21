"use node";

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { v } from "convex/values";
import { extractText, getDocumentProxy } from "unpdf";
import {
  htmlToText,
  SOURCE_TEXT_LIMIT,
  validateWebsiteUrl,
  WEBSITE_BYTE_LIMIT,
} from "../lib/agent-knowledge";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

function publicIpv4(address: string) {
  const [a, b] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

async function website(input: string) {
  const url = new URL(validateWebsiteUrl(input));
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicIpv4(address))
  )
    throw new Error("private address");
  // Pin the validated address for the connection; a second DNS lookup could rebind it.
  return new Promise<{ label: string; text: string }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        signal: AbortSignal.timeout(10_000),
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, 4);
        },
        headers: {
          Accept: "text/html, text/plain",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const type = response.headers["content-type"]
          ?.split(";")[0]
          .trim()
          .toLowerCase();
        if (
          response.statusCode !== 200 ||
          !["text/html", "text/plain"].includes(type ?? "") ||
          Number(response.headers["content-length"] ?? 0) > WEBSITE_BYTE_LIMIT
        ) {
          response.destroy();
          reject(new Error("invalid response"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > WEBSITE_BYTE_LIMIT) {
            request.destroy(new Error("too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const content = Buffer.concat(chunks).toString("utf8");
          resolve(
            type === "text/html"
              ? htmlToText(content)
              : {
                  label: url.hostname,
                  text: content
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, SOURCE_TEXT_LIMIT),
                },
          );
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

export const extract = internalAction({
  args: { sourceId: v.id("agentSources") },
  returns: v.null(),
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.runQuery(internal.agentBuilder.extractionSource, {
      sourceId,
    });
    if (source?.status !== "processing") return null;
    try {
      let result: { label?: string; text: string };
      if (source.kind === "website" && source.url) {
        result = await website(source.url);
      } else if (source.kind === "pdf" && source.storageId) {
        const blob = await ctx.storage.get(source.storageId);
        if (!blob || blob.size > 10 * 1024 * 1024)
          throw new Error("invalid PDF");
        const document = await getDocumentProxy(
          new Uint8Array(await blob.arrayBuffer()),
        );
        try {
          if (document.numPages > 200) throw new Error("too many pages");
          const extracted = await extractText(document, { mergePages: true });
          result = {
            text: extracted.text
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, SOURCE_TEXT_LIMIT),
          };
        } finally {
          await document.destroy();
        }
      } else throw new Error("invalid source");
      if (!result.text.trim()) throw new Error("empty source");
      await ctx.runMutation(internal.agentBuilder.finishExtraction, {
        sourceId,
        ...result,
      });
    } catch {
      await ctx.runMutation(internal.agentBuilder.finishExtraction, {
        sourceId,
        error:
          source.kind === "pdf"
            ? "No pudimos leer el PDF. Usa un PDF con texto seleccionable, de hasta 10 MB y 200 páginas."
            : "No pudimos leer el sitio. Usa una página pública de texto o HTML, sin redirecciones y de hasta 2 MB.",
      });
    }
    return null;
  },
});
