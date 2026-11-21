# Issue tracker

Issues and specs for this repo live as committed Markdown in `.scratch/`. Mirror each implementation ticket to the first available tracker below. The local ticket and its status are canonical.

## Conventions

- One feature per directory at `.scratch/<feature-slug>/`.
- Store the spec at `.scratch/<feature-slug>/spec.md`.
- Use one file per implementation ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order.
- Record triage state near the top as `Status:` (for example `ready-for-agent`, `open`, `in-progress`, or `done`). Once mirrored, add `Tracker: <url or issue code>` near it.
- Append conversation history and comments under `## Comments` at the bottom.

## When a skill says "publish to the issue tracker"

Create the local file first, then mirror the title, description, acceptance criteria, blockers, and status. Use native dependency links where offered. Update the issue at `Tracker:` on status changes so teammates can follow the canonical local state.

1. **Capy Issues.** When the thread has Issues turned on, `tools.issue.create` creates one issue in the thread's project (one call per ticket). Map the ticket's blockers to its `blocks` and `blocked_by` fields, then record the returned code (for example `CAP-12`) as `Tracker:`. Keep it current with `tools.issue.update` and `tools.issue.comment`. Check the live schema with `describe("issue.create")`. If the tools are absent, ask the Captain to create the mirror or list the tickets for the human. See [Capy issue tools](../../.agents/skills/harness-map/references/capy.md#ask-track-and-attach).
2. **T3 Code.** If `create_issue` appears in the active tools, use its schema and record the returned URL.
3. **GitHub Issues.** With a GitHub remote and authenticated `gh`, use `gh issue create --label ready-for-agent`. Check for the `ready-for-agent` label first and create it with `gh label create ready-for-agent` if missing. Use `gh issue edit` or the corresponding state operation to synchronize changes.
4. **Linear or Jira.** Use an available connector and record the resulting issue URL.

If there is no usable tracker, keep the local ticket and report the pending mirror. Use an existing `Tracker:` URL for updates and retries so the work stays on one remote issue.

## When a skill says "fetch the relevant ticket"

Read the referenced local ticket. When given a tracker issue number or URL, find the local ticket by its `Tracker:` entry and use the mirror for remote comments.
