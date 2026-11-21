# Capy

Capy reads repo-root `.agents/skills/<name>/SKILL.md` and `.claude/skills/<name>/SKILL.md`, preferring `.agents/skills`. Keep `name` and `description` in frontmatter and start a new thread on the updated branch after publishing skills. Symlink discovery and automatic loading of repo `AGENTS.md` or `CLAUDE.md` are **UNCONFIRMED**. Check the thread's loaded skills and instructions. Use the committed `.agents/skills` files and read repo instructions explicitly if needed. [Capy skills](https://docs.capy.ai/skills.md), [Captain instructions](https://docs.capy.ai/captains.md)

## Delegate and wait

Ask Capy's agent to draft and start children with explicitly named models. Send a self-contained brief and choose `shared` for read-only work or `fresh` for writers that can start from the upstream checkout. Capy delivers completed summaries to the parent and surfaces blocked questions as notifications. A Captain can start crew threads with distinct models in its project. [Subagents](https://docs.capy.ai/subagents.md), [Captains](https://docs.capy.ai/captains.md)

The public API uses `GET /models` and `POST /threads` or `POST /captains` with `model: {modelId, reasoningMode}`. For example, `{ "modelId": "openai/gpt-6.2-sol", "reasoningMode": "high" }`. Catalog IDs include `anthropic/claude-opus-5-5`, `openai/gpt-6.2-sol`, and `google/gemini-4-neon`. Resolve IDs from the catalog and session access. A rejected explicit model selection needs a fresh choice. Public subagent endpoints list/read children. Use a Capy agent to start a child. [API schema](https://docs.capy.ai/openapi.json), [Model catalog](https://docs.capy.ai/models-and-pricing.md)

In-thread program runner `execute` with `input.code`, the availability of its `tools` object in plain threads, and exact host schemas are **UNCONFIRMED**. Check the live tool list before using these shapes from gstack:

```js
tools.subagent.create({ tasks: [{ title, prompt }], start: { machine: "shared", model } })
tools.subagent.start({ indices: [index], machine: "shared", model })
tools.subagent.list({})
tools.subagent.get({ path, transcript: "none" })
tools.subagent.stop({ paths: [path] })
```

gstack uses `model: {model_id, reasoning_mode}` here. The live shape is **UNCONFIRMED** and the public API uses camelCase. If unavailable, ask Capy to start a child on the named model or use a Captain's crew thread. Generic in-thread thread creation is **UNCONFIRMED**. Check for a thread creation tool and otherwise use the Captain's crew UI or the public API where authorized. The `wait` shape is **UNCONFIRMED**. gstack mentions `duration_seconds`, operation IDs, and `return_when: "all"`. Check the live schema or rely on the parent notification. Other transcript names such as `subagent_create`, `subagent_list`, `subagent_get`, `thread_get`, and `message_agent` come from parser fixtures. Use them only if exposed. [gstack Capy reviewer](https://github.com/garrytan/gstack/blob/a529769efd989ac5e83e4ee09f1ac7b199e686d3/lib/capy-review-pass.js), [gstack transcript parser](https://github.com/garrytan/gstack/blob/a529769efd989ac5e83e4ee09f1ac7b199e686d3/lib/runaway.ts)

## Ask, track, and attach

- **Questions.** Crew threads send a Needs you report to the Captain. A direct question tool name is **UNCONFIRMED**. Check for a user question tool (`message_user` appears in a gstack parser) or ask in the final reply. [Capy threads](https://docs.capy.ai/threads.md)
- **PRs.** Prefer `tools.pr.create` if exposed. Use its live schema with the branch and PR body. The thread that last pushed owns the PR and receives events. For an external PR, request a watch on the existing PR. gstack uses `tools.capy.subscribe` with a pull source. The argument shape is **UNCONFIRMED**. If there is no subscription tool, use the [vendored waiter](../../babysit-pr/scripts/pr-wait). Capy callbacks are scoped to repositories in the Capy project. [Capy PRs](https://docs.capy.ai/pull-requests.md), [gstack host guidance](https://github.com/garrytan/gstack/blob/a529769efd989ac5e83e4ee09f1ac7b199e686d3/crew/docs/recommended-harness.md)
- **PR evidence.** gstack calls `tools.pr.uploadAsset` only on public repositories. Check for the tool and its live argument shape (**UNCONFIRMED**). If unavailable or private, follow [git conventions](../../git-conventions/SKILL.md). In-thread file attachment tooling is separately **UNCONFIRMED**. Check the live list or use the public thread API where authorized. `POST /files` with `{files: [{name, mediaType, sizeBytes}]}`, PUT the bytes to the returned URL with the declared type and length, then `POST /threads/{id}/message` with `files: [{fileId, name}]`. [Capy API schema](https://docs.capy.ai/openapi.json)
- **Issues.** gstack uses `tools.issue.read({ assignee, status })` and `tools.issue.update`. When Issues are on for the thread, `tools.issue.create` creates one issue in the thread's project, with `blocks`, `blocked_by` and `related` for dependency links, and `tools.issue.comment` comments on one. Inspect the live schemas with `describe`. If the tools are absent, ask the Captain or list the tickets for the human. Capy's public API has `POST /issues` and `PATCH /issues/{code}` (for example `CAP-12`). GitHub Issues sync is **UNCONFIRMED**. Use an explicit tracker mirror instead of assuming sync. [Capy API schema](https://docs.capy.ai/openapi.json), [Capy Linear integration](https://docs.capy.ai/integrations/linear.md)
