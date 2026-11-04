# SalesOS Screen Map and Interaction Acceptance Checklist

All screens are reachable through the persistent sidebar. The UI uses fake `.example` domains and deliberately distinguishes external-provider operations from internal state changes.

| Route (client-side view) | User interactions | Local state change / outcome |
|---|---|---|
| Command Center | Run AI cycle; pause supervisor; open inspector; select agent | Appends activity + execution run; changes supervisor status |
| AI Agents | Select 8 agent roles; pause/resume; test agent | Agent enabled changes; test creates inspected run |
| Execution Inspector | Filter runs by status; inspect step log; replay; copy details | Run selection and simulated replay logged |
| Lead Discovery | Search/filter; select lead; research batch; mark engaged; draft pitch | Stage transitions, activity log, approval requests |
| Campaigns | Create draft; edit ICP/market/cadence; activate/pause | Campaign records updated |
| AI Conversations | Select thread; generate context-aware draft; simulated send; human handoff; meeting request | Thread, status, meeting record |
| Qualification | Select lead; inspect score factors; mark qualified; schedule | Lead stage / meeting record |
| Meetings & Notes | Select meeting; agenda; transcript; AI notes; action items; add task; create meeting; follow-up | Meeting/task records and activity |
| Approval Center | Approve/reject each action | Approval status + execution history |
| Analytics | Change time range; agent performance; campaign mix | Reporting context in local UI |
| Products & Services | View multi-offering catalogue; add offering; create campaign | New offering and new campaign |
| Settings | Switch tenant preview; choose model label; adjust policies; reset data | Local preferences and reset |

## Eight specialist roles
1. AI Sales Supervisor
2. Research Agent
3. Outreach Agent
4. Conversation Agent
5. Qualification Agent
6. Meeting Agent
7. Meeting Intelligence Agent
8. Follow-up & Insights Agent

## Visual conventions
- Purple: autonomous intelligence and primary action
- Green: successful/eligible/active
- Amber: awaiting approval, paused, or needing attention
- Red: restricted, blocked, or escalated
- “Simulated” labels always visible to prevent claims of real-world sending, recording, or bookings

## Interaction smoke tests after `npm run dev`
1. Open Command Center; click **Run AI cycle**; open Execution Inspector and confirm a new run appears.
2. Open AI Agents; select **Outreach Agent**; pause; confirm state; reload page and confirm state persists.
3. Open Leads; select a different company; prepare pitch; queue for approval; open Approval Center and resolve it.
4. Create a campaign; edit ICP; activate; pause; reload page and confirm saved status.
5. Open AI Conversations; generate contextual draft; submit demo reply; verify it appears in the thread; assign human handoff.
6. Create meeting; open newly added meeting; view empty transcript notice; add meeting action item.
7. Select previously completed CloudBridge meeting; inspect source-linked **simulated transcript**, notes and action items.
8. Switch Settings tenant label; switch AI preference; reset demo and confirm initial state returns.
9. Verify page layout at desktop 1440px and mobile 390px.

## Production implementation notes
No frontend-only state may be interpreted as evidence that an external action happened. In production, send/booking outcomes must be acknowledged by the authorized provider API and persisted with a provider ID and explicit status. Credentials belong on a server-side encrypted integration layer. Multi-tenant isolation must be authenticated and enforced in backend queries / RLS, not by merely switching tenant labels.
