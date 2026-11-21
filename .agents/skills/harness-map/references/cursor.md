# Cursor

Cursor reads `.agents/skills/` and `.cursor/skills/`, with compatibility paths `.claude/skills/` and `.codex/skills/`. Symlink discovery is **UNCONFIRMED**. Check the loaded skills and use the real `.agents/skills/` folders if needed. Project rules live under `.cursor/rules/`. pstack's user rule is `~/.cursor/rules/pstack-models.mdc`. [Skills](https://cursor.com/docs/context/skills), [Rules](https://cursor.com/docs/rules)

- **Models and workers.** Build the `Task` invocation from the live schema using a self-contained prompt. Cursor documents parent-chosen models, but the per-call model field name is **UNCONFIRMED**. Check `Task` before passing it. Otherwise use a custom subagent at `.cursor/agents/<name>.md` with `name`, `description`, and `model: <available-model-id>` in frontmatter, then ask Cursor to run it. Select model options according to the installed version's model configuration. Leave the default inheritance only if it fits the role.
- **Results and questions.** Collect the foreground result or background notification. Look for `AskQuestion` and use its live schema. If absent, ask in the final reply.
- **PRs and issues.** Use the exposed forge tool or `gh`. Use the [vendored waiter](../../babysit-pr/scripts/pr-wait) when there is no tracked watch.

[Cursor subagents](https://cursor.com/docs/subagents)
