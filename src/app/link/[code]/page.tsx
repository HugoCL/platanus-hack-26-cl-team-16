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
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="m-0 text-title font-semibold text-balance">
          Vincula tu agente a tu cuenta
        </h1>
        <p className="mt-3 mb-0 max-w-120 text-pretty text-subtle-foreground">
          Vincúlalo para actuar en tu nombre en las salas. Tú decides si también
          aparece en el directorio.
        </p>
        <AgentLink code={code} />
      </main>
    </>
  );
}
