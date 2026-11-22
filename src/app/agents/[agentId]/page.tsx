import { AgentBuilderEditor } from "@/components/agent-builder-editor";
export default async function AgentEditorPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return (
    <>
      <h1 className="mt-5 text-title font-semibold tracking-tight">
        Prepara tu agente
      </h1>
      <p className="mt-3 mb-8 text-subtle-foreground">
        Tres pasos sencillos. Puedes volver y cambiar lo que necesites.
      </p>
      <AgentBuilderEditor key={agentId} agentId={agentId} />
    </>
  );
}
