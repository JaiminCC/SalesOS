# WhatsApp service window

The window is 24 hours after the latest stored inbound customer message. The result is `WINDOW_OPEN`, `WINDOW_CLOSED`, or `WINDOW_UNKNOWN`. A timestamp more than five minutes in the future is unknown. No inbound message is unknown.

A fixture timestamp can open a window for that fixture. It does not prove that a live customer window is open. An open window does not authorize sending. Outside the window, a free-form reply is not eligible for a future delivery. Only a provider-approved template could be eligible for a later business-initiated send, and this sprint cannot store or submit that approval.
