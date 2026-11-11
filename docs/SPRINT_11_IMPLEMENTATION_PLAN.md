# Sprint 11 implementation plan

Internal calendar foundation. External event creation is not authorized.

| Requirement | UI | API | Database | Worker | Provider | RBAC | Test |
|---|---|---|---|---|---|---|---|
| Readiness | Overview labels | `calendar/overview` | `calendar_connections.readiness` | `calendar.connection.health` | Google v3, Graph v1.0 | `calendar.connections.read` | database overview |
| Working hours | Policies | `rules/save` | `calendar_rules` | none | none | `calendar.availability.manage` | database + Playwright |
| Meeting type | Types | `meeting-types/create` | `calendar_meeting_types` | none | no conference URL | `calendar.meeting_types.manage` | database + Playwright |
| Slots | Availability | `availability` | rules, holds, meetings | `calendar.availability.refresh` | read adapters, stub only | `calendar.availability.read` | shared + database |
| Hold | Hold first slot | `slot-holds/create` | `calendar_holds` plus advisory lock | `calendar.slot.hold.expire` | none | `calendar.bookings.create` | conflict + SIGKILL |
| Internal booking | Meetings | `booking-requests/create` through `meetings/confirm` | `calendar_meetings` | `calendar.booking.confirm_internal` | closed gate | create, review, manage | database |
| AI proposal | Proposals | `proposals/create` | `source_kind = AI_PROPOSAL` | `calendar.ai.proposal` | none | `calendar.bookings.create` | injection case |
| Analytics | Operations | `analytics`, `operations` | counts | `calendar.analytics.aggregate` | external counts unavailable | `calendar.analytics.read` | overview labels |

Status words used in this sprint: IMPLEMENTED, LOCAL_TESTED, STUB_TESTED, NOT_CONFIGURED, NOT_AUTHORIZED, NOT_TESTED. REAL_PROVIDER_VERIFIED is not claimed.
