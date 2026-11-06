# Sprint 8.1 completion

Sprint 8.1 hardens the Sprint 8 operational foundation. It does not enable sending, connect a mailbox, or start Sprint 9.

## Evidence

`classifyProviderEvidence` is the only writer of the verification class. The classes are `STUB_TESTED`, `CONFIGURED_UNVERIFIED`, `REAL_READ_VERIFIED`, and `NOT_CONFIGURED`.

`REAL_READ_VERIFIED` requires all of these at once:

- the process `fetch`, not an injected fixture
- a runtime that is not `test` and not `CI`
- a read-only Gmail or Graph scope, with no send scope
- a provider mailbox identity that matched the stored address
- an authenticated provider response
- a committed final page and cursor
- a revocation fence that still passed

A caller-supplied origin is ignored and cannot select `REAL_READ_VERIFIED`. Configured OAuth credentials without that full read stay `CONFIGURED_UNVERIFIED`.

## Health

A stub page is `STUB_SYNCED` and `LOCAL_TEST_HEALTHY`. A page with a remaining provider link is `SYNC_PARTIAL` and `SYNC_DELAYED`. A rate limit is `RATE_LIMIT` and `RATE_LIMITED`. A cursor recovery is `CURSOR_RECOVERED` and `CURSOR_EXPIRED`, which means the mailbox is not current.

## Recovery

`apps/worker/src/mailbox-kill.spec.ts` kills a child process around the provider read and checks the replacement. No send attempt is created. Details are in `docs/SPRINT_8_SYNC_RECOVERY.md`.
