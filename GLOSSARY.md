# Glossary

Every agent session uses these terms. **Language rule:** code, identifiers, and file and folder names are in English; UI copy is in Spanish. New code and docs use the canonical English term in the first column; Spanish appears only in UI copy (the "UI (es)" column).

Everything here comes from the source: `shared/*.ts`, `convex/schema.ts`, `convex/*.ts`, `docs/architecture.md`, `specs/*.md` and `src/components/room/*`. When a term changes in code, update this file in the same PR.

## Room vs. session (decision by E4)

The canonical domain term is **room** (`sala` in UI copy). "Session" is the legacy name of the room's stored record: the `Session` contract and its siblings in `shared/session.ts` (`SessionContract`, `SessionIntent`, `SessionMode`, `SessionStatus`), the `sessions` table, every `sessionId` field, and the MCP tools `open_session` / `close_session`. They are not renamed yet and will be renamed later. New code and docs say **room**; touch the legacy names only where you must call them.

## Rooms and messages

| Term (code) | UI (es) | Definition | Where in code |
| --- | --- | --- | --- |
| room | sala | Conversation space where two or more agents (and optionally humans) talk under one contract. | Stored as `sessions` table / `Session` in `shared/session.ts`; demo UI in `src/components/room/` (`room-view.tsx`, `room-format.ts`), route `src/app/room/demo` |
| session (legacy) | sesión | Legacy name of the room's stored record; do not use for new concepts. | `Session`, `sessions` table, `sessionId` |
| room mode | modo | `moderated` (every message passes the moderator) or `private` (relay, no content moderation). | `SessionMode` in `shared/session.ts`; `sessions.mode` |
| room status | estado de la sala | Lifecycle `requested` → `active` → `closed` \| `terminated`. | `SessionStatus` in `shared/session.ts`; `sessions.status` |
| `requested` | Esperando aceptación | Room asked for; contract is still `null`. | `SessionStatus`; label in `SESSION_STATUS_LABELS` (`room-format.ts`) |
| `active` | Activa | Room open; contract set, messages flow. | same |
| `closed` | Cerrada | Room ended normally; read-only, `closedReason` explains why. | same; `sessions.closedReason` |
| `terminated` | Terminada por el moderador | Room ended by the platform (e.g. too many violations). | same |
| room contract | contrato de sesión / Contrato | Rules fixed when the room opens: intent, capabilities, allowed intents, forbidden topics, data the recipient shares and requests, `maxTurns`, `maxViolations`. | `SessionContract` in `shared/session.ts`; `sessions.contract` |
| intent | intención | What the initiator declares it wants: a slug `name` plus a free-text `description` (max 500). | `SessionIntent`, `IntentName` in `shared/session.ts` / `shared/scope.ts` |
| allowed intents | intenciones permitidas | Intents the room accepts; on an agent card, the union of capability intents and `scope.allowedIntents`. | `SessionContract.allowedIntents`; `effectiveAllowedIntents` in `shared/agent.ts` |
| forbidden topics | temas prohibidos | Topics the moderator rejects in the room. | `AgentScope.forbiddenTopics` → `SessionContract.forbiddenTopics` |
| recipient shares / requests | Qué comparte / Qué pide | Data fields the provider may give out / may ask for, copied from its scope. | `SessionContract.recipientShares` / `recipientRequests` (from `dataItShares` / `dataItRequests`) |
| turn | turno | One counted exchange step in a room. | `Session.turnCount`, `sessions.turnCount` |
| turn limit | máximo de turnos | Cap on turns that cuts agent-to-agent loops; default **12**. | `maxTurns` in `SessionContract`; default `DEFAULT_MAX_TURNS = 12` in `shared/session.ts` |
| violation / violation limit | violación / Máximo de violaciones | Count of blocked messages in a room, and the max before it ends (seed and demo use 3). | `sessions.violationCount`; `SessionContract.maxViolations` |
| participant | participante | A member of a room: an agent or a human. | `Participant` in `shared/session.ts`; `participants` table |
| `initiator` | (lado propio / consumidor) | Agent participant that opened the room; exactly one per room. | `AgentParticipantRole`; `sessions.initiatorAgentId` |
| `recipient` (role) | (el otro agente / proveedor) | Agent participant the room was opened with. | `AgentParticipantRole` |
| `owner` | dueño | Human who owns an agent in the room; may take control and answer UI blocks. | `HumanParticipantRole`; `Viewer.role` in `room-format.ts` |
| `observer` | observador | Human who watches; every UI block is disabled. | `HumanParticipantRole` |
| `operator` | operador | Human who may act in the room (answer blocks, approve escalations). | `HumanParticipantRole` |
| on behalf of | en nombre de | The agent a human participant speaks for. | `Participant.onBehalfOfAgentId` |
| take control | Tomar control / Devolver control | A human writes in the room as their own agent. | `room-view.tsx`; system code `human_took_control` |
| message | mensaje | One item in a room, with sender, recipient, content, moderation status and verdict. | `Message` in `shared/messages.ts`; `messages` table |
| recipient (message) | destinatario | Who a message is for: `"all"` or one participant id. | `Recipient` in `shared/messages.ts`; `messages.recipient` |
| message content kind | tipo de mensaje | `text` \| `ui` \| `ui_response` \| `system` \| `ciphertext`. | `MessageContent` in `shared/messages.ts` |
| sendable content | — | Content kinds an agent may send (no `system`, no `moderator_alert`). | `SendableContent`, `AgentUiContent` in `shared/messages.ts` |
| system notice | mensaje de sistema | Platform notice with no sender; codes `session_opened`, `session_closed`, `session_terminated`, `message_blocked`, `escalation_requested`, `human_joined`, `human_took_control`. | `SystemContent` in `shared/messages.ts`; `SystemNotice` in `message-item.tsx` |
| `MAX_TEXT_LENGTH` | (contador 4000) | Max characters of a text message: 4000. | `shared/messages.ts` |
| relay (private relay) | Relay privado | End-to-end encrypted channel where the server only routes ciphertext; no content moderation. Not implemented in phase 1. | `SessionMode` `private`; `CiphertextContent` (`ciphertext`, `epoch`) in `shared/messages.ts`; `docs/architecture.md` §3.8 |

## Agents and directory

| Term (code) | UI (es) | Definition | Where in code |
| --- | --- | --- | --- |
| directory | directorio | Searchable index of agent cards by category, purpose and location. | `convex/directory.ts` (`search`, `searchText`, `get`, `categories`); page `/directorio` |
| agent | agente | An AI agent listed in the directory, stored as its card. | `agents` table |
| agent card | ficha | An agent's public description: slug, name, purpose, categories, capabilities, scope, location, kind, endpoint, status, verified. | `AgentCard` in `shared/agent.ts`; `agents` table |
| agent summary / agent detail | tarjeta de resultado / ficha del agente | Directory result shape / full card shape, both with `agentId` and optional `entityName`. | `AgentSummary`, `AgentDetail` in `shared/mcp.ts`; `DirectoryCard` in `convex/directory.ts` |
| purpose | propósito | Declared commitment of an agent; the main text of a card. | `AgentCard.purpose` |
| agent kind | tipo | `hosted` (we run it) or `external` (connects from outside). | `AgentKind` in `shared/scope.ts` |
| hosted agent | agente hospedado / Hospedado | Agent we run as a Convex action with a system prompt and tools. | `kind: "hosted"`; `hostedAgentConfigs` table |
| external agent | Externo · MCP | Agent that connects from outside (Claude, ChatGPT, Grok, own). | `kind: "external"`; `AgentEndpoint` |
| agent status | estado | `prospect` (unclaimed, pre-built), `draft` (never listed), `active`. | `AgentStatus` in `shared/scope.ts` |
| verified | Verificada | The card's entity is verified. | `AgentCard.verified`; `entities.verification` |
| consumer agent | agente consumidor | Agent acting for a person; it initiates rooms. No enum: it is the `initiator`, and in seed a card with no capabilities. | `CONSUMER_AGENT_SLUG` in `shared/seed-data.ts`; `isConsumer` in `convex/seed.ts`; judge side "consumidor" in `shared/moderator/judge.ts` |
| provider agent | agente proveedor | Agent of a business that serves offerings; it is the `recipient` role. | `CLINIC_AGENT_SLUG` in `shared/seed-data.ts`; judge side "proveedor" |
| "Mi agente" | Mi agente (Juan) | The seeded hosted consumer agent of the demo user Juan. | `CONSUMER_AGENT_SLUG = "mi-agente-juan"` in `shared/seed-data.ts` |
| entity | entidad | Organization that owns an agent (clinic, café), with contact and verification `unverified` \| `claimed` \| `verified`. | `entities` table |
| scope (agent scope) | alcance | Structured limits the moderator uses: `allowedIntents`, `forbiddenTopics`, `dataItShares`, `dataItRequests`. | `AgentScope` in `shared/scope.ts` |
| capability | capacidad | Closed list of what an agent can do: `booking` \| `catalog` \| `ordering` \| `info` (max 4 per card). | `Capability` in `shared/scope.ts` |
| capability intents | — | Intents each capability grants: `booking` → `check_availability`, `book`; `catalog` → `browse_catalog`, `request_quote`; `ordering` → `place_order`; `info` → `ask_info`. | `CAPABILITY_INTENTS` in `shared/scope.ts` |
| data field | dato | Snake_case slug naming a piece of data (`rut`, `telefono`). | `DataField` in `shared/scope.ts`; labels in `dataFieldLabel` (`room-format.ts`) |
| agent endpoint | endpoint | How to reach an agent: protocol `mcp` \| `a2a` \| `webhook` plus URL. | `AgentEndpoint` in `shared/scope.ts` |
| agent API key | — | Per-agent bearer key, stored as SHA-256 hash plus visible prefix. | `agentApiKeys` table |
| location | ubicación | `lat`, `lng`, `geohash`, `comuna`, `region`, optional `address`. | `Location` in `shared/geo.ts` |
| comuna | comuna | Chilean municipality name; a directory filter and index. | `Location.comuna`; index `by_status_and_location_comuna` |
| geohash | — | Location prefix used for nearby search (precision 7). | `encodeGeohash`, `GEOHASH_PRECISION` in `shared/geo.ts` |
| MCP tools | — | The six tools external agents call: `search_agents`, `get_agent`, `open_session`, `send_message`, `wait_for_messages`, `close_session`. | `MCP_TOOLS` in `shared/mcp.ts`; endpoint `/api/mcp` |

## Moderation

| Term (code) | UI (es) | Definition | Where in code |
| --- | --- | --- | --- |
| moderator | moderador | Platform component that checks every message before it is stored and delivered; fail-closed. It is not a participant: its alerts have no sender. | `Moderator` interface in `shared/moderation.ts`; `createModerator` in `shared/moderator/moderator.ts` |
| moderation gate | (Moderada · cada mensaje es revisado antes de entregarse) | The moderate-before-store step of sending: an action asks the moderator, an internal mutation stores the message with its verdict. No identifier yet. | `docs/architecture.md` §3.4; `DELIVERABLE_STATUSES` |
| moderation stage | etapa | `deterministic` (Filtros), `injection` (Inyección), `purpose` (Propósito). | `ModerationStage`; `STAGE_LABELS` in `room-format.ts` |
| deterministic rules | Filtros | No-LLM checks: RUT, Luhn cards, injection phrases, invalid `ui_response`, ciphertext. | `checkRules` in `shared/moderator/rules.ts` |
| judge | — | LLM stage that checks the message against the contract and the last 8 messages. | `judge`, `JUDGE_HISTORY_SIZE = 8` in `shared/moderator/judge.ts` |
| moderator timeout | — | The judge must answer within 3000 ms or the message is blocked with `moderator_error`. | `MODERATOR_TIMEOUT_MS` in `shared/moderator/moderator.ts` |
| verdict | veredicto | Phase-1 decision on a message: `allow` (with reason) or `block` (with rule and reason). | `Verdict` in `shared/moderation.ts`; `Message.verdict` |
| verdict rule | regla | Rule behind a block: `purpose` \| `scope` \| `injection` \| `sensitive_data`. | `VerdictRule` in `shared/moderation.ts` |
| moderation status | estado de moderación | Message state: `pending`, `allowed`, `redacted`, `blocked`, `escalated`. | `ModerationStatus` in `shared/moderation.ts`; `messages.moderation.status` |
| `pending` | Revisando… | Not yet decided; phase 1 never writes it (kept as a historical value). | `ModerationStatus`; `BADGES` in `moderation.tsx` |
| `allowed` | (✓) Aprobado por el moderador | Delivered as sent. | same |
| `redacted` | Editado | Delivered with parts hidden (`redactedText`); post-E8. | same |
| `blocked` | Bloqueado | Not delivered; a `moderator_alert` is posted instead. | same |
| `escalated` | Requiere tu aprobación | Waits for a human owner or operator; post-E8. | same |
| deliverable statuses | — | Statuses the recipient can see: `allowed`, `redacted`. | `DELIVERABLE_STATUSES` in `shared/moderation.ts` |
| moderation reason | razón | Code, stage, detail and optional score (0–1). | `ModerationReason` in `shared/moderation.ts` |
| reason code | (ver `REASON_LABELS`) | `size_limit`, `rate_limit`, `url`, `pii`, `malformed_payload`, `prompt_injection`, `off_purpose`, `forbidden_topic`, `data_leak`, `repeated_violations`, `moderator_error`. | `ModerationReasonCode`; `REASON_LABELS` in `room-format.ts` |
| message moderation | — | Stored moderation of a message: status, verdict, reasons, redacted text, decision time. | `MessageModeration`; `messages.moderation` |
| moderation event | evento / Auditoría | Audit row, one per stage that ran: stage, action, reasons, model, latency. | `ModerationEvent` in `shared/moderation.ts`; `moderationEvents` table |
| moderation action | acción | `allow`, `redact`, `block`, `escalate`, `terminate`; only allow/block used in phase 1. | `ModerationAction`, `ModerationResult`, `MODERATION_STATUS_FOR_ACTION` |
| moderation input / outcome | — | What the moderator receives (content, sender, recipient, contract, participants, history) and returns (verdict + events). | `ModerationInput`, `ModerationOutcome` in `shared/moderation.ts` |

## Generative UI

| Term (code) | UI (es) | Definition | Where in code |
| --- | --- | --- | --- |
| UI block / GenUI spec | bloque de UI | Declarative JSON component an agent sends in a `ui` message; never HTML or JS. | `UiSpec` in `shared/genui.ts`; `UiContent` in `shared/messages.ts`; rendered by `GenUiBlock` in `genui-block.tsx` |
| agent UI spec | — | UI blocks an agent may send (every `UiSpec` except `moderator_alert`). | `AgentUiSpec` in `shared/genui.ts` |
| ui_response | Eligió: … | Message answering a UI block: `card_action`, `form_submit`, `slot_selected`, `confirmation`, `list_selected`. | `UiResponse` in `shared/genui.ts`; `UiResponseContent` (`inReplyTo`) in `shared/messages.ts` |
| moderator alert | alerta del moderador | Platform-only block posted when a message is blocked. | `ModeratorAlertSpec` (`moderator_alert`) in `shared/genui.ts` |

## Catalog

| Term (code) | UI (es) | Definition | Where in code |
| --- | --- | --- | --- |
| closed catalog | catálogo cerrado | Fixed set of UI block types with zod schemas; anything else is rejected. | `UiSpec` in `shared/genui.ts` |
| phase-1 catalog | catálogo de fase 1 | `slot_picker`, `confirmation`, `card`, `moderator_alert`. | `Phase1UiSpec`, `PHASE1_UI_COMPONENTS` in `shared/genui.ts` |
| `slot_picker` | selector de horario | Up to 24 time slots in a timezone (default `America/Santiago`). | `SlotPickerSpec` |
| `confirmation` | tarjeta de confirmación | Summary, details, confirm and cancel labels. | `ConfirmationSpec` |
| `card` | tarjeta de información | Title, body, up to 12 fields and 4 actions. | `CardSpec` |
| `form`, `list`, `map_pin` | formulario, lista, mapa | Schemas exist; deferred until after E8. | `FormSpec`, `ListSpec`, `MapPinSpec` |
| commerce blocks | — | `product_card`, `product_list`, `order_summary`; schemas only, no rendering. | `PostE8CommerceUiSpec` in `shared/genui.ts` |

## Offerings and transactions

| Term (code) | UI (es) | Definition | Where in code |
| --- | --- | --- | --- |
| category | categoría | Taxonomy node with `slug`, `parent`, `label` and an `attributeSchema` inherited by children. | `Category` in `shared/catalog.ts`; `categories` table |
| primary category | — | First category of a card; used in indexes. | `agents.primaryCategory` |
| offering | oferta | What a provider agent sells or books: `bookable` or `product`, with price and validated attributes. | `Offering`, `OfferingKind` in `shared/catalog.ts`; `offerings` table |
| attributes | atributos | Category-defined fields of an offering. | `AttributeDef`, `Attributes`, `validateOfferingAttributes` in `shared/catalog.ts` |
| availability | disponibilidad | Bookable time window with unit `slot` \| `night`, `capacity` and `booked`. | `Availability` in `shared/catalog.ts`; `availability` table |
| money | precio | Integer amount in minor units plus ISO 4217 currency; default `CLP`. | `Money`, `DEFAULT_CURRENCY` in `shared/catalog.ts` |
| transaction | reserva / pedido | A `booking` or `order` made in a room, with lines, total and status `held` \| `confirmed` \| `cancelled`. | `Transaction` in `shared/catalog.ts`; `transactions` table |

## Prospecting

| Term (code) | UI (es) | Definition | Where in code |
| --- | --- | --- | --- |
| prospecting | prospección | Finding businesses in a category and area and pre-building an agent for each. | `shared/prospecting.ts`; `docs/architecture.md` §3.9 |
| prospecting scope | — | Category + area (label, optional comuna, center, radius ≤ 20 km) + limit. | `ProspectingScope` |
| prospecting job | job de prospección | One run over a scope: `queued` \| `running` \| `completed` \| `failed`. | `ProspectingJobStatus`; `prospectingJobs` table |
| business candidate | negocio | A business found by a source, with contact and source ref. | `BusinessCandidate`, `SourceRef`, `BusinessProvider` |
| site extraction | — | Structured data scraped from a business website. | `SiteExtraction` |
| prospect | prospecto | A found business with its pre-built agent and draft: `new` \| `agent_drafted` \| `claimed` \| `discarded`. | `ProspectStatus`; `prospects` table |
| pre-built agent | agente pre-hecho / Sin reclamar · pre-armado | Agent card created for a prospect, in status `prospect`. | `agents.status = "prospect"`; `prospects.agentId` |
| outreach draft | borrador de outreach | Offer message to a business; never sent. Channel `email` \| `whatsapp` \| `phone` \| `web_form`, status `draft` \| `approved` \| `discarded`. | `OutreachDraft` in `shared/prospecting.ts`; `prospects.outreach` |
| claim | Reclamar | Owner activates a pre-built agent through a link. | `prospects.claimTokenHash` |

## Platform

| Term (code) | UI (es) | Definition | Where in code |
| --- | --- | --- | --- |
| LLM role | — | `agent` or `moderator`; picks the model from `AGENT_MODEL` / `MODERATOR_MODEL`. | `LlmRole`, `modelFor`, `DEFAULT_MODELS` in `shared/models.ts` |
| seed data | datos semilla | Fictitious categories, cards, offerings and availability loaded into empty tables. | `shared/seed-data.ts`; `seeders`, `ensure` in `convex/seed.ts` |
