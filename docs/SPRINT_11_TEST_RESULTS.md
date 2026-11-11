# Sprint 11 test results

Commands were run on 8 November 2026. Exit codes:

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 |
| `pnpm check:source` | 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 |
| `pnpm test:e2e` with `PLAYWRIGHT_BROWSERS_PATH` unset | 0, 11 Playwright tests passed |

The first full Playwright run exited 1 because the calendar spec matched two `LOCAL_ONLY` labels before the slot request finished. The assertion now waits for `LOCAL_ONLY · READY`. The rerun of the full suite exited 0. Incidental rewrites of `docs/verification/*.png` were restored.

Calendar evidence inside `pnpm test`:

- Shared time-zone and slot tests, including Kolkata, the New York spring-forward gap, the New York fall-back overlap, and London's spring-forward gap.
- Google freeBusy and Graph getSchedule stub adapters, including redirect refusal and dropped private subjects.
- Closed-gate write adapter, including the flag set to `true`.
- Database booking: one hold under concurrency, self-approval rejected, a second member approves, confirmation stores `CLOSED_GATE` with a null provider event id, CRM stage stays unchanged, reschedule and cancel send nothing, an expired hold cannot be used, OAuth state replay stores no token, a suspended tenant cannot hold.
- Forced RLS isolation suite, which includes the new calendar tables.
- Clean migration probe.
- Worker SIGKILL before a hold and during the hold transaction. The replacement inserts one hold. A duplicate interval conflicts. A suspended tenant creates no external link.

Playwright covers the signed-in meetings workspace, the not-configured and not-authorized labels, a connection, a meeting type, working hours, a local slot list, a hold, the conflicting second hold, a second tab, and the absence of a database id or a Send button. It does not walk a second reviewer, reschedule, cancel, outcome, or a second organization in the browser. Those behaviors are in the database test, except a separate viewer browser session.

Real Ollama, separate from `pnpm test`: `vitest run --config vitest.acceptance.config.ts src/calendar/calendar-model.acceptance.ts` exited 0. The run state was `SUCCEEDED`, provider `ollama`, model `gemma4:e4b`, and usage was recorded. `acceptMeetingProposal` rejected the model text, so the result is `REVIEW_REQUIRED` and was not stored as an accepted booking. External links, internally booked meetings, mailbox send attempts, and lead-stage changes were zero.

LIVE GOOGLE CALENDAR — NOT CONFIGURED. LIVE MICROSOFT CALENDAR — NOT CONFIGURED. REAL FREE/BUSY — NOT TESTED. EXTERNAL EVENT CREATION — NOT AUTHORIZED. CALENDAR INVITATIONS — NOT AUTHORIZED.
