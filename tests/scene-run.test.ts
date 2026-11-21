import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const runner = fileURLToPath(
  new URL("../scripts/scene-run.mjs", import.meta.url),
);

it.each([
  ["missing configuration", "", "", {}],
  ["cloud deployment", "CONVEX_DEPLOYMENT=dev:example\n", "", {}],
  [
    "shell deploy key",
    "CONVEX_DEPLOYMENT=anonymous:anonymous-demo\n",
    "",
    {
      CONVEX_DEPLOY_KEY: "synthetic-test-value",
    },
  ],
  [
    "shell deployment override",
    "CONVEX_DEPLOYMENT=anonymous:anonymous-demo\n",
    "",
    {
      CONVEX_DEPLOYMENT: "dev:example",
    },
  ],
  [
    "dotenv deployment token",
    "CONVEX_DEPLOYMENT=anonymous:anonymous-demo\n",
    "CONVEX_DEPLOYMENT_TOKEN=synthetic-test-value\n",
    {},
  ],
  [
    "colon-form dotenv deploy key",
    "CONVEX_DEPLOYMENT=anonymous:anonymous-demo\n",
    "CONVEX_DEPLOY_KEY: synthetic-test-value\n",
    {},
  ],
  [
    "remote alias revealed by an empty shell override",
    "CONVEX_DEPLOYMENT=anonymous:anonymous-demo\nCONVEX_DEPLOY_KEY=<ignore_deploy_key>\nCONVEX_DEPLOYMENT_TOKEN=synthetic-test-value\n",
    "",
    { CONVEX_DEPLOY_KEY: "" },
  ],
  [
    "self-hosted selector",
    "CONVEX_DEPLOYMENT=anonymous:anonymous-demo\n",
    "CONVEX_SELF_HOSTED_URL=https://example.invalid\n",
    {},
  ],
] as const)("refuses %s before running Convex", (_, local, dotenv, env) => {
  const cwd = mkdtempSync(join(tmpdir(), "scene-run-test-"));
  try {
    writeFileSync(join(cwd, ".env.local"), local);
    writeFileSync(join(cwd, ".env"), dotenv);
    writeFileSync(
      join(cwd, "pnpm"),
      "#!/bin/sh\n: > convex-called\necho null\n",
      {
        mode: 0o700,
      },
    );
    const result = spawnSync(process.execPath, [runner], {
      cwd,
      env: { NODE_ENV: "test", PATH: cwd, ...env },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.stderr).toContain("anonymous local Convex deployment");
    expect(existsSync(join(cwd, "convex-called"))).toBe(false);
    expect(result.status).toBe(1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

it.each([
  ["a colon-form production selector", {}],
  [
    "a higher-priority production selector than the shell alias",
    {
      CONVEX_DEPLOYMENT_TOKEN: "dev:example|synthetic",
    },
  ],
] as const)("refuses to start dev with %s", (_, env) => {
  const root = mkdtempSync(join(tmpdir(), "scene-dev-test-"));
  try {
    const modules = join(root, "node_modules");
    const bin = join(modules, ".bin");
    mkdirSync(bin, { recursive: true });
    symlinkSync(
      fileURLToPath(new URL("../node_modules/dotenv", import.meta.url)),
      join(modules, "dotenv"),
      "dir",
    );
    mkdirSync(join(root, "scripts"));
    const entry = join(root, "scripts/dev.mjs");
    copyFileSync(new URL("../scripts/dev.mjs", import.meta.url), entry);
    writeFileSync(
      join(root, ".env"),
      "CONVEX_DEPLOY_KEY: prod:example|synthetic\n",
    );
    writeFileSync(join(bin, "convex"), "#!/bin/sh\n: > convex-called\n", {
      mode: 0o700,
    });

    const result = spawnSync(process.execPath, [entry], {
      cwd: root,
      env: { NODE_ENV: "test", PATH: bin, ...env },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(existsSync(join(root, "convex-called"))).toBe(false);
    expect(result.stderr).toContain("refusing to start");
    expect(result.status).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  {},
  { CONVEX_DEPLOY_KEY: "<ignore_deploy_key>" },
  { CONVEX_DEPLOYMENT_TOKEN: "<ignore_deploy_key>" },
  {
    CONVEX_DEPLOY_KEY: "<ignore_deploy_key>",
    CONVEX_DEPLOYMENT_TOKEN: "synthetic-test-value",
  },
])("passes only the pinned anonymous selector to Convex with %j", (env) => {
  const cwd = mkdtempSync(join(tmpdir(), "scene-run-test-"));
  try {
    const deployment = "CONVEX_DEPLOYMENT=anonymous:anonymous-demo";
    writeFileSync(join(cwd, ".env.local"), `${deployment}\nOTHER=value\n`);
    writeFileSync(
      join(cwd, "pnpm"),
      `#!/bin/sh
[ "$4" = "--env-file" ] || exit 2
IFS= read -r selector < "$5"
[ "$selector" = "${deployment}" ] || exit 3
[ "$(wc -l < "$5")" -eq 1 ] || exit 4
echo null
`,
      { mode: 0o700 },
    );
    const result = spawnSync(process.execPath, [runner], {
      cwd,
      env: { NODE_ENV: "test", PATH: `${cwd}:/usr/bin:/bin`, ...env },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: "the consumer found no provider",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
