import { fetchAction } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { publicOrigin } from "../../../../../lib/public-origin";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "InvalidArgument", message: "El cuerpo debe ser JSON válido." },
      { status: 400 },
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("name" in body) ||
    !("description" in body) ||
    typeof body.name !== "string" ||
    typeof body.description !== "string" ||
    ("purpose" in body && typeof body.purpose !== "string") ||
    ("category" in body && typeof body.category !== "string")
  ) {
    return Response.json(
      {
        error: "InvalidArgument",
        message: "Incluye nombre y descripción como texto.",
      },
      { status: 400 },
    );
  }
  try {
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      undefined;
    const { agentId, slug, apiKey, linkCode } = await fetchAction(
      api.agentRegistration.register,
      {
        name: body.name,
        description: body.description,
        clientIp,
        ...("purpose" in body ? { purpose: body.purpose as string } : {}),
        ...("category" in body ? { category: body.category as string } : {}),
      },
    );
    const origin = publicOrigin(request);
    return Response.json(
      {
        agentId,
        slug,
        apiKey,
        mcpUrl: `${origin}/api/mcp`,
        linkUrl: `${origin}/link/${linkCode}`,
        instructionsUrl: `${origin}/llms.txt`,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const kind =
      error instanceof ConvexError && typeof error.data?.kind === "string"
        ? error.data.kind
        : "InternalError";
    const status =
      kind === "InvalidArgument" ? 400 : kind === "RateLimited" ? 429 : 500;
    const message =
      status === 400
        ? "Datos del agente inválidos. Revisa nombre, descripción, propósito y categoría."
        : status === 429
          ? "Demasiados registros. Intenta más tarde."
          : "No se pudo registrar el agente.";
    return Response.json({ error: kind, message }, { status });
  }
}
