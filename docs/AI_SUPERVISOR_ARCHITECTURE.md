# AI supervisor architecture

A run is created only with a goal, a published product version, and an enabled model configuration. `loadPublishedContext` rejects a missing product, a foreign version, and any version that is not `PUBLISHED`. The run stores `product_id`, `product_version_id`, `context_sha256`, the snapshot, and citations. Later product edits do not change that snapshot.

`buildSupervisorPlan` writes the plan before enqueue. `advanceAgentRun` executes it in order:

1. Read pinned product, ICP, positioning, and approved citation metadata.
2. Ask the selected model for a research report and a sales strategy.
3. When the goal asks for a draft or message, ask for a draft and persist an approval. The draft is not sent.

Document excerpts are placed under an untrusted-data instruction. They are not parsed as tool calls or permission grants.

Completion is `SUCCEEDED` only after every plan tool is `SUCCEEDED` and no approval is pending. A pending approval completes the run as `WAITING_APPROVAL`. Resume rechecks organization status, the initiator's `agents.manage` membership, the agent, the model, and that the pinned version is still `PUBLISHED` or `SUPERSEDED`. It runs `decide()` again for pending external actions. Resume of a cancelled run stays rejected.

Paused agents are not eligible in `ensureAgent`, and a checkpoint pauses the run when the agent is no longer `ACTIVE`. A paused organization pauses the run at an external tool and still allows the internal research tools.

No Sprint 4.1 path sends email, WhatsApp, or another external action.
