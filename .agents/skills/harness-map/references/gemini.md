# Gemini CLI and Antigravity

## Gemini CLI

- **Skills and rules.** Gemini CLI discovers `.gemini/skills/` and `.agents/skills/`, with `.agents/skills/` winning within the same tier. Workspace instructions default to `GEMINI.md`. [Skills](https://geminicli.com/docs/cli/skills/), [Context files](https://geminicli.com/docs/cli/gemini-md/)
- **Models and workers.** Consult `/model`. Define a local named subagent at `.gemini/agents/<name>.md` with `name`, `description`, `kind: local`, and the available `model` in frontmatter. Call the tool named after the agent with a task brief using its exposed schema. It returns its findings to the caller. [Subagents](https://geminicli.com/docs/core/subagents/), [Commands](https://geminicli.com/docs/reference/commands/)
- **Questions.** If present, use `ask_user({ questions: [{ header, question, type: "text" }] })`. Otherwise ask in the final reply. [Ask User](https://geminicli.com/docs/tools/ask-user/)

## Antigravity

- **Skills and rules.** Use `.agents/skills/`. Workspace rules can live in `AGENTS.md`, `GEMINI.md`, or `.agents/rules/`. [Skills](https://antigravity.google/docs/skills), [Rules](https://antigravity.google/docs/rules/)
- **Models and workers.** Use the app's model picker or CLI `/model` to inspect available models. A custom agent can live at `.agents/agents/<name>.md` with `name`, `description`, and `subagent: true`. Check the documented model tier and the live `invoke_subagent` schema. Use explicitly selectable models only where supported. Collect results through the agent's completion or check the CLI's `/agents` panel for status. Use an exposed question tool if available, otherwise ask in the final reply. [Custom subagents](https://antigravity.google/docs/subagents), [CLI features](https://antigravity.google/docs/cli-features)

For both, symlink discovery and reading `.claude/skills/` are **UNCONFIRMED**. Check the loaded skills and use the real `.agents/skills/` directories. Use the active forge tool or `gh` for PRs, attachments, and issues. Use the [vendored waiter](../../babysit-pr/scripts/pr-wait) for PR monitoring when there is no tracked watch.
