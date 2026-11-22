import { AgentBuilderNew } from "@/components/agent-builder-new";
export default function NewAgentPage() {
  return (
    <>
      <h1 className="mt-5 text-title font-semibold tracking-tight">
        Crea tu primer borrador
      </h1>
      <p className="mt-3 mb-8 max-w-xl text-subtle-foreground">
        Primero, cuéntanos a quién representa y cómo puede ayudar. No necesitas
        saber programar.
      </p>
      <AgentBuilderNew />
    </>
  );
}
