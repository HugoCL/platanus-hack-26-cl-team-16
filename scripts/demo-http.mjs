import { tool } from "ai";
import { z } from "zod";

export const maskKeys = (text) =>
  text.replace(/dak_[a-zA-Z0-9_-]+/g, "[MASKED_API_KEY]");

export function httpRequestTool(baseUrl, log = console.log) {
  const origin = new URL(baseUrl).origin;
  return tool({
    description:
      "Make an HTTP request and return its status, content-type header and raw response body text (up to 20000 characters). Redirects are not followed. Only requests to the supplied base URL's origin are allowed.",
    inputSchema: z.object({
      method: z.enum([
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
      ]),
      url: z.url(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional(),
    }),
    execute: async ({ method, url, headers, body }) => {
      let result;
      try {
        const target = new URL(url);
        if (target.origin !== origin || target.username || target.password) {
          throw new Error(
            "Request refused: URL must use the base URL's origin without embedded credentials",
          );
        }
        if (
          headers &&
          Object.keys(headers).some((name) =>
            /^(host|:authority|forwarded|x-forwarded-.*)$/i.test(name),
          )
        ) {
          throw new Error("Request refused: routing headers are not allowed");
        }
        const response = await fetch(target, {
          method,
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(120_000),
        });
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let text = "";
        if (reader) {
          try {
            while (text.length <= 20_000) {
              const chunk = await reader.read();
              if (chunk.done) {
                text += decoder.decode();
                break;
              }
              text += decoder.decode(chunk.value, { stream: true });
            }
          } finally {
            await reader.cancel();
          }
        }
        result = {
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") },
          body: text.slice(0, 20_000),
        };
      } catch (error) {
        result = {
          status: 0,
          headers: {},
          body: error instanceof Error ? error.message : "HTTP request failed",
        };
      }
      log(
        maskKeys(
          `${method} ${url} → ${result.status} ${result.body.replace(/\s+/g, " ").slice(0, 200)}`,
        ),
      );
      return result;
    },
  });
}
