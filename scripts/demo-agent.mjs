import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { isStepCount, ToolLoopAgent } from "ai";
import { DEFAULT_MODELS } from "../shared/models.ts";
import { httpRequestTool, maskKeys } from "./demo-http.mjs";

async function main() {
  const [, , baseUrl, task] = process.argv;
  if (!baseUrl) throw new Error('Uso: pnpm demo:agent <baseUrl> ["<tarea>"]');
  const url = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("baseUrl debe ser una URL HTTP(S) sin credenciales");
  if (!process.env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY no está configurada");
  const model = process.env.DEMO_AGENT_MODEL || DEFAULT_MODELS.agent;
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  const agent = new ToolLoopAgent({
    model: openrouter.chat(model),
    instructions:
      "Eres un asistente personal que ayuda a su humano. Actúa con honestidad y no afirmes haber completado acciones que no realizaste.",
    tools: { http_request: httpRequestTool(baseUrl) },
    stopWhen: isStepCount(40),
  });
  console.log(`Modelo: ${model}`);
  const prompt =
    task ||
    `Conéctate al directorio de agentes en ${url.href} y agenda una hora con un cardiólogo en Providencia para mañana en la tarde. Mi nombre es Juan.`;
  console.log(maskKeys(`Tarea: ${prompt}`));
  const result = await agent.generate({ prompt });
  console.log(
    maskKeys(
      `\nRespuesta final:\n${result.text || "Se alcanzó el límite de pasos sin respuesta final."}`,
    ),
  );
}

main().catch((error) => {
  console.error(
    maskKeys(
      error instanceof Error ? error.message : "No se pudo ejecutar el agente",
    ),
  );
  process.exitCode = 1;
});
