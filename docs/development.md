# Development

## Start

From a clean clone, one command installs and starts the app. It needs no accounts and no API keys:

```sh
pnpm install && pnpm dev
```

`pnpm dev` starts a local Convex backend, loads the seed data into every empty table (`seed:ensure`), and serves the app at http://localhost:3000. The seed data lives in `shared/seedData.ts`: 15 fictitious agent cards across 13 categories, the Providencia clinic with 2 doctors and 4 open slots, a hotel with nightly availability, shops with priced products, and one example room.

If a schema change is rejected because your local data no longer matches it, stop `pnpm dev`, delete `.convex/local`, and start again. That gives you a fresh local database that is reseeded from `shared/seedData.ts`.

## Agent directory (E1)

The directory lives in `convex/directory.ts` and the page at http://localhost:3000/directorio. Other code calls these functions:

| Function | Kind | What it does |
| --- | --- | --- |
| `directory.search` | query | Cards by `category` (an exact slug through the index, else a label; a parent includes its children, so `salud` matches `cardiologia`) and `comuna`, both optional, plus `limit` (an integer from 1 to 20, default 20). Returns `{ agents, truncated }`. Verified cards come first, then active before unclaimed, ranked across every card scanned. A search scans at most 1000 cards or 8 MiB and returns at most 4 MiB; `truncated` is true whenever the result is partial: more matches than `limit`, a scan or response budget reached, or a bounded category lookup. Cards that fail the shared `AgentCard` contract are never returned. |
| `directory.searchText` | action | Free text such as "cardiólogo en Providencia". `lib/directory.ts` splits it into words and matches category phrases (plurals allowed), exact comuna names and explicit aliases ("Santiago Centro"). Words after "en", "cerca" or "comuna" that aren't a known comuna are an unresolved place, and a comuna followed by "de …" ("Santiago de Compostela") is an unresolved longer name; ordinary words after a found comuna ("Providencia este sábado") don't change it. Only an unresolved half goes to the `LlmProvider`; an answer outside the known categories and comunas is ignored. If a half stays unresolved, it returns no cards. A missing key or a provider error gives `diagnostic: "llm_unavailable"` and a fixed log line. The query is capped at 300 characters, and LLM calls share a rate limit (`directoryTextLlm`: bursts of 10, then 30 per minute across all callers) that throws a `RateLimited` `ConvexError`; searches the parser resolves don't count. Returns the interpretation plus `agents` and `truncated`. |
| `directory.get` | query | One card by exactly one of `slug` or `agentId`, or `null` when it is missing, a draft, or invalid under the contract. |
| `directory.categories` | query | The category tree. |

Each card is an `AgentDetail` (the full `AgentCard` with purpose and scope) plus `comuna` and `allowedIntents`, so it also validates as an `AgentSummary`. Draft cards are never listed.

## Test

```sh
pnpm test
```

This runs Vitest offline, with no network and no credentials. `tests/setup.ts` replaces `fetch` with a function that throws, and `vitest.config.mts` sets `LLM_PROVIDER=fake` and `BUSINESS_SOURCES=fixture`. The suite covers:

- the valid and invalid examples of every shared contract (`shared/examples.ts`),
- the seed data: every card and offering validates, including offerings against their category's `attributeSchema`,
- the fake LLM, model selection from the environment, and the business sources,
- `seed:ensure` against an in-memory Convex (convex-test): every seeded agent is a valid card.

`pnpm smoke` is separate. It starts `pnpm dev` and drives the home page in Chromium.

## Configuration

Everything has an offline default. You set these variables only to use real services.

| Variable | Default | Use |
| --- | --- | --- |
| `LLM_PROVIDER` | `fake` | `gateway` uses Vercel AI Gateway. |
| `AGENT_MODEL` | `anthropic/claude-sonnet-5.5` | The agents' model. |
| `MODERATOR_MODEL` | `anthropic/claude-haiku-5.5` | The moderator's model. |
| `AI_GATEWAY_API_KEY` | none | Required with `LLM_PROVIDER=gateway`. |
| `BUSINESS_SOURCES` | `fixture` | Comma list of `fixture`, `osm` and `google_places`. |
| `BUSINESS_ENRICHER` | `none` | `firecrawl` scrapes business websites. |
| `FIRECRAWL_API_KEY` | none | Required with `BUSINESS_ENRICHER=firecrawl`. |
| `GOOGLE_PLACES_API_KEY` | none | Required when `BUSINESS_SOURCES` includes `google_places`. |
| `OVERPASS_URL` | `overpass-api.de` | Another Overpass endpoint. |

Code in Convex reads these variables from the deployment's environment. A human sets them with `npx convex env set`. Next.js reads them from `.env.local`.
