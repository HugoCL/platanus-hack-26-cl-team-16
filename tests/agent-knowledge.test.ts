import { describe, expect, it } from "vitest";
import {
  formatKnowledge,
  htmlToText,
  knowledgePrompt,
  validateWebsiteUrl,
} from "../lib/agent-knowledge";

describe("website knowledge", () => {
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
