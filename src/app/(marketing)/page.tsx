"use client";

import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { Separator } from "@ui-sdk/react/separator";
import { Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import AddNumberButton from "@/components/add-number-button";
import { api } from "@/convex/_generated/api";

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-10 bg-background px-4 h-14 border-b border-border flex flex-row justify-between items-center">
        Convex + Next.js + Clerk
        <UserButton />
      </header>
      <main className="p-8 flex flex-col gap-8 text-pretty">
        <h1 className="text-4xl font-bold text-center text-balance">
          Convex + Next.js + Clerk
        </h1>
        <p className="text-center">
          <Link href="/directorio">Directorio de agentes</Link>
        </p>
        {/* The numbers demo is public on purpose, so it also runs without an account. */}
        <Unauthenticated>
          <SignInForm />
        </Unauthenticated>
        <Content />
      </main>
    </>
  );
}

function SignInForm() {
  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
      <p>
        Sign in to be greeted by name. The numbers below work without an
        account.
      </p>
      <div className="flex gap-2">
        <SignInButton mode="modal">
          <Button data-variant="solid">Sign in</Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button>Sign up</Button>
        </SignUpButton>
      </div>
    </div>
  );
}

function Content() {
  const { viewer, numbers, latestId } =
    useQuery(api.myFunctions.listNumbers, {
      count: 10,
    }) ?? {};

  if (viewer === undefined || numbers === undefined) {
    return (
      <div className="mx-auto text-muted-foreground" data-testid="loading">
        <p>loading... (consider a loading skeleton)</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-lg mx-auto">
      <p>Welcome {viewer ?? "Anonymous"}!</p>
      <p>
        Click the button below and open this page in another window - this data
        is persisted in your Convex deployment (a local one under{" "}
        <code>pnpm dev</code>)!
      </p>
      <div className="flex flex-col items-start gap-3">
        <AddNumberButton data-testid="add-number" />
        <p>
          Numbers:{" "}
          <span
            data-testid="numbers"
            data-count={numbers.length}
            data-latest-id={latestId ?? ""}
            className="tabular-nums"
          >
            {numbers.length === 0 ? "Click the button!" : numbers.join(", ")}
          </span>
        </p>
      </div>
      <Separator />
      <p>
        Edit <code>convex/myFunctions.ts</code> to change your backend
      </p>
      <p>
        Edit <code>src/app/(marketing)/page.tsx</code> to change your frontend
      </p>
      <p>
        See the <Link href="/server">/server route</Link> for an example of
        loading data in a server component
      </p>
      <Separator />
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-balance">Useful resources</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ResourceCard
            title="Convex docs"
            description="Read comprehensive documentation for all Convex features."
            href="https://docs.convex.dev/home"
          />
          <ResourceCard
            title="Templates"
            description="Browse our collection of templates to get started quickly."
            href="https://www.convex.dev/templates"
          />
          <ResourceCard
            title="Clerk with Convex"
            description="Switch from the local demo to real accounts with Clerk."
            href="https://docs.convex.dev/auth/clerk"
          />
          <ResourceCard
            title="Discord"
            description="Join our developer community to ask questions, trade tips & tricks, and show off your projects."
            href="https://www.convex.dev/community"
          />
        </div>
      </div>
    </div>
  );
}

function ResourceCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <div className="flex flex-col gap-2 border border-border bg-muted rounded-(--ui-radius) p-4">
      <a href={href} className="text-sm font-medium">
        {title}
      </a>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
