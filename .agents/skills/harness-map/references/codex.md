# Codex

Codex discovers `.agents/skills/` from the current directory up to the repository root and supports individual symlinked skill folders there. Discovery under `.claude/skills/` is **UNCONFIRMED**. Check the loaded skills and use `.agents/skills/`. Repo instructions are in `AGENTS.md`; model and agent settings can live in `config.toml` and custom agents in `.codex/agents/` or `~/.codex/agents/`. [Skills](https://developers.openai.com/codex/skills), [Subagents](https://developers.openai.com/codex/subagents)

- **Models and workers.** Inspect the live `spawn_agent` schema and use only offered values. The Codex source exposes a shape such as `spawn_agent({ message, model, reasoning_effort })`. Match your runtime's brief field, which may be `task_name` plus `message`. Use a fresh brief for independent review when supported. Configured custom agents use `model` and `model_reasoning_effort`. Treat model overrides as available only if exposed and allowed.
- **Results and questions.** Wait on the returned agent ID with the native wait tool, for example `wait_agent` where listed, or consume the completion notification. Use the exposed `request_user_input` or asynchronous equivalent when appropriate. If unavailable, ask in the final reply.
- **PRs and issues.** Use an exposed forge tool or `gh`. Use the [vendored waiter](../../babysit-pr/scripts/pr-wait) for PR monitoring when no tracked watch is offered.

[Codex spawn handler](https://github.com/openai/codex/blob/4e9ce8fa9e7649ec58601a3d61da7a086da75500/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs)
