/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as directory from "../directory.js";
import type * as gate from "../gate.js";
import type * as jobs from "../jobs.js";
import type * as migrations from "../migrations.js";
import type * as moderator from "../moderator.js";
import type * as myFunctions from "../myFunctions.js";
import type * as roomAgent from "../roomAgent.js";
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
  directory: typeof directory;
  gate: typeof gate;
  jobs: typeof jobs;
  migrations: typeof migrations;
  moderator: typeof moderator;
  myFunctions: typeof myFunctions;
  roomAgent: typeof roomAgent;
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
