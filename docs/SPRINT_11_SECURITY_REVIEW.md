# Sprint 11 security review

## Controls verified

- Forced tenant RLS on calendar tables via the tenant table registry.
- Least-privilege app/worker grants; overlap function execute granted only to `salesos_app` and `salesos_worker`.
- Cross-tenant organizer and booking access blocked by `withTenant` and composite tenant keys.
- Resource-level host membership checks before holds and reassignment.
- Author/reviewer separation (`SELF_APPROVAL` rejected).
- Approval version and digest binding with replay rejection.
- OAuth state single-use, redirect URI bind, creator bind, expiry.
- Token ciphertext storage; write scopes rejected (`SCOPE_MISSING`).
- Provider write adapters throw before `fetch`.
- Concurrent double-book prevented by advisory locks plus overlap triggers.
- AI proposals remain `REVIEW_REQUIRED` drafts; invented external links rejected.
- URLs do not embed internal UUIDs in CalendarDesk flows covered by Playwright.

## Residual risk

Live OAuth code exchange and provider free/busy are not authorized in this environment. `READ_ACCESS_VERIFIED` must not be set by fixtures for production readiness claims. External writes remain closed even if the live write env flag is flipped in test/CI (`liveCalendarWriteEnabled` forces false).
