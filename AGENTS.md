# hackathon-toolbox

Domain vocabulary: every session uses the terms in [`GLOSSARY.md`](GLOSSARY.md) (code, identifiers and file names in English; UI copy in Spanish).

Template for team hackathons, opened in [Capy](https://capy.ai) and usable from T3 Code, Claude Code, Codex, Cursor and Gemini/Antigravity. A Captain coordinates agent threads; you pick skills with `$`. It ships a Next.js + Convex + Clerk app that runs on a fresh clone, 100+ skills in `.agents/skills/` (catalog and limits: `docs/skills.md`), and the local tools agents use to develop and test.

## Stack and commands

Next.js 16 (App Router, Turbopack), Convex, Clerk, Tailwind 4, [UI SDK](https://ui-sdk.dev) (`@ui-sdk/react` + `@ui-sdk/core`, beta), Biome, TypeScript. pnpm only, never npm for project deps. Node 22+.

| Command | What it does |
| --- | --- |
| `pnpm install` | Install deps. The hardened pnpm config lives in `pnpm-workspace.yaml`; see Rules. |
| `pnpm dev` | Seeds empty Convex tables, then Convex plus Next.js on http://localhost:3000. Anonymous local Convex unless you switched to real accounts. `DEV_SEED=0` skips seeding. To stop one running in the background, send SIGINT to the `scripts/dev.mjs` process (`pkill -INT -f scripts/dev.mjs`): on Linux a signal sent to `pnpm` does not reach it, and other signals can leave `next dev` and the Convex backend running. |
| `pnpm dev:cloud` | Plain `convex dev --start 'next dev'`: no seed, and it does not force anonymous mode (Convex itself picks an anonymous deployment when you are not logged in or stdin is not a TTY). Needs `npx convex login`, which a human runs. |
| `pnpm lint`, `pnpm format` | `biome check .`, `biome check --write .`. Markdown is not linted. |
| `pnpm typecheck`, `pnpm build` | `next typegen` plus `tsc --noEmit`; `pnpm build` runs `pnpm typecheck`, then `next build` (it passes without `.env.local`; running needs `NEXT_PUBLIC_CONVEX_URL`). `pnpm start` serves the build. |
| `pnpm seed`, `pnpm seed:reset`, `pnpm migrate` | `convex run seed:ensure` (idempotent), a wipe plus reseed (local deployments only), and `convex run migrations:runAll`. They talk to the running deployment, so start `pnpm dev` first. |
| `pnpm test` | Vitest, offline: contract examples, seed data, fake LLM, business fixture, directory search and text parsing, the moderation set, rules and moderator, the room UI's formatting, and `seed:ensure` and `directory` through convex-test. No network or keys (`fetch` is stubbed to throw). |
| `pnpm eval:moderator` | Runs the moderation set against the real model on OpenRouter, for the full moderator and for the judge alone, and prints the E3 criteria and the cost. Needs `OPENROUTER_API_KEY` and spends credit, so it never runs in CI or `pnpm test`. `EVAL_RUNS` (default 10), `EVAL_CONCURRENCY` (default 4) and `MODERATOR_MODEL` tune it; the raw samples go to `artifacts/moderator-eval.json`. |
| `pnpm smoke` | Playwright smoke test. Starts `pnpm dev` itself, bootstraps `.venv` and Chromium on first run, saves `artifacts/smoke.png` and `artifacts/dev.log`. With a server already running: `SMOKE_REUSE=1 pnpm smoke`. `PORT` changes the port. |
| `pnpm browser:install` | Download Chrome for `agent-browser`. |
| `pnpm skills:sync [ids] [--update]` | Install or refresh vendored skills from `scripts/skills/sources.json` (staged, prunes orphans, regenerates `docs/skills.md`). |
| `pnpm skills:check` | Validate skill names and frontmatter, the lock, content hashes (a hand-edited vendored skill fails), no symlinks, and that `docs/skills.md` is fresh. |
| `pnpm skills:link` | Claude Code only: symlink `.agents/skills` into `.claude/skills` (gitignored). |

Code lives in `src/` (`src/app/` routes, `src/components/`, `src/styles/`, `src/proxy.ts`), `convex/` (backend), `shared/` (contracts, seed data, moderator) and `lib/` (directory text parsing, shared by Convex and tests). Tests are in `tests/`, the paid moderator eval in `evals/`. `@/*` maps to `src/*`, `@/convex/*` to `convex/*` and `@/shared/*` to `shared/*` (tsconfig and `vitest.config.mts`). Before touching `convex/`, read `convex/_generated/ai/guidelines.md`.

Architecture (Spanish) and the contracts every track builds on: `docs/architecture.md`; the zod schemas in `shared/` are the source of truth for `convex/schema.ts`. Start and test from a clean clone: `docs/development.md`. CI, the production deploy on Render and PR previews, with their costs and the human-only setup: `docs/deploy.md`.

## UI: UI SDK primitives, your design system

The UI uses [UI SDK](https://ui-sdk.dev) (Vercel): unstyled, accessible primitives built from behaviors (focus, keyboard, selection, popups, ARIA). There is no shadcn and no component kit. Each team's agents design the system on top of the primitives.

- Before using UI SDK, follow `$ui-sdk` and read `node_modules/@ui-sdk/react/docs/llms.txt`, then only the component pages you need. To build a component it does not ship, search `node_modules/@ui-sdk/react/docs/core.md` by heading (it is large) and read `rendering.md` next to it.
- Import each component from its entry (`@ui-sdk/react/button`), never from a package root. Components already say `"use client"`, so server components can render them.
- File naming: first-party files and folders use kebab-case (`toggle-theme.tsx`, not `ToggleTheme.tsx`; `seed-data.ts`, not `seedData.ts`). Exported React components stay PascalCase (`export default function ToggleTheme`). Exceptions: `convex/` modules use camelCase (`myFunctions.ts`), because a Convex file path becomes its function path (`api.myFunctions.addNumber`) and Convex only accepts letters, digits, underscores and periods there; names a tool expects (`README.md`, `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `.github/pull_request_template.md`, Next.js files such as `page.tsx`, `layout.tsx`, `proxy.ts` and `next-env.d.ts`, config files, `convex/_generated/`); and vendored files under `.agents/` and `licenses/`.
- Use a UI SDK component wherever one exists (Button, Dialog, Select, Field...). Do not hand-roll `role=` widgets.
- `src/styles/globals.css` declares `@layer ui-sdk;` above Tailwind and imports `@ui-sdk/core/web.css` (the default look) into `layer(components)`. Keep that order.
- `web.css` also restyles bare `a`, `code`, `hr` and `kbd` app-wide, and gives buttons a filled look with `data-variant="solid"` (a `web.css` hook, not a component prop; its sizes and icons are only written down in `node_modules/@ui-sdk/core/dist/web.css`).
- Tokens live in `src/styles/tokens.css`: neutral `--ui-*` placeholders at UI SDK's defaults (except `--ui-ring`, raised to 3:1 so keyboard focus shows), mapped to Tailwind colors (`bg-muted`, `text-muted-foreground`, `border-border`) in `globals.css`. The design system starts there: set the team's palette, type, radius and spacing with `$frontend-design`, then style parts by `data-slot` and state attributes (`data-pressed`, `data-open`). Check contrast in a real browser.
- The packages are pinned to `0.1.0-beta.7`, the newest beta past `minimumReleaseAge` on 2026-11-20. Bump `@ui-sdk/react`, `@ui-sdk/core` and the `ui-sdk` skill commit in `scripts/skills/sources.json` together.

Convex conventions (details in the file headers):

- New table in `convex/schema.ts`: add its seeder in `convex/seed.ts`. `pnpm typecheck` fails until every table has one.
- Destructive schema change or backfill: write a migration in `convex/migrations.ts`, add it to `runAll`, run `pnpm migrate`.
- Components: `@convex-dev/migrations`, `@convex-dev/rate-limiter` (`addNumber` is limited and throws a `ConvexError` whose `data.kind` is `"RateLimited"`, see `isRateLimitError`), `@convex-dev/workpool` mounted as `backgroundWork` (example in `convex/jobs.ts`).

Smoke checks the landing's `h1` ("Las páginas amarillas"). Then it opens `/directory` and waits for one `data-testid="agent-card"` per non-draft card in `SEED_AGENTS` (read from `shared/seed-data.ts` with Node, capped at the page size of 20). The PR that changes the home page updates `check()` in `scripts/smoke.py` in the same PR.

## Local dev with no accounts

`pnpm dev` needs no Convex or Clerk login.

- **Convex.** A local deployment runs as a subprocess of `convex dev` (`CONVEX_AGENT_MODE=anonymous`, set by `scripts/dev.mjs`). State is in `.convex/` and `.env.local`, both gitignored. `pnpm dev` stays anonymous unless `CONVEX_DEPLOY_KEY` or `CONVEX_DEPLOYMENT_TOKEN` is set, or `.env.local` or `.env` selects a deployment (`CONVEX_DEPLOYMENT=` that does not start with `anonymous:`, or `CONVEX_SELF_HOSTED_*`). In anonymous mode every Convex deployment variable is removed from the children's environment, and cloud mode refuses a production key or deployment (`pnpm dev` pushes and seeds).
- **Clerk.** Keyless mode provisions temporary dev keys on first load. The prompt "Configure your application" in the corner is expected.
- `convex/auth.config.ts` accepts tokens from the team's Clerk app only (`cheerful-cougar-1086.clerk.accounts.dev`, a development instance). The keyless app is a different Clerk app, so in this mode Convex sees every user as signed out. The signed-in UI needs the team's Clerk keys (the switch below). `/server` requires sign-in (`src/proxy.ts` protects it).
- Sign-in and sign-up do not work yet in any mode. Clerk answers both with `action_blocked` ("This app uses an outdated version of Clerk") for clerk-js 5, which `@clerk/nextjs` 6 loads, and accepts them from clerk-js 6. They need a Clerk SDK upgrade: the repository has `@clerk/nextjs` 6 and the current major is 7.

### Switch to real accounts (a human does this once)

1. `npx convex login`, then point `.env.local` at a cloud dev deployment: `npx convex dev --configure=new` for a new project (stop it once it is running), or `npx convex deployment select dev` for an existing one. `pnpm dev` then detects the non-anonymous `.env.local` by itself.
2. Put the team's Clerk development keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, from the Clerk Dashboard, API keys) in `.env.local`. The team's app is already claimed and its Convex integration is active.
3. `convex/auth.config.ts` already names that app's Frontend API URL as a literal `domain`. Change it only to move to another Clerk app, and keep it a literal. Do not use `process.env`: when the variable is not set on the deployment, `convex dev` exits.
4. On Capy, put the Clerk keys in the project variables (`docs/capy.md`).

Convex Auth is the account-free alternative to Clerk. Clerk stays the default here.

## Tickets

Local Markdown tracker, committed so teammates see them: `.scratch/<feature>/spec.md` and `.scratch/<feature>/issues/NN-<slug>.md`. `$to-tickets` writes them and mirrors each to the available tracker. Conventions and tracker order: `docs/agents/issue-tracker.md`. Do not add `.scratch/` to `.gitignore`.

## Rules

- No merge, deploy, publish, or `npx convex deploy` without a human.
- No claiming the Clerk app and no `npx convex login` from an agent.
- Do not hand-edit vendored skills in `.agents/`, `skills-lock.json`, or `licenses/`: `pnpm skills:check` fails on drift. Change `scripts/skills/sources.json`, then `pnpm skills:sync`. The first-party `toolbox` skills (`harness-map`, `subagent-routing`, `git-conventions`) are the exception and are edited in place.
- Do not disable pnpm's security settings (in `pnpm-workspace.yaml`). Fix a failing install by pinning an older version or adding a documented exception there.
- Commits, branches and PR bodies follow `$git-conventions`. Before a PR, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm smoke` pass. Open a PR for each ticket with `$file-pr`. Keep changes small.
- Subagents and model choices follow `$subagent-routing`: defaults are in its editable table, effort `high`.
- When a skill names a tool you do not have, use `$harness-map`.

## Phase to skill

| Phase | Skills |
| --- | --- |
| Plan | `$gstack` (then its `/office-hours` or `/autoplan` workflow), `$how` |
| Tickets | `$to-tickets`. The Captain fans out with `$dispatching-parallel-agents`. |
| Implement | `$poteto-mode` (Feature playbook), `$tdd`, `$ponytail`. For the stack: `$convex`, `$clerk-nextjs-patterns`, `$ai-sdk`, `$ui-sdk`. |
| Design | UI SDK primitives (`$ui-sdk`) plus `$frontend-design` for the design system (tokens in `src/styles/tokens.css`). Capy built-in: `$make-a-prototype`. |
| QA | `$webapp-testing` (run its scripts with `.venv/bin/python`; `pnpm smoke` creates it), `$agent-browser` (outside Capy run `pnpm exec agent-browser`; on Capy `initialize` writes a wrapper script at `~/.local/bin/agent-browser`, UNCONFIRMED on a real Capy VM), `$ponytail-review`. gstack `/qa` through `$gstack`. |
| Before review | `$deslop`, then `$make-pr-easy-to-review` |
| Review | `$thermo-nuclear-code-quality-review` as the maintainability lens, seats and models per `$subagent-routing` |
| PR | `$git-conventions` (commits, PR body, evidence; template in `.github/pull_request_template.md`), `$file-pr`, `$babysit-pr` |
| Hand off a feature | The giver runs `$poteto-mode` "Pause safely". The receiver runs `$takeover`. |

Capy machine setup is `.capy/setup.json`. Human-only Capy steps: `docs/capy.md`.

## Use outside Capy

- T3 Code, Codex, Cursor and Gemini/Antigravity read `.agents/skills` directly.
- Claude Code needs `pnpm skills:link` once.
- Setup: `pnpm install`, then `pnpm smoke` (bootstraps `.venv` and Chromium), and `pnpm browser:install` for `agent-browser`.
- gstack is Capy-oriented: its installer writes into `$HOME`. Do not run it on a laptop unless you mean to.
- Tool names differ per harness: `$harness-map`.

<!-- convex-ai-start -->
Always read `convex/_generated/ai/guidelines.md` before writing Convex code. It overrides what you may remember about Convex APIs.
<!-- convex-ai-end -->

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
