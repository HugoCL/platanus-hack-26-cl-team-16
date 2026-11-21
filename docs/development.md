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

## Rooms (E2)

A room is a `session` in `convex/rooms.ts`. Other code calls these functions:

| Function | Kind | What it does |
| --- | --- | --- |
| `rooms.open` | action | Opens a room from `initiatorAgentId` (the consumer agent), `providerAgentId` (the card) and the free-text `request`, with an optional `intent` (one the card allows; defaults to its first), `maxTurns` (default 12) and `human` (`{ displayName }`, added as the owner acting for the initiator). The contract is the request plus the card's purpose, capabilities, allowed intents, forbidden topics and data rules, and it never changes. Before anything is stored, the moderator reviews the request as a broadcast from the initiator, since everyone in the room can read it. Returns the room as a shared `Session`, already `active`. A missing, draft or invalid card, a room with oneself, a disallowed intent or a contract that fails validation throws a `ConvexError` with `data.kind` `"InvalidArgument"`. A request the moderator blocks, or a moderator that throws, throws `"RequestBlocked"` with the verdict's `rule` and reason as `message`, and stores nothing. If the provider card changes the contract during moderation, retry after `RoomContractChanged`. |
| `rooms.close` | mutation | Closes the room `sessionId` on behalf of `participantId`, one of its participants. It publishes one `session_closed` notice, and calling it again changes nothing. Later sends fail with `RoomClosed`, even when their moderation started before the close. A participant from another room throws `NotParticipant`. |
| `rooms.get` | query | One room by `sessionId` as a shared `Session` with its participants, or `null`. |
| `gate.send` | action | The single path for a participant's message: `sessionId`, `senderParticipantId`, `recipient` (a participant or `"all"`) and `content` (`SendableContent`: text, a UI block or a UI response). It asks the moderator, then stores the message with its verdict and returns it as a shared `Message`. A blocked message is stored as `blocked` and the gate adds a `moderator_alert` addressed to the sender. If the moderator throws, the message is blocked. Errors are `ConvexError`s whose `data.kind` is `NotFound`, `RoomClosed`, `NotParticipant` or `InvalidArgument`. |
| `gate.history` | query | The latest messages of a room in order (up to 500, and no more than 4 MiB of them), each a shared `Message` with its verdict. |

Only `convex/gate.ts` writes to `messages` (the seed is the one exception), and a test fails if another module does. Platform notices go through the same module without asking the moderator; the request quoted in `session_opened` was already moderated by `rooms.open`, and its `moderationEvents` rows point to that notice. The moderator sits behind the shared `Moderator` interface in `shared/moderation.ts`: `moderate({ content, sender, recipient, participants, contract, history })` (history holds the same latest messages as `gate.history`, in order) returns `{ verdict, events }`, and the gate stores one `moderationEvents` row per event. Until E3, `currentModerator()` returns `allowAllModerator`, which allows everything; E3 replaces it there and nowhere else.

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
