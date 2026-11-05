# Send authorization fencing

Outbound dispatch stores two versions on the attempt at claim time:

- `mailbox_connections.revocation_version`
- `email_send_policies.policy_revision`

The claim also stores `payload_digest`, which is the approved draft version digest. The live idempotency key is `sha256(versionId + ':dispatch')`. It is not taken from the client.

## Checked before the provider request is built

The prepare step and the claim transaction reject a send when any of these fail: the organization is active, the user is an active member, the user has `mailbox.send` and `mailbox.send.execute` plus mailbox `SEND` access, the connection is not disconnected, the mailbox is `SEND_AUTHORIZED` and sending is enabled, the deployment gate is on, the tenant policy is enabled, the kill switch is off, the approval digest matches and is unexpired, recipients are valid and within the cap, suppression, consent, verification, human takeover, and quiet hours allow the send, and a quota reservation can be taken.

The test provider is the only provider that skips the Gmail or Graph send-scope string. It is not a live sender. Google requires `gmail.send`. Microsoft requires `Mail.Send`.

## Checked again after the claim commits

`assertDispatchFence` reads the connection, policy, approval, tenant activity, permissions, suppression, takeover, consent, verification, and quiet hours again. The attempt must still be `IN_FLIGHT`, and the stored revocation version and policy revision must still match. A mismatch settles the attempt to `FAILED_FINAL`, releases the reservation, and does not call the provider.

The worker can run that recheck immediately before the network call. The database update and the provider HTTP call are not one atomic operation. A revocation that arrives after the request bytes have been transmitted cannot retract that request. The attempt then stays `PROVIDER_ACCEPTED` or `DELIVERY_UNKNOWN` and is not resent.

A revoked or invalid intent that has not been transmitted is not dispatched.
