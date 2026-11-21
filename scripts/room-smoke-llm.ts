import { createFakeLlmProvider } from "../shared/providers/llm";

const allowed = new Set(
  [
    "Room subscription smoke",
    "Room smoke message 1",
    "Room smoke message 2",
    "Room smoke message 3",
  ].map((text) => JSON.stringify({ kind: "text", text })),
);

export function createLlmProvider() {
  return createFakeLlmProvider({
    object: ({ prompt }) => {
      const body = prompt.split("\n<mensaje>\n").at(-1)?.split("\n")[0];
      return {
        decision: body && allowed.has(body) ? "allow" : "block",
        rule: "purpose",
      };
    },
  });
}
