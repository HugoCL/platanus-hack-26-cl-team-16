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

A room is a `session` in `convex/rooms.ts`. Call `rooms.close` with the room's `sessionId` and a `participantId` to close it. Closing publishes one system notice, even if called again, and later sends fail with `RoomClosed`.

| Function | Kind | What it does |
| --- | --- | --- |
| `rooms.open` | mutation | Opens a room from `initiatorAgentId` (the consumer agent), `providerAgentId` (the card) and the free-text `request`, with an optional `intent` (one the card allows; defaults to its first), `maxTurns` (default 12) and `human` (`{ displayName }`, added as the owner acting for the initiator). The contract is the request plus the card's purpose, capabilities, allowed intents, forbidden topics and data rules, and it never changes. Returns the room as a shared `Session`, already `active`. A missing, draft or invalid card, a room with oneself, a disallowed intent or a contract that fails validation throws a `ConvexError` with `data.kind` `"InvalidArgument"`. |
| `rooms.get` | query | One room by `sessionId` as a shared `Session` with its participants, or `null`. |
| `gate.send` | action | The single path for a participant's message: `sessionId`, `senderParticipantId`, `recipient` (a participant or `"all"`) and `content` (`SendableContent`: text, a UI block or a UI response). It asks the moderator, then stores the message with its verdict and returns it as a shared `Message`. A blocked message is stored as `blocked` and the gate adds a `moderator_alert` addressed to the sender. If the moderator throws, the message is blocked. Errors are `ConvexError`s whose `data.kind` is `NotFound`, `RoomClosed`, `NotParticipant` or `InvalidArgument`. |
| `gate.history` | reactive query | The latest 500 records for a room, in chronological order and filtered for `viewerParticipantId`. |
| `gate.historyPage` | paginated query | The full room history in chronological order, with the same visibility rules. Pass Convex `paginationOpts` and use the returned cursor until `isDone`, even if a filtered page is empty. |

Both agents and the human see allowed messages; only the sender and humans see a blocked message and its alert. An ID from another room throws `NotParticipant`. The viewer ID selects a perspective, not an authenticated identity.

Only `convex/gate.ts` writes to `messages` (the seed is the one exception), and a test fails if another module does. Platform notices, such as `session_opened`, go through the same module without asking the moderator. The moderator sits behind the shared `Moderator` interface in `shared/moderation.ts`: `moderate({ content, sender, recipient, participants, contract, history })` (history contains up to the latest 500 room messages, in order) returns `{ verdict, events }`, and the gate stores one `moderationEvents` row per event. Until E3, `currentModerator()` returns `allowAllModerator`, which allows everything; E3 replaces it there and nowhere else.

An allowed message addressed to a hosted agent schedules a reply after the message is stored. `roomAgentFor(agent)` in `convex/roomAgent.ts` picks the `RoomAgent` that answers for that card and the `LlmProvider` it uses. The agent gets the action context, its own participant ID, the message, the contract, the participants, and only the history it could see as a participant. It answers with a list of actions, run in order: each `send` goes through the same gate with the agent as sender, to any participant or to `"all"`, and gets its own verdict; `close` closes the room through `rooms.close`. Once the room is closed or out of turns, the remaining actions are dropped. E2 answers every card with a deterministic acknowledgment backed by the fake LLM, sent back to the sender; E8 supplies real room agents.

Every stored agent message consumes one turn. The final turn records `turn_limit_reached` in the same transaction. After that, extra agent sends fail with `TurnLimitReached` and no more agent replies are scheduled; humans can still send.

## Bookings (E8)

`convex/bookings.ts` holds the booking state of providers with the `booking` capability. It is internal: the provider agent books from inside a room.

| Function | Kind | What it does |
| --- | --- | --- |
| `freeSlots(ctx, agentId, now)` | helper | The provider's slots that start after `now` and have `booked < capacity`, in start order (at most 200 rows scanned), so a taken or past slot is never offered. Queries take `now` as an argument because they cannot read the clock. |
| `bookings.book` | internal mutation | Books one slot for a room where the agent is the provider. A room holds one booking: when it has one, `book` returns it, whatever slot was asked and even after the room closed. Otherwise the room must be open (`active`) with a contract that allows booking, and the slot must belong to a bookable offering of the provider. It creates a confirmed `booking` transaction and raises `booked` in the same mutation, never past `capacity`. A booking names its slot in `slotId`. A full slot, one that starts at or before `now`, or one whose offering the provider turned off returns `{ status: "unavailable" }`. The result type is `Booking` in `lib/agents/booking.ts`. |

## Reference agents (E8)

The agents' cores live in `lib/agents/` and are pure. A turn goes in (`AgentTurn`: the room contract, its participants, the history the agent can see and the message it answers) and actions come out (`AgentAction`: messages to send through the room's moderation, or closing the room). They reach the model only through `LlmProvider`, so the tests run them on the fake LLM.

The provider (`lib/agents/provider.ts`) is generic. Its configuration is its card, its active offerings and their free slots, plus the `systemPrompt` of its `hostedAgentConfigs` row when it has one, all loaded by the internal query `providerAgent.context` (with `now`, so past slots are left out). That query reads nothing from other rooms, so the provider has nobody else's data to give away even when a message gets past the moderator (criterion 4).

It acts only on a delivered message addressed to it (or to `all`). For a text, the model picks one action:

- `offer_slots` (only when the room's contract has the `booking` capability): the provider sends the room's human owner a `slot_picker` with the first two free slots of the offerings the model picked. The model chooses offerings by key and never writes slots itself. With no human in the room, it says so in text.
- `reply`: the model's answer goes back to the sender.
- `decline`: a fixed refusal goes back to the sender.

A `slot_selected` answer, from the human its picker was sent to, books that slot through `bookings.book` without asking the model. The provider then sends that human a `confirmation` card and closes the room, so the scenario ends the same way whatever consumer is in the room. A room holds one booking: a choice of another slot gets no answer, and the booked slot is confirmed again only while the room has no confirmation from the provider, so a turn cut short after booking can be retried. If another room took the slot meanwhile, the human gets a new picker with the same offering's other slots.

The consumer (`lib/agents/consumer.ts`) starts from the human's request as written. `chooseProvider` searches with `directory.searchText`, using the request as written or, when it is longer than the search's 300 characters, a short query the model writes from it. It gives the model the first five cards that allow some intent, as `<card>:<intent>` pairs. The model picks one pair, or none, and writes the opening message. The request never enters the room's contract, which skips moderation: the contract's intent description names only the intent and the provider, and the provider learns the request from the moderated opening. In the room, `consumerTurn` answers only delivered messages its provider sent to it or to everyone: the model replies, waits, or closes, and always sees the consumer's opening, however long the room gets. The provider closes the room when it confirms the booking.

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

`pnpm smoke` starts `pnpm dev`, drives the home and directory pages in Chromium, and verifies that three independent Convex subscriptions see the same room messages in order. The room check runs only against a local Convex backend.

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
