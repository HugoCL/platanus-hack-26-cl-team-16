# 01: Agent card page in one column with the contract ledger

**What to build:** The agent card page (`/directory/[slug]`) reads top to bottom in one column: name with the verified badge, a meta line, the purpose, Conversar, then the contract as a ledger of four rows (what it can do, what it will ask you for, what it shares, what it never talks about), the description, the location and "Detalles técnicos" closed. This ticket introduces the shared pieces the later tickets reuse: the contract ledger, one tag, one uppercase label and the page-title scale. See `prototypes/detail-desktop.webp` and `prototypes/detail-mobile.webp`.

**Blocked by:** None (can start immediately)

**Status:** done (PR pending review)

**Notes:** Checked in a browser on phone and desktop, light and dark. The captures are linked from the PR, not committed.

- [ ] The page has one column of at most 720px; no column holds only the call to action.
- [ ] Conversar sits under the purpose. On phones it stays fixed at the bottom of the screen.
- [ ] The contract is a definition list with dot leaders. No intent codes or tool names appear outside "Detalles técnicos".
- [ ] When the purpose has two sentences, the first is in the foreground colour and the rest in the muted headline colour.
- [ ] The verified badge is centred on the title's cap height.
- [ ] An unclaimed agent shows muted text and a dashed tag, with no hatch, and Conversar disabled with one sentence that says why.
- [ ] Loading shows a skeleton shaped like the page. A missing agent says so in one sentence and links back to the directory.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
