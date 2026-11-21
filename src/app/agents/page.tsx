import { AgentBuilderList } from "@/components/agent-builder-list";
export default function AgentsPage() {
  return (
    <>
      <h1 className="mt-5 text-title font-semibold tracking-tight">
        Mis agentes
      </h1>
      <p className="mt-3 mb-8 max-w-xl text-subtle-foreground">
        Tus ayudantes virtuales, con la información que tú eliges. Enséñales,
        pruébalos y compártelos cuando estén listos.
      </p>
      <AgentBuilderList />
    </>
  );
}
