# Sprint 8 provider evidence

The verification row is written by the sync engine after the database transaction. The API does not accept an origin or a success flag.

| Class | When it is stored |
|---|---|
| `NOT_CONFIGURED` | The provider client id and secret are absent and the call used the process fetch. |
| `STUB_TESTED` | The fetch implementation was injected, including every local fixture and unit test. |
| `CONFIGURED_UNVERIFIED` | Credentials exist, but identity, scope, commit, fence, or runtime did not all pass. A declared origin also lands here instead of a live result. |
| `REAL_READ_VERIFIED` | Every live-read condition passed together on the process fetch outside test and CI. |

This does not stop a compromised server, a poisoned DNS result, or a substitute network. It does stop a browser, a test double, and an unused client secret from labeling a mailbox live.

No `REAL_READ_VERIFIED` row exists for this workspace. Live Gmail and live Microsoft remain not configured.
