import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/directory/site-header";

export const metadata: Metadata = {
  title: "Amigos · agora",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function FriendsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader current="friends" />
      <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:py-16">
        {children}
      </main>
    </>
  );
}
