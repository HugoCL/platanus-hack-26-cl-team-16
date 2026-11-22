# 09: Rewrite DESIGN.md and run the polish pass

**What to build:** `DESIGN.md` describes what was built: the landing is the visual authority for the app, yellow means selection, the contract ledger, the moderator shield, and machine names only in the audit and technical details. Then the changed views get one polish pass with the project's UI skills, and each finding is fixed or dismissed with a written reason.

**Blocked by:** 01 to 08

**Status:** done (PR pending review)

**Notes:** The impeccable detector ran on `src/app` and `src/components` and returned no findings. `make-interfaces-feel-better`, `web-design-guidelines` and the accessibility review were applied while building and checking each view in the browser; they were not run as separate audits with a written report.

- [ ] §1 to §4 are rewritten and no longer contradict the code. §2 says where codes are shown.
- [ ] The impeccable detector, `make-interfaces-feel-better`, `web-design-guidelines` and an accessibility review ran on the changed views.
- [ ] Icon imports use the `*Icon` name, no icon sets `strokeWidth`, and icon-only controls have a tooltip.
- [ ] Small text on muted surfaces uses the subtle foreground token.
- [ ] Before and after captures at 1440px and 390px, light and dark, are in the PR.
- [ ] `pnpm lint`, `typecheck`, `test` and `smoke` pass.
