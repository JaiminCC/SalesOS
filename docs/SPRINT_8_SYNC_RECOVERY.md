# Sprint 8 sync recovery

The kill suite is `apps/worker/src/mailbox-kill.spec.ts`. The child is `apps/worker/src/mailbox-crash.ts`. Provider HTTP is a local fixture. Nothing is sent.

| Case | Kill point | Result |
|---|---|---|
| A | During provider HTTP | No message and no cursor. The replacement imports the page once. |
| B | After the response, before persistence | No message. The connection is not `SYNCED`. |
| C | During the persistence transaction | The message insert rolls back with the cursor. The replacement imports once. |
| D | After the committed page, before the verification row | One message remains. The replacement imports zero new messages and records `STUB_TESTED`. |
| E | After the lease claim | The replacement waits for lease expiry, then imports once and does not duplicate. |
| F | Two workers | The second worker does not persist while the first holds the read. |
| G | Disconnect during HTTP | The killed read persists nothing. The connection is `DISCONNECTED`. |
| H | Tenant suspended before the replacement commit | The replacement stops as `suspended`. |
| I | Permission removed before the replacement commit | The replacement stops as `forbidden`. |
| J | Refresh raced with disconnect | Tokens are cleared and no message is stored. |
| K | Expired Gmail history, killed inside the recovery transaction | The stale history id remains until a later recovery. The later status is `CURSOR_RECOVERED`, not `SYNCED`. |
| L | Expired Graph delta, killed inside the recovery transaction | The foreign delta link is not followed. Recovery does not mark the mailbox current. |

Messages and the cursor commit in one transaction. A kill inside that transaction leaves neither. A rate-limited run stays `RATE_LIMITED`. A partial page stays `SYNC_DELAYED`. Send attempts for the suite stay at zero.
