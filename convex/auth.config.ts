import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // The Frontend API URL of the team's Clerk app (a development instance), which is the
      // issuer of its tokens. It is public. Keep it a literal: Convex rejects
      // `process.env.CLERK_JWT_ISSUER_DOMAIN` here when the variable is not set on the
      // deployment, which stops `pnpm dev` on a local anonymous deployment.
      // https://docs.convex.dev/auth/clerk#configuring-dev-and-prod-instances
      domain: "https://cheerful-cougar-1086.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
