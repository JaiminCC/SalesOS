# Calendar meeting types

A meeting type stores name, description, duration (15, 30, 45, 60, or 90 minutes), location, zone, and whether approval is required. Location is `VIRTUAL_PENDING`, `PHONE_CALL`, `PHYSICAL`, or `OTHER`. The create response sets `conferenceUrl` to null. A virtual meeting stays `VIRTUAL_PENDING` because no conference URL is verified.

Optional hosts must be active members. An empty host list allows any active member. A listed host who is missing or suspended is `HOST_UNAVAILABLE`. Round-robin assignment is not implemented. The selected organizer is the signed-in member for the management API.
