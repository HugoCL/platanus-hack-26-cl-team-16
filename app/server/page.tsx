import { auth } from "@clerk/nextjs/server";
import { preloadedQueryResult, preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import Home from "./inner";

// Clerk token for Convex. It is undefined in keyless mode, or before the
// "convex" JWT template exists, so the query then runs unauthenticated instead of throwing.
async function getConvexToken() {
  try {
    const { getToken } = await auth();
    return (await getToken({ template: "convex" })) ?? undefined;
  } catch {
    return undefined;
  }
}

export default async function ServerPage() {
  const token = await getConvexToken();
  const preloaded = await preloadQuery(
    api.myFunctions.listNumbers,
    { count: 3 },
    { token },
  );

  const data = preloadedQueryResult(preloaded);

  return (
    <main className="p-8 flex flex-col gap-4 mx-auto max-w-2xl text-pretty">
      <h1 className="text-4xl font-bold text-center text-balance">
        Convex + Next.js
      </h1>
      <section className="flex flex-col gap-4 border border-border bg-muted rounded-(--ui-radius) p-4">
        <h2 className="text-xl font-bold">Non-reactive server-loaded data</h2>
        <pre className="font-mono text-sm overflow-x-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </section>
      <Home preloaded={preloaded} />
    </main>
  );
}
