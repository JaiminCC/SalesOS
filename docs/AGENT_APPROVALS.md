# Agent approvals

`agent_approvals` stores one pending decision per action. The row holds the organization, run, action, payload SHA-256, tool type, risk, requester, expiry (seven days), policy version, and the later decision.

`POST /api/v1/management/approvals/decide` accepts the id and the expected digest in the JSON body. The update matches `decision = PENDING` and the same digest. A second decision, a changed digest, or an expired row returns 409. The caller must still have `approvals.manage` or `approvals.review`. A suspended organization and a paused automation cannot approve an external proposal.

Approve sets the action to `APPROVED_NOT_EXECUTABLE` and `outcome` `{ sent: false, executable: false }`. Reject sets `BLOCKED`. Request changes records `CHANGES_REQUESTED` and leaves the action in `NEEDS_APPROVAL`. None of these paths send email or WhatsApp.

The signed-in Approval Center reads this API. The unsigned page remains the simulated queue.
