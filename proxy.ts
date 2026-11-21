import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/server"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals, the MCP endpoint (it authenticates with its own API keys, not Clerk)
    // and all static files, unless found in search params
    "/((?!_next|api/mcp(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes, except the MCP endpoint
    "/(api(?!/mcp(?:/|$))|trpc)(.*)",
  ],
};
