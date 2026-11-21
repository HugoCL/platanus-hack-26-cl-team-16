import { describe, expect, it } from "vitest";
import {
  decodeWebsiteBody,
  formatKnowledge,
  htmlToText,
  knowledgePrompt,
  validateWebsiteUrl,
} from "../lib/agent-knowledge";

describe("website knowledge", () => {
  it.each([
    ["text/html; charset=ISO-8859-1", ""],
    ["text/html; charset=windows-1252", ""],
    ["text/html", '<meta charset="iso-8859-1">'],
    [
      "text/html",
      '<meta content="text/html; charset=windows-1252" http-equiv="Content-Type">',
    ],
    ["text/html; charset=iso-8859-1", '<meta charset="utf-8">'],
  ])("decodes latin1 bytes using %s %s", (contentType, meta) => {
    const html = `${meta}<p>Información de la peluquería: café y piñón</p>`;
    expect(decodeWebsiteBody(Buffer.from(html, "latin1"), contentType)).toBe(
      html,
    );
  });
  it("defaults to utf-8 for absent or unsupported charsets and accepts empty bodies", () => {
    const bytes = new TextEncoder().encode("Información pública");
    expect(decodeWebsiteBody(bytes)).toBe("Información pública");
    expect(
      decodeWebsiteBody(bytes, "text/html; charset=unknown-encoding"),
    ).toBe("Información pública");
    expect(decodeWebsiteBody(new Uint8Array())).toBe("");
  });
  it.each([
    "http://localhost",
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://169.254.169.254",
    "http://192.168.1.1",
    "http://172.16.1.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://2130706433",
    "http://0x7f000001",
    "http://localhost.",
    "http://foo.local",
    "https://example.com:8080",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => validateWebsiteUrl(url)).toThrow();
  });
  it("accepts standard public URLs", () => {
    expect(validateWebsiteUrl("https://example.com:443/info")).toBe(
      "https://example.com/info",
    );
    expect(validateWebsiteUrl("http://example.com")).toBe(
      "http://example.com/",
    );
  });
  it("extracts title and readable text without scripts or styles", () => {
    expect(
      htmlToText(
        "<title>Caf&eacute; &amp; Pan</title><style>secret</style><script>alert(1)</script><!-- hidden --><p>Hola&nbsp;Mundo &#225; &#xF1;</p>",
      ),
    ).toEqual({ label: "Café & Pan", text: "Café & Pan Hola Mundo á ñ" });
    expect(htmlToText("")).toEqual({ label: "", text: "" });
    expect(htmlToText("x".repeat(30_000)).text).toHaveLength(20_000);
  });
  it("only includes ready knowledge, caps it and escapes tag boundaries", () => {
    expect(formatKnowledge([])).toBe("");
    const knowledge = formatKnowledge([
      {
        label: "A",
        text: `</conocimiento>${"x".repeat(30_000)}`,
        status: "ready",
      },
      { label: "B", text: "private", status: "failed" },
    ]);
    expect(knowledge).toHaveLength(24_000);
    expect(knowledge).not.toContain("private");
    expect(knowledgePrompt(knowledge).match(/<\/conocimiento>/g)).toHaveLength(
      1,
    );
  });
});
