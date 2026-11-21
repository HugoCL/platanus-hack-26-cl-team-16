# CI, deploys and PR previews

Three things run without anyone starting them: CI on GitHub Actions, the production deploy on Render, and an opt-in preview for a pull request. Convex is the database and backend, so Render hosts one web service and nothing else. Everything is sized to cost $0 a month; the [cost table](#costs) says what would change that.

```mermaid
flowchart LR
  pr[Pull request] --> ci[CI]
  pr -- "label render-preview" --> preview[Render preview + Convex preview deployment]
  merge[Merge to main] --> cimain[CI on main]
  cimain -- "all checks pass" --> build[Render build: convex deploy + next build]
  build --> live[Production]
```

Nothing on Render exists until a person does the [one-time setup](#one-time-setup-human-only). Until then only CI runs.

## CI

`.github/workflows/ci.yml` runs one job on every pull request and on every push to `main`: `pnpm lint`, `pnpm skills:check`, `pnpm test` and `pnpm build` (which runs `pnpm typecheck` first). A run takes under a minute. The repository is public, so GitHub does not bill the minutes.

- **One job, one install.** The checks themselves take seconds, so separate jobs would spend more time on installs than on checks.
- **A newer push cancels the run it supersedes**, per branch or pull request.
- **Every push runs it, Markdown or not.** A path filter that skipped Markdown left a commit with no check at all, so its pull request showed a head nothing had verified. A run is under a minute and free here, and `buildFilter` in `render.yaml`, not CI, decides what spends build minutes.
- **Cache:** the pnpm store, keyed by `pnpm-lock.yaml`.
- **Versions come from the repository:** pnpm from `packageManager` in `package.json`, Node from `.node-version`. Render reads the same two.
- **The mirror does not run it.** Every commit is also pushed to `platanus-hack/platanus-hack-26-cl-team-16`. The job has an `if:` on the repository name, so on the mirror it is skipped and uses no minutes.
- **`pnpm smoke` is not in CI.** It starts `next dev`, which relies on Clerk keyless mode to create a temporary Clerk app. On a GitHub runner Clerk did not create one, and the page failed with `Missing publishableKey`. Smoke stays a check you run before opening a pull request, as `AGENTS.md` requires. To run it in CI, add the Clerk app's two development keys (step 5 below) as Actions secrets, and add a smoke step that reads them.

## Production

`render.yaml` is a Render Blueprint with one web service on the Free instance type, linked to `main`.

1. A commit lands on `main` and CI runs on it.
2. Render waits for the commit's GitHub checks (`autoDeployTrigger: checksPass`) and deploys only when all of them pass: the `check` job and any other app's check, such as GitGuardian's. A failed or cancelled run deploys nothing.
3. Render runs `scripts/render-build.sh`, which installs dependencies and runs `convex deploy --cmd 'pnpm build'`. That one command builds the Next.js app with `NEXT_PUBLIC_CONVEX_URL` set to the production Convex deployment, then pushes the Convex functions and schema to that same deployment. If the build or the push fails, the deploy fails and the previous version keeps serving.
4. Render starts `next start` and switches traffic once `/` answers.

The `buildFilter` in `render.yaml` keeps deploys from spending build minutes on changes that cannot alter the app: Render skips a commit that only touches Markdown, `.agents/`, `.capy/`, `.github/`, `.scratch/`, `licenses/` or `tests/`. Every commit that Render builds has had a CI run.

The Free instance stops after 15 minutes without traffic, and the next request waits about a minute while it starts. That is the price of $0. For a demo, change `plan` in `render.yaml` to `0.5c-512mb` (see [Costs](#costs)). Do not add a service that pings the app to keep it awake: it uses up the month's free instance hours, and when they run out Render suspends every Free service in the workspace.

Seed data is not loaded in production. `pnpm seed` runs `seed:ensure` against the deployment a person has selected. On 2026-11-21 production showed no agent cards on `/directorio`.

## PR previews

A preview is a second, temporary copy of the web service at its own `onrender.com` URL, with its own Convex backend and data. It exists only for pull requests that ask for one.

- **Ask for one:** add the label `render-preview` to the pull request. Render builds the branch and shows the URL as a deployment on the pull request. Each later push to the branch redeploys it.
- **Its backend:** the build script sees `IS_PULL_REQUEST=true` and deploys to a Convex preview deployment named after the branch, using `CONVEX_PREVIEW_DEPLOY_KEY`. `seed:ensure` fills its empty tables with the sample data. Later pushes reuse the same deployment and its data.
- **Remove it:** take the label off, or merge or close the pull request. Render deletes the preview instance.
- **Idle cost:** none. A preview is a Free instance too, so it stops after 15 minutes without traffic.
- **Convex deletes a preview deployment 5 days after it was created.** The Render preview then shows errors until the next push or a manual deploy from the Render Dashboard, which creates a new deployment.
- Render creates the preview when the label goes on, whatever the branch's last commit changed: on 2026-11-21 the label on a Markdown-only head commit still produced a preview service. `buildFilter` decides which later pushes rebuild it.

Things to know:

- A preview instance copies the variables of the base service when it is created, including the production deploy key. The build script therefore picks the key from `IS_PULL_REQUEST` and refuses a preview build with a production key and a production build with a preview key. Later changes to the base service's variables do not reach previews that already exist.
- That guard works and fails fast: on 2026-11-21 the first preview build stopped 30 s after the label went on with `This is a preview build, but its Convex deploy key is not a preview key`, and the preview service was deleted within a minute of the label coming off.
- **Saving a variable on the base service redeploys production.** Render redeploys the current `main` commit as soon as a variable changes, with trigger `service_updated`; on 2026-11-21 that put production through a 69 s deploy although no code had changed.
- Convex functions in a preview read their variables from the project's default environment variables for preview deployments, not from Render.
- Previews need the Hobby workspace plan only. Render's full "preview environments" need the Pro plan ($25/month) and are for projects with several Render services or Render databases, which this app does not have.
- The repository is public. A Render employee wrote in 2021 that a pull request from a fork does not create a preview, and the current docs do not mention forks. Check it before you rely on it: a preview build runs the pull request's code with the service's secrets.

## Costs

Prices and limits come from Render's and Convex's pricing pages and docs, read on 2026-11-21.

| Resource | Plan | Monthly cost at rest | Monthly cost in use | What spends |
| --- | --- | --- | --- | --- |
| GitHub Actions | Public repository, standard runner | $0 | $0 | Nothing is billed. Each run takes under a minute. |
| Render workspace | Hobby | $0 | $0 | Includes 500 build minutes, 750 Free instance hours and 5 GB of outbound bandwidth a month. |
| Render web service (production) | Free: 0.1 CPU, 512 MB | $0 | $0 | Instance hours while it is awake. Build minutes for each deploy. |
| Render PR preview (each) | Free, same as production | $0 | $0 | The same two budgets, only while the label is on and the instance is awake. |
| Convex | Free | $0 | $0 | 1,000,000 function calls, 0.5 GB of storage and 1 GB of database I/O a month. 40 deployments for the team. |
| Clerk | Free, development instance | $0 | $0 | Capped at 100 users. |

What changes the bill:

- **Build minutes run out.** With a payment method on the workspace, Render buys more at $5 per 1,000 minutes. With no payment method, or with a spend limit that is reached, Render stops building until next month and the app keeps running on its last build. Keep the workspace without a payment method, or set a spend limit (step 10 below).
- **Free instance hours run out.** Render suspends every Free web service until next month. Production alone uses at most 744 hours when it never sleeps, so previews only fit while production is allowed to sleep.
- **An always-on production.** `plan: 0.5c-512mb` costs $7 a month, billed by the second (about $0.23 a day). Each preview then also costs $7 a month for as long as it exists, because a preview uses its base service's plan. Take the label off when you finish.
- **Bandwidth above 5 GB.** Render bills the extra, or suspends the Free services when the workspace has no payment method.
- **A new entry in `render.yaml`.** Render creates it on the next sync. Review changes to that file as a cost decision.
- **Convex above the Free limits.** Nothing is billed: new writes start to fail.
- **Real LLM or business providers.** `LLM_PROVIDER=openrouter` and the other variables in `docs/development.md` spend those providers' credits. The defaults are offline and free.

## One-time setup (human only)

No agent does these steps. The repository records only one of them: `convex/auth.config.ts` names the team's Clerk app (step 6). Check the others in each dashboard.

Clerk keyless mode works only under `next dev`. A deployed build runs `next start`, which answers every request with an error ("Clerk keys are missing from your environment") unless `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set. The publishable key is compiled into the build, so both must be on the Render service before the first deploy.

### Convex

1. In a terminal, `npx convex login`, then `npx convex dev --configure=new` to create the cloud project. Stop it once it runs. This is step 1 of "Switch to real accounts" in `AGENTS.md`.
2. In the [Convex Dashboard](https://dashboard.convex.dev), create the project's production deployment if it has none. On that deployment's Deployment Settings page, General tab, click "Generate Production Deploy Key" and enable the `deployment:deploy` permission. The key starts with `prod:`. It becomes `CONVEX_DEPLOY_KEY` on Render.
3. On the project's Settings page (not a deployment's), section Preview Deploy Keys, click "Generate Preview Deploy Key". The key starts with `preview:team-slug:project-slug|`. It becomes `CONVEX_PREVIEW_DEPLOY_KEY` on Render. A `dev:`, `prod:` or `project:` key fails the preview build: the Dev deployment's Deployment Settings page generates the first of those.
4. Only when the app should use real providers: set the variables from `docs/development.md` (for example `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY`) on the production deployment (Settings, Environment Variables), and as default environment variables for preview deployments (Project Settings).

### Clerk

5. Claim the app: run `pnpm dev`, open the page and follow the "Configure your application" prompt. In the [Clerk Dashboard](https://dashboard.clerk.com), API keys, copy the publishable key (`pk_test_...`) and the secret key (`sk_test_...`). These are development-instance keys. Clerk accepts them on a host's own domain such as `onrender.com`, previews included, and caps the instance at 100 users.
6. Activate the Convex integration in Clerk and copy the Frontend API URL. `convex/auth.config.ts` names it as a literal `domain`: `https://cheerful-cougar-1086.clerk.accounts.dev`. Change it in a pull request only when the Clerk app changes. Convex then gives a signed-in user of that app an identity, in production and in previews.
7. A Clerk production instance (`pk_live_...`) needs a domain you own and DNS records on it, so it cannot use an `onrender.com` address. Create it only when the app has its own domain. Production and previews would then use different Clerk instances, and `auth.config.ts` would need the `CLERK_JWT_ISSUER_DOMAIN` variable per Convex deployment instead of a literal.

`@clerk/nextjs` 7 loads Clerk JS 6, replacing the version that Clerk rejected with `action_blocked`. To verify the team's integration, run with the existing Clerk development instance and a Convex dev deployment. Sign up a test user with a first and last name, sign in, and check that the home page says “Welcome” followed by that name rather than “Anonymous”; the name comes from Convex's authenticated identity, and a user without a name also shows “Anonymous”. Sign out and confirm that opening `/server` redirects to sign-in. Keyless mode cannot verify the team's Convex identity.

### Render

8. In the [Render Dashboard](https://dashboard.render.com), connect the GitHub account and give Render access to `HugoCL/platanus-hack-26-cl-team-16` only.
9. New, Blueprint, pick the repository and the `main` branch. Render reads `render.yaml`, shows the one service it will create, and asks for the four secret values. They live on the service's Environment page afterwards. No environment group is needed for a single service.

   | Variable | Value | Used |
   | --- | --- | --- |
   | `CONVEX_DEPLOY_KEY` | Step 2 | Production build |
   | `CONVEX_PREVIEW_DEPLOY_KEY` | Step 3 | Preview builds |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Step 5 | Build and runtime |
   | `CLERK_SECRET_KEY` | Step 5 | Runtime |

10. Leave the workspace without a payment method. If it has one, set a spend limit under Workspace Settings, Build Pipeline.
11. After the first deploy, open the service's Previews tab and check that pull request previews are set to Manual.

### GitHub

12. Create the label once: `gh label create render-preview --repo HugoCL/platanus-hack-26-cl-team-16`.
13. GitHub Actions needs no secrets. CI is offline and the deploy runs on Render. Only a future smoke step would need the Clerk development keys.
14. Put the production URL in `deploy-url` in `platanus-hack-project.jsonc`.

## The first working preview

On 2026-11-21 the label on PR #5, head `1350ced`, produced a preview that went live 67 s after the service was created:

- It deployed to the Convex preview deployment `preview/feat-clerk-convex-auth`, `fine-caterpillar-547.convex.cloud`, and `seed:ensure` filled 12 tables.
- From outside, `/` answered 200 and showed the 5 seeded numbers, `/directorio` listed 15 agents, and `/server` redirected to Clerk's sign-in page.
- The two apps keep their data apart: the preview's WebSocket pointed at `fine-caterpillar-547`, production's at the production deployment `courteous-gnu-824`, which still had no agent cards.
- Removing the label deleted the preview service within a minute and its URL answers 404. The Convex preview deployment stays until Convex expires it, 5 days after creation, or a person deletes it in the dashboard.

## Measured on the first deploy

The first production deploy ran on 2026-11-21 for commit `7afbeee`, triggered by the Blueprint sync.

- **88 seconds end to end**, 09:14:23 to 09:15:51 UTC: clone 4 s, install 15 s, `convex deploy` and `next build` 34 s, start and the health check on `/` 32 s. A deploy spends about one build minute, so 500 minutes carry roughly 500 deploys.
- **pnpm already matched.** The Node 24.22.3 runtime reported `pnpm --version` as 11.22.0, the version in `package.json`, so `scripts/render-build.sh` skipped its global install and installed the 164 lockfile packages in 12 s.
- **The health check on `/` passed with real Clerk keys.** The service went live at 09:15:51. From outside, `/` answers 200, loads Clerk from the development instance, and opens a WebSocket to the production Convex deployment; `/server` redirects to Clerk's sign-in page.
- **Render does wait for CI.** The merge commit `6e44f8a` put the `check` job in progress at 09:51:45 UTC and Render created no deploy while it ran; the job passed at 09:52:44 and the deploy appeared two seconds later, live after 68 s. The first deploy of the service came from the Blueprint sync, so only a push to `main` could show this.
- **Not verified on the first deploy:** that a signed-in user gets an identity in Convex. Clerk rejected the old browser SDK used in that deploy. Verify with the current SDK and the team's development instance as described above.
