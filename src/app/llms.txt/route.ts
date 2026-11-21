import { agentInstructions } from "../../../lib/agent-instructions";
import { publicOrigin } from "../../../lib/public-origin";

export function GET(request: Request) {
  return new Response(agentInstructions(publicOrigin(request)), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
