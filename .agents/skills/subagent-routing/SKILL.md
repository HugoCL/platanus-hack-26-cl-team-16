---
name: subagent-routing
description: Choose models and reasoning effort for subagents launched by council, sol-loop, poteto-mode, dispatching-parallel-agents, gstack, or other delegation workflows.
---

# Subagent routing

These are the team's defaults. Follow explicit task model requirements, including a distinct-provider council or a Sol-only loop. Check [harness map](../harness-map/SKILL.md) for the available mechanism and use the newest listed version ID of the chosen model family unless a version is specified.

## Team defaults (edit this table to change them)

| Role | Model | Effort |
| --- | --- | --- |
| Implementation | latest Claude Opus | high |
| Simple, low-risk work (mechanical edits, lookups, running commands) | latest Claude Sonnet, or latest GPT Sol | high |
| Review: adversarial seat | same model as the parent thread | high |
| Review: second and third seats | GPT Sol and latest Claude Opus | high |

A user's request in the thread overrides this table for that task (for example "use medium effort" or "implement with Sonnet"). Change the table itself when the team wants a new default, and keep the rest of this skill in sync.

## Review

Always give the diff and original goal to a read-only adversarial reviewer running the same model as the parent. Add GPT Sol and Claude Opus. If the parent is Sol or Opus, it fills its own seat and the other model fills the second. If only one of Sol or Opus is available, use that one and keep the parent-model seat when distinct. Keep reviewers independent. Give each the diff, goal, and relevant verification results. Exclude the author's conclusion. Ask each to return findings with `file:line` references and a score out of 10.

Brief every reviewer to cover two lenses and to label each finding with one:

- **Correctness:** bugs, regressions, security, broken commands or docs, missing proof for a behavior change.
- **Maintainability:** apply `$thermo-nuclear-code-quality-review` (load it by name; it sets `disable-model-invocation`). Look for the "code judo" restructuring that deletes complexity, files pushed past 1k lines, ad-hoc conditionals in unrelated flows, thin wrappers, loose types, and logic in the wrong layer.

Scope the maintainability lens to the PR's own diff, and keep its suggestions inside the ticket: a restructuring that needs a separate change becomes a follow-up ticket, not a blocker.

## Fallback order

- **Opus:** latest Claude Opus → latest Claude Fable → latest Claude Sonnet.
- **Sol:** latest GPT Sol → newest available older Sol → Gemini 4 Neon.
- **Sonnet:** latest Claude Sonnet → latest GPT Sol → latest Claude Haiku.

For default review, keep the available Sol/Opus seat when the other family is unavailable. Apply the family fallbacks in workflows that allow substitutions, and skip duplicates. If the exact parent model cannot be selected, use inheritance only if it resolves to that model. Report substitutions, missing seats, and effort levels the harness cannot set. Respect explicit provider requirements instead of silently substituting.

## Set the model and effort

| Harness | Selection |
| --- | --- |
| Claude Code | `Agent` with an alias such as `model: "opus"` and `effort: "high"` where exposed |
| Codex | `spawn_agent` with `model` and `reasoning_effort` |
| Cursor | Custom subagent frontmatter `model` with an available ID and model options supported by that version. See [Cursor](../harness-map/references/cursor.md) for the **UNCONFIRMED** per-invocation field |
| T3 Code | Choose values from `orchestrator_capabilities`, then pass `target.model` and supported `target.options` to `delegate_task` |
| Capy | Request a model per subagent. The live in-thread model shape is **UNCONFIRMED**. See [Capy](../harness-map/references/capy.md) for the API and crew-thread route |
| Gemini CLI / Antigravity | Use the supported subagent model or tier in [Gemini and Antigravity](../harness-map/references/gemini.md) |

`$setup-pstack` writes user-scoped rules outside the repo. This skill is the repository source of truth for team model choices. Resolve its role and effort first, then translate to the harness using [harness map](../harness-map/SKILL.md).
