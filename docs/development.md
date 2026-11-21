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

## Bookings (E8)

`convex/bookings.ts` holds the booking state of providers with the `booking` capability. It is internal: the provider agent books from inside a room.

| Function | Kind | What it does |
| --- | --- | --- |
| `freeSlots(ctx, agentId, now)` | helper | The provider's slots that start after `now` and have `booked < capacity`, in start order (at most 200 rows scanned), so a taken or past slot is never offered. Queries take `now` as an argument because they cannot read the clock. |
| `bookings.book` | internal mutation | Books one slot for a room where the agent is the provider. A room holds one booking: when it has one, `book` returns it, whatever slot was asked and even after the room closed. Otherwise the room must be open (`active`) with a contract that allows booking, and the slot must belong to an active, bookable offering of the provider. It creates a confirmed `booking` transaction and raises `booked` in the same mutation, never past `capacity`. A full slot, or one that starts at or before `now`, returns `{ status: "unavailable" }`. The result type is `Booking` in `lib/agents/booking.ts`. |

## Reference agents (E8)

The agents' cores live in `lib/agents/` and are pure. A turn goes in (`AgentTurn`: the room contract, its participants, the history the agent can see and the message it answers) and actions come out (`AgentAction`: messages to send through the room's moderation, or closing the room). They reach the model only through `LlmProvider`, so the tests run them on the fake LLM.

The provider (`lib/agents/provider.ts`) is generic. Its configuration is its card, its active offerings and their free slots, plus the `systemPrompt` of its `hostedAgentConfigs` row when it has one, all loaded by the internal query `providerAgent.context`. That query reads nothing from other rooms, so the provider has no other patient's data to give away even when a message gets past the moderator (criterion 4). For a text, the model picks one action:

- `offer_slots` (only with the `booking` capability): the provider sends the room's human a `slot_picker` with the first two free slots of the offerings the model picked. The model chooses offerings by key and never writes slots itself.
- `reply`: the model's answer goes back to the sender.
- `decline`: a fixed refusal goes back to the sender.

A `slot_selected` answer to one of its own pickers, from the human it was sent to, books that slot through `bookings.book` without asking the model. The human then gets a `confirmation` card and the consumer agent a text. If another room took the slot meanwhile, the human gets a new picker without it.

## Test

```sh
pnpm test
```

This runs Vitest offline, with no network and no credentials. `tests/setup.ts` replaces `fetch` with a function that throws, and `vitest.config.mts` sets `LLM_PROVIDER=fake` and `BUSINESS_SOURCES=fixture`. The suite covers:

- the valid and invalid examples of every shared contract (`shared/examples.ts`),
- the seed data: every card and offering validates, including offerings against their category's `attributeSchema`,
- the fake LLM, model selection from the environment, and the business sources,
- `seed:ensure` against an in-memory Convex (convex-test): every seeded agent is a valid card,
- bookings and the reference agents against the same in-memory Convex, with the fake LLM.

`pnpm smoke` is separate. It starts `pnpm dev` and drives the home page in Chromium.

## Configuration

Everything has an offline default. You set these variables only to use real services.

| Variable | Default | Use |
| --- | --- | --- |
| `LLM_PROVIDER` | `fake` | `openrouter` uses OpenRouter through the AI SDK. |
| `AGENT_MODEL` | `anthropic/claude-sonnet-5.5` | The agents' model. |
| `MODERATOR_MODEL` | `anthropic/claude-haiku-5.5` | The moderator's model. |
| `OPENROUTER_API_KEY` | none | Required with `LLM_PROVIDER=openrouter`. |
| `BUSINESS_SOURCES` | `fixture` | Comma list of `fixture`, `osm` and `google_places`. |
| `BUSINESS_ENRICHER` | `none` | `firecrawl` scrapes business websites. |
| `FIRECRAWL_API_KEY` | none | Required with `BUSINESS_ENRICHER=firecrawl`. |
| `GOOGLE_PLACES_API_KEY` | none | Required when `BUSINESS_SOURCES` includes `google_places`. |
| `OVERPASS_URL` | `overpass-api.de` | Another Overpass endpoint. |

Code in Convex reads these variables from the deployment's environment. A human sets them with `npx convex env set`. Next.js reads them from `.env.local`.

### Try Claude through OpenRouter locally

1. Create a test key in [OpenRouter → Keys](https://openrouter.ai/keys). You don't need an Anthropic key for standard OpenRouter billing.
2. Start `pnpm dev`. In a second terminal, confirm the Convex target is local or dev, then run:

   ```sh
   pnpm exec convex env set OPENROUTER_API_KEY
   pnpm exec convex env set LLM_PROVIDER openrouter
   pnpm exec convex run directory:searchText '{"query":"me duele el pecho en Providencia"}'
   ```

   Enter the key at the prompt, not on the command line. A response with `interpretation.source: "llm"` confirms the directory used the model. Run `pnpm exec convex env set LLM_PROVIDER fake` to switch back. `pnpm test` always runs offline.
