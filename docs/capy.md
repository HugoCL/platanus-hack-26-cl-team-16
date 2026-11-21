# Capy setup (human steps)

Capy reads `.capy/setup.json` from GitHub on the branch the project's setup names, never from a machine checkout. Agents cannot do the steps below. Each is a one-time action in the Capy app or in the Captain's Drive.

## What `.capy/setup.json` does

- `initialize` (once per fresh clone and snapshot build, timeout 2400 s): installs pnpm 11.22.0 only if the machine's pnpm is not 11.x (Capy's Machines page lists 11.15.1, but the image can move to a newer major, so check the version in the build log; `package.json` pins `packageManager` to pnpm 11.22.0, which CI and Render read), installs deps with `pnpm install --frozen-lockfile`, installs `python3-venv`, `libatomic1` (Playwright's bundled Node needs it) and `unzip` (gstack unpacks Bun with it), bootstraps `.venv` (Playwright from `requirements-dev.txt`) and Chromium with `python3 scripts/smoke.py --bootstrap-only --with-deps`, the same code `pnpm smoke` uses, runs `agent-browser install --with-deps` (x86_64 only: Chrome for Testing has no Linux ARM64 build, so on ARM set `AGENT_BROWSER_EXECUTABLE_PATH` to Playwright's Chromium) and writes a small wrapper script at `~/.local/bin/agent-browser` that runs `node_modules/.bin/agent-browser` (pnpm's bin shim does not resolve a symlink), then clones gstack to `~/.local/share/gstack` (skipped if present) and runs `gstack-capy-install --require claude,codex,patch`. The script starts with `set -e` (not `pipefail`, which dash rejects), so any failing step, including `apt-get update`, fails the build.
- `refresh` (when a snapshot checkout moves to a newer commit): `pnpm install --frozen-lockfile`.
- Named commands: `smoke`, `skills-check`, `typecheck`, `lint`. There is no startup dev server.

## 1. Connect the repo

1. In Capy, create a project (or open an existing one) and add the GitHub repo `HugoCL/hackathon-toolbox`, or your team's copy of it.
2. Let Capy install its GitHub app on the repo if it asks.
3. Project settings: pick the machine size. `.capy/setup.json` cannot set it. `pnpm smoke` runs Next.js, the local Convex backend and Chromium at the same time, so start at Large and go smaller only after smoke passes there.
4. Settings → Members: invite your teammates.
5. Settings → Models: connect the Claude and Codex subscriptions (Claude Code: run `claude setup-token` on your computer and paste the token). `$subagent-routing` asks for Claude Opus and GPT Sol, and `initialize` runs `gstack-capy-install --require claude,codex`.

## 2. Test `.capy/setup.json` before merging

1. Project settings, Dev environment, the repository: set the setup branch to the branch you are testing.
2. Push a change to `.capy/setup.json` on that branch (or ask Capy for a "test build" from the branch). Per Capy's docs a change on a branch does nothing until it merges, except through a test build, which reads the branch's file and does not activate.
3. Watch the build log. A failed `initialize` is retried until it succeeds. Expect it to take several minutes (apt packages, Chromium, gstack). Check which pnpm version the log prints (see `initialize` above).
4. After the merge, set the setup branch back to `main`.

## 3. Turn on snapshots

Without a snapshot, every new thread, subagent machine and review pays the full `initialize` time. A snapshot boots in seconds.

1. Project settings, Dev environment, Snapshots: enable them.
2. On the repository row, turn on "include in snapshot". A new repository is not included until you turn it on.
3. Start a build from the same page. Enabling alone does not build: the hourly check would pick it up later.
4. After that, Capy rebuilds within the hour when `main` gets new commits, the setup changes, or the machine size changes. A failed build keeps the previous snapshot, and machines fall back to a full setup only when there is no snapshot at all.

## 4. Check the skills show up

1. Start a new thread on the branch. Type `$`.
2. Confirm the repo skills appear (`$gstack`, `$poteto-mode`, `$convex`, `$webapp-testing`, ...) and Capy built-ins such as `capy-setup`, `capy-docs`, `make-a-page`, `make-a-deck` and `make-a-prototype`.
3. Currently 62 skills set `disable-model-invocation: true` (the pstack skills, `to-tickets`, `thermo-nuclear-code-quality-review`, `ask-emil`, `learn-taste` and `prototype`; count them with `grep -l '^disable-model-invocation' .agents/skills/*/SKILL.md`). Check whether they still appear in `$`. If Capy hides them, the Captain and threads cannot invoke them by name: report it, then add `"stripFrontmatter": ["disable-model-invocation"]` to the affected collection in `scripts/skills/sources.json` and run `pnpm skills:sync <collection-id>` (do not edit `.agents/` by hand).
4. In the thread, run `$webapp-testing` or `pnpm smoke` to confirm the machine setup worked. For `agent-browser`, start `pnpm dev` first and run `agent-browser open http://localhost:3000`, or run `agent-browser open https://example.com`.

## 5. Captain and Drive files (not in this repo)

Create the Captain first if you have none (the New Captain dialog). Its Drive holds `CREW.md`, which every crew thread reads on every turn, and `AGENTS.md`, which only the Captain reads. Append the lines below. Do not replace existing rules.

Append to the Captain's `CREW.md`:

```md
## hackathon-toolbox

- Work happens in `HugoCL/hackathon-toolbox` (or the team's copy). Read its `AGENTS.md` first, including the "Phase to skill" table.
- Tickets are Markdown in `.scratch/<feature>/issues/`, committed. Make them with `$to-tickets`. Fan out independent tickets with `$dispatching-parallel-agents`, one thread per ticket and one PR per ticket.
- Every thread verifies with `pnpm lint && pnpm typecheck && pnpm test && pnpm smoke` before opening a PR (`$file-pr`).
- Commits and PR bodies follow `$git-conventions`. Subagent models and effort follow `$subagent-routing`.
- No merge, deploy, or publish without a human. Agents never run `npx convex login`, `npx convex deploy`, or claim the Clerk app.
- Handing a feature to a teammate: the giver runs `$poteto-mode` "Pause safely", the receiver runs `$takeover`.
```

Append to the root `AGENTS.md` of the project's Drive, so every thread in the project runs the check, crew threads included. Do not put it in the Captain's `AGENTS.md`: crew threads do not read that file. This is gstack's documented line (`crew/docs/recommended-harness.md`, "Day 0: install"):

> At the start of each session on a Capy cloud machine, load the user-scoped
> `gstack` skill and perform its installation check before starting work. If
> the check fails, follow the skill's session-start steps. Treat a session with
> no `gstack: ok` line from this machine as having no gstack: run no gstack
> workflow, claim none works, and report any blocker. Repeat this check on each
> separate task machine.

The line names a user-scoped `gstack` skill. This repo vendors the Capy wrapper at `.agents/skills/gstack`, so `$gstack` is already available to every thread on this repo and nothing needs copying. Only for threads on other repos, copy `capy/skill/gstack/` from a gstack checkout into a Drive as `skills/gstack/` (the project Drive for the team, your personal Drive for yourself).

## 6. Env vars and secrets

None are required to run the template. VMs stay on their local Convex deployment (`pnpm dev` runs it with no login). For real Clerk accounts, add these as Shared variables on the project's Environment variables page (never commit them): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Shared variables reach every machine in the project, reviews and snapshot builds included. Personal variables reach only threads you start, and thread variables reach only one running thread. A changed shared or personal value applies at the machine's next boot.

The app reads these only when a provider is created, and none is needed to build, test or run `pnpm dev`, because the defaults are the fake LLM and the local business fixture: `LLM_PROVIDER` (`fake` or `openrouter`), `AGENT_MODEL`, `MODERATOR_MODEL`, `OPENROUTER_API_KEY`, `BUSINESS_SOURCES`, `BUSINESS_ENRICHER`, `FIRECRAWL_API_KEY`, `GOOGLE_PLACES_API_KEY` and `OVERPASS_URL`. Code that runs in Convex reads them from the deployment's environment, which a human sets with `npx convex env set`. See [how to test Claude locally](development.md#try-claude-through-openrouter-locally).

Do not add `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` or `CLERK_JWT_ISSUER_DOMAIN`. They make every VM try to log in to Convex or point the page at the cloud deployment. `pnpm dev` also removes every Convex deployment variable (`CONVEX_DEPLOYMENT`, `CONVEX_SELF_HOSTED_*`) from the environment on purpose, unless a deploy key is set.

`CONVEX_DEPLOY_KEY` (or its alias `CONVEX_DEPLOYMENT_TOKEN`) is an option if every thread must use a cloud dev deployment; `pnpm dev` refuses a production key. The trade-off: parallel threads then push to one shared dev deployment and overwrite each other. See `AGENTS.md` for the account switch.

## 7. Threads on your own computer

A thread in the Capy desktop app runs in a folder on your computer, and `.capy/setup.json` does not run there. Do the setup by hand once per clone: `pnpm install`, `pnpm smoke` (bootstraps `.venv` and Chromium) and `pnpm browser:install` for `agent-browser`. Do not run the gstack installer on a laptop unless you want it in your `$HOME`. For real Clerk keys on your computer, put them in `.env.local` (gitignored) instead of relying on the project variables from section 6.
