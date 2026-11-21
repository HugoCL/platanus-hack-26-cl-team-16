"use client";

import { type Preloaded, usePreloadedQuery } from "convex/react";
import AddNumberButton from "@/components/AddNumberButton";
import type { api } from "../../convex/_generated/api";

export default function Home({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.myFunctions.listNumbers>;
}) {
  const data = usePreloadedQuery(preloaded);
  return (
    <>
      <section className="flex flex-col gap-4 border border-border bg-muted rounded-(--ui-radius) p-4">
        <h2 className="text-xl font-bold">Reactive client-loaded data</h2>
        <pre className="font-mono text-sm overflow-x-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </section>
      <AddNumberButton className="items-center" />
    </>
  );
}
