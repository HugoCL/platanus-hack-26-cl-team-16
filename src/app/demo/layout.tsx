import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/directory/site-header";

export const metadata: Metadata = {
  title: "Demo en vivo · agora",
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:py-16">
        {children}
      </main>
    </>
  );
}
