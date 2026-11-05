# Outbound crash recovery

There is no time-based send lease. An expired lease would not prove that the provider did not accept the message, so expiry is not used as permission to send again. The fence is the unique reservation plus the revocation version and policy revision stored on the attempt.

`apps/worker/src/send-recovery.spec.ts` starts a real child process with `node --import tsx` and stops it with `SIGKILL`. A local HTTP server on `127.0.0.1` counts `POST /send`. The child does not call Gmail or Graph.

| Case | What the child does | What recovery does |
|---|---|---|
| A. Killed before the claim | Prints the checkpoint and never calls `sendDraft` | A later send may call the provider once |
| B. Killed after the claim | The reservation exists and the callback hangs before HTTP | The next send is `DUPLICATE_SEND` and does not call the provider |
| C. Killed while the request is in flight | The local server has accepted the POST and is holding the socket | The invocation count stays put. The attempt remains `IN_FLIGHT` |
| D. Provider returned 200, then the process died | The callback read the body and hung before returning | `sent` stays false. A later send does not call the provider |
| E. Reconciliation killed | Lookup is entered only when a provider message id and token exist, then the process is killed | A later reconcile writes an event, does not send, and can be repeated |
| F. Second worker after the first was killed | Another process calls `sendDraft` for the same version | It does not increment the provider count |

Uncertain and in-flight rows are not marked delivered. Reconciliation is idempotent. A disconnected connection is not sent. A cancelled or revoked attempt is not sent.

This is at-most-once automatic dispatch after the request may have left the process. It is not exactly-once delivery.
