# 03: Open-room dialog shows the contract ledger

**What to build:** The last step of the open-room dialog shows the same contract ledger as the agent card page, so a person sees one contract before and after opening a room. The intent choice lists intents by their Spanish label only.

**Blocked by:** 01 (contract ledger)

**Status:** done (PR pending review)

**Notes:** Checked at 390px with the demo agent.

- [ ] The contract step renders the shared ledger component, not chips.
- [ ] No intent codes appear in the dialog.
- [ ] Long forbidden topics and long data lists wrap inside the dialog at 390px.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
