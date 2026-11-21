---
name: git-conventions
description: Apply the repository's conventions when naming a branch, committing changes, opening or updating a pull request, writing its description, or attaching verification evidence.
---

# Git conventions

## Commits and branches

- Use `<type>(<optional-scope>): <imperative subject>` with a subject of at most 72 characters. Types are `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `build`, `ci`, `chore`, and `revert`. Put `!` before the colon for a breaking change.
- Make one logical change per commit. Add a body only if the reason needs explaining, in up to about five short lines. Agent commits end with a trailer using the agent's attribution, for example `Co-Authored-By: GPT Sol 6.2 <noreply@openai.com>`.
- Use `<type>/<short-slug>` for branches, one ticket per branch.

Good examples include `fix(auth): preserve redirect after sign-in` and `feat(api)!: require an account ID`. Avoid subjects such as `fixed stuff` or `feat: add sign-in, update dependencies, and reformat the app`.

## Pull requests

File a real PR using the vendored [file-pr skill](../file-pr/SKILL.md). First self-review the diff, keep it to one ticket, and link the ticket. Before asking for review, run `$make-pr-easy-to-review` (tidy noisy commits, improve the description, add reviewer guidance, no behavior changes) and `$deslop` on your own changes. Aim for fewer than about 400 changed lines excluding generated files and lockfiles. Keep drive-by refactors out of the diff.

Use the [PR template](../../../.github/pull_request_template.md) for the description, preserving this order:

1. **What this PR delivers** lists changes the reviewer can verify.
2. **Short description** explains the problem and solution in one or two sentences.
3. **Long description** covers context, approach, trade-offs, and options considered and ruled out.
4. **Evidence** shows screenshots, recordings, or relevant command results.
5. **How to verify** gives steps and expected results.
6. **Risks and follow-ups** records known limitations and remaining work.
7. A collapsed **Thread summary and models** section records the originating ask, key decisions, and dead ends, with a table of model, role, and harness.
8. Close with `Created with <public model name> in <harness>.` Include contributing implementers and report unavailable model identities by harness.

## Evidence

- Capture screenshots or recordings for UI changes when possible. Use `artifacts/smoke.png` from `pnpm smoke`, agent-browser screenshots or recordings, or Playwright video. For other changes, include relevant command output.
- With `gh` 2.103 or newer, check `gh pr create --help` and `gh pr edit --help` for `--attach`. Pass `--body-file <body.md> --attach ./evidence.png` to either command. A Markdown reference in the body to the same local path is rewritten on upload. Use a user token with repository write access. GitHub App installation tokens are refused. Private-repo viewer access, inline video rendering, and CLI upload size limits are **UNCONFIRMED**. Verify with a repository reader on the actual credential and media type, or use the branch fallback below. The upload endpoint's public API status is **UNCONFIRMED**. Use the supported CLI flag. [CLI upload source](https://github.com/cli/cli/blob/de06af2c2ea536d5722fda35dc2001565f9b9f64/internal/attachments/client.go), [App token limitation](https://github.com/cli/cli/issues/14309)
- In Capy, look for `tools.pr.uploadAsset`. gstack uses it only for public repos and the live tool schema is **UNCONFIRMED**. See [Capy evidence](../harness-map/references/capy.md#ask-track-and-attach). In T3, `t3_attachment_prepare_upload` sends evidence to a thread via `t3_thread_send_attachments`. Use a forge attachment or evidence link in the PR body.
- When uploads are unavailable and publishing the evidence is authorized, place files on a separate orphan `pr-evidence` branch in the same repository. Link them with `../blob/pr-evidence/<path>?raw=true`. Viewers need read access to that repository. Keep the branch available while the PR relies on those links. Behavior after branch deletion is **UNCONFIRMED** in the research. Never commit evidence to the feature branch. If the evidence cannot be shared, include text results. [GitHub Markdown reference](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#relative-links)
