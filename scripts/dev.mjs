#!/usr/bin/env node
// `pnpm dev`: runs `convex dev --start 'next dev'`.
//
// Convex runs a local anonymous deployment (CONVEX_AGENT_MODE=anonymous, no login) unless the
// project was switched to real accounts. Convex 1.50 resolves these deployment selectors, from
// the environment and then from .env.local and .env, BEFORE it looks at CONVEX_AGENT_MODE:
//   CONVEX_DEPLOY_KEY, CONVEX_DEPLOYMENT_TOKEN (alias of the key), CONVEX_DEPLOYMENT,
//   CONVEX_SELF_HOSTED_URL, CONVEX_SELF_HOSTED_ADMIN_KEY
// Mode detection, first match wins:
//   1. CONVEX_DEPLOY_KEY or CONVEX_DEPLOYMENT_TOKEN is set in the environment
//                                                        -> plain `convex dev` (cloud)
//   2. .env.local or .env sets a selector other than an `anonymous:` CONVEX_DEPLOYMENT
//                                                        -> plain `convex dev` (cloud)
//   3. otherwise                                         -> CONVEX_AGENT_MODE=anonymous
// In anonymous mode every selector is removed from the children's environment, so a stray
// project-wide variable cannot send the machine to a login prompt or to someone else's
// deployment while this script says "anonymous". In cloud mode the deployment comes from the key
// or from .env.local, and CONVEX_AGENT_MODE is removed. Cloud mode refuses to start when the key
// or CONVEX_DEPLOYMENT targets production (`prod:` prefix, or a legacy key with no prefix),
// because this script pushes and seeds.
// Before starting, `convex dev --once --run seed:ensure` pushes and fills empty tables with
// sample data (see convex/seed.ts). It only touches tables that are empty, so it is also kept in
// cloud mode. Set DEV_SEED=0 to skip it. The seed step and the dev step share one environment, so
// they always target the same deployment.
// Extra arguments are forwarded to `convex dev` only. They can change the target (--url,
// --configure, --env-file), so when any are given the seed step is skipped.
// Stopping: convex cleans up `next dev` and the local backend only on SIGINT, so SIGINT, SIGTERM
// and SIGHUP all send SIGINT to the running child, at most once. With a TTY a Ctrl-C already
// reached the child from the terminal; if it is still alive 2 s later (a harness PTY may signal
// only this pid) we send that one SIGINT ourselves. The exit code is the child's. `pnpm dev:cloud` skips detection and
// does not force anonymous mode.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const KEY_VARS = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"];
const SELECTORS = [
  ...KEY_VARS,
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
];

// Selectors set in .env.local, then .env (the first file that sets one wins, like convex).
function envFileSelectors() {
  const found = {};
  for (const name of [".env.local", ".env"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const seen = {};
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?(CONVEX_[A-Z_]+)\s*=\s*(.*)$/.exec(line);
      if (!m || !SELECTORS.includes(m[1])) continue;
      // Convex writes `CONVEX_DEPLOYMENT=dev:name # team: ..., project: ...`
      seen[m[1]] = m[2]
        .replace(/\s+#.*$/, "")
        .trim()
        .replace(/^(["'])(.*)\1$/, "$2");
    }
    for (const [k, v] of Object.entries(seen)) {
      if (v && !(k in found)) found[k] = v;
    }
  }
  return found;
}

// Same as convex: the first non-empty key variable wins, and `<ignore_deploy_key>` is its
// sentinel for "no key".
function selectedKey(get) {
  for (const name of KEY_VARS) {
    const v = get(name);
    if (v) return v === "<ignore_deploy_key>" ? null : { name, value: v };
  }
  return null;
}

function detect() {
  const key = selectedKey((n) => process.env[n]);
  if (key) return { anonymous: false, why: `${key.name} is set`, key };
  const files = envFileSelectors();
  const fileKey = selectedKey((n) => files[n]);
  if (fileKey)
    return {
      anonymous: false,
      why: `${fileKey.name} is set in .env.local or .env`,
      key: fileKey,
    };
  const deployment = files.CONVEX_DEPLOYMENT;
  if (deployment && !deployment.startsWith("anonymous:")) {
    return {
      anonymous: false,
      why: "CONVEX_DEPLOYMENT in .env.local or .env is not anonymous",
      deployment,
    };
  }
  if (files.CONVEX_SELF_HOSTED_URL || files.CONVEX_SELF_HOSTED_ADMIN_KEY) {
    return {
      anonymous: false,
      why: "CONVEX_SELF_HOSTED_* is set in .env.local or .env",
    };
  }
  return { anonymous: true, why: "no real Convex deployment configured" };
}

// `prod:name|secret`, or a legacy key with no `type:` prefix, is a production key.
function targetsProd(mode) {
  if (mode.key) {
    const prefix = mode.key.value.split("|")[0];
    return !prefix.includes(":") || prefix.split(":")[0] === "prod";
  }
  return mode.deployment?.split(":")[0] === "prod";
}

const mode = detect();
const env = {
  ...process.env,
  PATH: [join(root, "node_modules", ".bin"), process.env.PATH]
    .filter(Boolean)
    .join(delimiter),
};
if (mode.anonymous) {
  // Anonymous mode: convex resolves every selector before CONVEX_AGENT_MODE, so none may reach it.
  for (const name of SELECTORS) delete env[name];
  env.CONVEX_AGENT_MODE = "anonymous";
} else {
  // The deployment comes from the key or from .env.local, so a shell CONVEX_DEPLOYMENT or
  // CONVEX_SELF_HOSTED_* (resolved first, and a conflict between them) must not reach convex.
  for (const name of SELECTORS) if (!KEY_VARS.includes(name)) delete env[name];
  delete env.CONVEX_AGENT_MODE;
  if (targetsProd(mode)) {
    console.error(
      `dev: refusing to start, ${mode.why} and it targets production. \`pnpm dev\` pushes functions and seeds data, so it only runs against a dev deployment. Use a dev key (\`dev:...\`) or unset it for a local anonymous deployment.`,
    );
    process.exit(1);
  }
}

console.log(
  mode.anonymous
    ? `dev: local anonymous Convex deployment, no login (${mode.why})`
    : `dev: Convex deployment from your account, anonymous mode off (${mode.why})`,
);

let child = null;
let stopping = false;
let stopSignal = "SIGINT";
let forwarded = false;
let watching = false;

const alive = () =>
  child !== null && child.exitCode === null && child.signalCode === null;

// The child gets at most one SIGINT from us (a second can make a CLI skip its cleanup).
function forwardSigint() {
  if (forwarded || !alive()) return;
  forwarded = true;
  child.kill("SIGINT");
}

// One handler for every stop signal. A terminal delivers Ctrl-C to the whole foreground group,
// so the child normally has that SIGINT already; if it is still alive 2 s later, send it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopping = true;
    stopSignal = signal;
    if (signal === "SIGINT" && process.stdin.isTTY) {
      if (!watching) setTimeout(forwardSigint, 2000);
      watching = true;
      return;
    }
    forwardSigint();
  });
}

// Runs `convex <args>` and resolves with { code, signal }.
function convex(args) {
  return new Promise((resolveRun) => {
    if (stopping) return resolveRun({ code: null, signal: stopSignal });
    child = spawn("convex", args, { cwd: root, env, stdio: "inherit" });
    child.on("error", (err) => {
      console.error(`dev: cannot start convex: ${err.message}`);
      resolveRun({ code: 1, signal: null });
    });
    child.on("exit", (code, signal) => resolveRun({ code, signal }));
  });
}

const exitCode = ({ code, signal }) =>
  code ?? 128 + (constants.signals[signal] ?? 0);

// `convex dev` runs either --run or --start after a push, not both, so the seed gets its own
// one-shot push first. A failure there is not fatal: the normal run below shows the same error
// and keeps watching.
const extraArgs = process.argv.slice(2);
if (process.env.DEV_SEED !== "0" && extraArgs.length > 0) {
  console.log("dev: extra arguments given, skipping the seed step");
} else if (process.env.DEV_SEED !== "0") {
  console.log("dev: seeding empty tables (seed:ensure)");
  const seed = await convex(["dev", "--once", "--run", "seed:ensure"]);
  if (stopping) process.exit(exitCode(seed));
  if (seed.code !== 0) {
    console.warn(
      "dev: the seed step failed, starting dev anyway (DEV_SEED=0 skips it)",
    );
  }
}

const run = await convex(["dev", "--start", "next dev", ...extraArgs]);
process.exit(exitCode(run));
