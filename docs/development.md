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

A room is a `session` in `convex/rooms.ts`. E4 calls these public functions with the signed-in user's Clerk token. The server finds that user's active human participant by `tokenIdentifier` and `sessionId`. The client never supplies a sender or viewer ID.

| Function | Kind | What it does |
| --- | --- | --- |
| `rooms.get({ sessionId })` | query | Returns the shared `Session` and its participants. |
| `rooms.close({ sessionId })` | mutation | Closes the room and publishes one `session_closed` notice. Calling it again changes nothing. Later sends fail with `RoomClosed`, even if moderation started before the close. |
| `gate.send({ sessionId, recipient, content })` | action | Sends as the signed-in participant. `recipient` is a participant ID or `"all"`; `content` is `SendableContent` (text, a UI block or a UI response). Returns the message with its verdict. A blocked send is stored as `blocked` and generates a `moderator_alert`. |
| `gate.history({ sessionId })` | reactive query | Returns the latest visible messages in chronological order (up to 500 messages and 4 MiB). |
| `gate.historyPage({ sessionId, paginationOpts })` | paginated query | Returns visible messages in chronological order. Use the returned cursor until `isDone`, even if a filtered page is empty. A page reads at most 4 MiB, so it can hold fewer than `numItems`. |

These calls return `Unauthorized` without a Clerk identity, and `NotParticipant` for an authenticated user without active membership. Both agents and the human see allowed messages; only the sender and humans see a blocked message and its alert. A client that falls behind the `gate.history` window reads the gap with `gate.historyPage`.

For the E4 launch form, E8 provides a server action that authenticates the user, chooses the consumer agent on the server and calls `openRoom(ctx, args)` from `convex/rooms.ts`. The internal `rooms.open` action takes the same arguments: `initiatorAgentId`, `providerAgentId`, `request`, and optionally `intent`, `maxTurns` and `human: { displayName }`. If `human` is set, the server attaches the signed-in user as the room owner; it never uses a shared anonymous identity. The moderator checks the request as a broadcast before any write and raises `RequestBlocked` if it refuses the request. If the provider card changes the contract during moderation, retry after `RoomContractChanged`.

Trusted agent code sends through `sendThroughGate(ctx, args)` with its server-resolved participant ID. To close from an action, call `internal.rooms.closeAsParticipant` with `sessionId` and the server-resolved `participantId`. Existing anonymous room fixtures are not memberships for signed-in users.

Only `convex/gate.ts` writes to `messages` (the seed is the one exception), and a test fails if another module does. Platform notices go through the same module without asking the moderator; the request quoted in `session_opened` was already moderated by `rooms.open`, and its `moderationEvents` rows point to that notice. The moderator sits behind the shared `Moderator` interface in `shared/moderation.ts`: `moderate({ content, sender, recipient, participants, contract, history })` (history holds the same latest messages as `gate.history`, in order) returns `{ verdict, events }`, and the gate stores one `moderationEvents` row per event. Until E3, `currentModerator()` returns `allowAllModerator`, which allows everything; E3 replaces it there and nowhere else.

An allowed message addressed to a hosted agent schedules a reply after the message is stored. The agent gets only the history it could see as a participant. The reply goes back to the original sender through the same gate and gets its own verdict. E2 uses a deterministic acknowledgment backed by the fake LLM; E8 supplies real room agents.

Every stored agent message consumes one turn. The final turn records `turn_limit_reached` in the same transaction. After that, extra agent sends fail with `TurnLimitReached` and no more agent replies are scheduled; humans can still send.

## Test

```sh
pnpm test
```

This runs Vitest offline, with no network and no credentials. `tests/setup.ts` replaces `fetch` with a function that throws, and `vitest.config.mts` sets `LLM_PROVIDER=fake` and `BUSINESS_SOURCES=fixture`. The suite covers:

- the valid and invalid examples of every shared contract (`shared/examples.ts`),
- the seed data: every card and offering validates, including offerings against their category's `attributeSchema`,
- the fake LLM, model selection from the environment, and the business sources,
- `seed:ensure` against an in-memory Convex (convex-test): every seeded agent is a valid card.

`pnpm smoke` starts `pnpm dev` and drives the home and directory pages in Chromium. It also runs the offline room checks for message order, visibility and membership. Those checks don't need a Clerk account or a Convex deployment.

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
