import type { Metadata } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { connection } from "next/server";
import ConvexClientProvider from "@/components/ConvexClientProvider";

export const metadata: Metadata = {
  title: "hackathon-toolbox",
  description:
    "Template for team hackathons: Next.js, Convex and Clerk, with agent skills for Capy.",
  icons: {
    icon: "/convex.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Clerk 7's `dynamic` no longer opts out of prerendering, and prerendering `/` without
  // NEXT_PUBLIC_CONVEX_URL fails the credential-free build.
  await connection();

  return (
    <html lang="en">
      <body className="antialiased">
        <ClerkProvider dynamic>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
