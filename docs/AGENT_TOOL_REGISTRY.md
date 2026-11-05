# Agent tool registry

`packages/shared/src/tools.ts` is the server-side registry. `buildSupervisorPlan` chooses a fixed plan. Model output cannot add a tool. `validatePlan` rejects an empty plan, more than 12 steps, or an unknown name or version.

| Tool | Model | External | Approval |
| --- | --- | --- | --- |
| `product.context.read` | No | No | None |
| `product.knowledge.search` | No | No | None |
| `product.icp.read` | No | No | None |
| `product.positioning.read` | No | No | None |
| `research.report.create` | Yes | No | None |
| `sales.strategy.generate` | Yes | No | None |
| `sales.message.draft` | Yes | Yes, draft only | Required |
| `action.proposal.create` | No | Yes, proposal only | Required |

The last two are added only when the goal contains draft, email, message, or send. They persist a proposal. They do not send email or WhatsApp.

Local tools read the pinned `context_snapshot` inside the claim transaction. Model tools return a claim, and the HTTP or mock call happens after that transaction commits. Each call stores an idempotency key `{runId}:{toolName}` on `agent_tool_calls`.

The executor does not run SQL, shell, filesystem, or network instructions produced by the model. Before a step it rechecks that the initiating membership is still active and still has `agents.manage`, that the organization is active, that the agent is active, and that a paused organization does not run an external tool.
