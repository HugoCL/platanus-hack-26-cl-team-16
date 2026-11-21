# hackathon-toolbox

Template for team hackathons: Next.js + Convex + Clerk, plus the skills and tools agents need. Open it in [Capy](https://capy.ai), or use it from T3 Code, Claude Code, Codex, Cursor or Gemini/Antigravity. Agents start with [`AGENTS.md`](AGENTS.md).

```
pnpm install    # Node 22+, pnpm 11
pnpm dev        # http://localhost:3000, no Convex or Clerk account needed
pnpm smoke      # Playwright smoke test; starts dev itself (SMOKE_REUSE=1 pnpm smoke if dev is already running)
```

`pnpm smoke` needs Python 3 and creates `.venv` and Chromium on first run. Claude Code users run `pnpm skills:link` once so it sees `.agents/skills`.

- [`AGENTS.md`](AGENTS.md): stack, commands, rules, phase to skill table, use outside Capy.
- [`docs/capy.md`](docs/capy.md): one-time Capy setup (human steps).
- [`docs/skills.md`](docs/skills.md): the full skill catalog and limitations.
