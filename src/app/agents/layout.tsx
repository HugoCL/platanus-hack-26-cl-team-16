import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/directory/site-header";

export const metadata: Metadata = {
  title: "Mis agentes · Canary Room",
  robots: { index: false, follow: false },
};
export default function AgentsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader current="agents" />
      <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:py-16">
        <Link href="/agents" className="eyebrow text-foreground no-underline">
          Tu espacio
        </Link>
        {children}
      </main>
    </>
  );
}
