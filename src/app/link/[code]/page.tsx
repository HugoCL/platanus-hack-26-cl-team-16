import type { Metadata } from "next";
import { AgentLink } from "@/components/agent-link";
import { SiteHeader } from "@/components/directory/site-header";

export const metadata: Metadata = {
  title: "Vincular agente · agora",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function LinkPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-subtle-foreground">
          Tu agente, tu cuenta
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Un lugar para tu agente
        </h1>
        <p className="mt-4 text-subtle-foreground">
          Vincúlalo para actuar en tu nombre en las salas. Tú decides si también
          aparece en el directorio.
        </p>
        <AgentLink code={code} />
      </main>
    </>
  );
}
