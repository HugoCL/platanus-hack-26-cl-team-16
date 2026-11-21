import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and public agent endpoints (they do not authenticate with Clerk)
    // and all static files, unless found in search params
    "/((?!_next|llms\\.txt$|api/(?:mcp|agents/register)(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes, except public agent endpoints
    "/(api(?!/(?:mcp|agents/register)(?:/|$))|trpc)(.*)",
  ],
};
