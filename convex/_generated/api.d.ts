/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentBuilder from "../agentBuilder.js";
import type * as agentBuilderExtraction from "../agentBuilderExtraction.js";
import type * as agentKeys from "../agentKeys.js";
import type * as agentRegistration from "../agentRegistration.js";
import type * as bookings from "../bookings.js";
import type * as demo from "../demo.js";
import type * as directory from "../directory.js";
import type * as friends from "../friends.js";
import type * as gate from "../gate.js";
import type * as jobs from "../jobs.js";
import type * as mcpAccount from "../mcpAccount.js";
import type * as mcpOauth from "../mcpOauth.js";
import type * as mcpRooms from "../mcpRooms.js";
import type * as migrations from "../migrations.js";
import type * as moderator from "../moderator.js";
import type * as myFunctions from "../myFunctions.js";
import type * as providerAgent from "../providerAgent.js";
import type * as referenceAgents from "../referenceAgents.js";
import type * as referenceLlm from "../referenceLlm.js";
import type * as referenceScene from "../referenceScene.js";
import type * as roomAgent from "../roomAgent.js";
import type * as roomInvitations from "../roomInvitations.js";
import type * as roomMessages from "../roomMessages.js";
import type * as roomState from "../roomState.js";
import type * as rooms from "../rooms.js";
import type * as seed from "../seed.js";
import type * as visibility from "../visibility.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentBuilder: typeof agentBuilder;
  agentBuilderExtraction: typeof agentBuilderExtraction;
  agentKeys: typeof agentKeys;
  agentRegistration: typeof agentRegistration;
  bookings: typeof bookings;
  demo: typeof demo;
  directory: typeof directory;
  friends: typeof friends;
  gate: typeof gate;
  jobs: typeof jobs;
  mcpAccount: typeof mcpAccount;
  mcpOauth: typeof mcpOauth;
  mcpRooms: typeof mcpRooms;
  migrations: typeof migrations;
  moderator: typeof moderator;
  myFunctions: typeof myFunctions;
  providerAgent: typeof providerAgent;
  referenceAgents: typeof referenceAgents;
  referenceLlm: typeof referenceLlm;
  referenceScene: typeof referenceScene;
  roomAgent: typeof roomAgent;
  roomInvitations: typeof roomInvitations;
  roomMessages: typeof roomMessages;
  roomState: typeof roomState;
  rooms: typeof rooms;
  seed: typeof seed;
  visibility: typeof visibility;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  backgroundWork: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"backgroundWork">;
};
