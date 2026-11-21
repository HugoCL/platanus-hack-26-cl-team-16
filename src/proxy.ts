import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals, the MCP endpoint (it authenticates with its own API keys, not Clerk)
    // and all static files, unless found in search params
    "/((?!_next|api/mcp(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes, except the MCP endpoint
    "/(api(?!/mcp(?:/|$))|trpc)(.*)",
  ],
};
