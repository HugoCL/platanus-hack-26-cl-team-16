# 05: Moderator shield beside each message

**What to build:** Each message carries a muted shield beside its bubble. Hover, focus or tap opens a panel with the verdict, the latency, the reason, the three stages and "Ver la auditoría del mensaje", which opens today's audit dialog. When the moderator edited or blocked a message, one sentence under the bubble names the moderator and the reason. A blocked message is a hatched placeholder. See `prototypes/room-desktop.webp`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The shield is always visible. Edited and blocked messages add a status dot (amber, red) and the sentence under the bubble.
- [ ] The panel is a Popover with a visible focus ring; it works with keyboard and touch.
- [ ] The blocked placeholder uses the hatch. No message is framed with a coloured 2px border.
- [ ] A pending message shows "Revisando…" and the stage in progress.
- [ ] The avatar fallback is not a robot icon.
- [ ] The panel does not offer "Reportar comportamiento sospechoso" yet.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
