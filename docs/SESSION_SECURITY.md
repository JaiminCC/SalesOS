# Session security

The cookie name is `salesos_session`. It is `HttpOnly`, `SameSite=Lax`, and `Path=/`. `Secure` is added only when `NODE_ENV=production`. The cookie value is the raw token. The database stores `token_hash`.

Idle expiry is 30 minutes and slides while the session is used. Absolute expiry is 12 hours, or 30 days when remember-me is set. Remember-me is the same revocable session with a longer absolute lifetime, not a second token.

Login revokes the presented session and inserts a new row. Password reset and owner transfer revoke the user's live sessions. `DELETE /api/v1/auth/sessions/:id` revokes one owned session. Logout revokes the presented session and clears the cookie.

A cookie-authenticated `POST`, `PATCH`, or `DELETE` must send `X-Salesos-Csrf: 1`. A missing `Origin` is accepted for non-browser clients that already hold the cookie. A present `Origin` must be exactly one of the comma-separated `WEB_ORIGIN` values. `null`, a non-URL value, and an origin with a path are rejected. `SameSite=Lax` already withholds the cookie from cross-site form posts, and browsers cannot add the custom header cross-origin without a CORS preflight. That combination matches the supported deployment: the browser talks to the API through the same-origin `/backend` rewrite. Express `trust proxy` stays off, so throttling uses the direct socket address rather than a client-supplied forwarding header. An email is limited to 5 failures per 15 minutes. A source address is limited to 100, so one shared network does not lock every account after a handful of mistakes. Failed attempts for one email are serialized with a transaction lock so concurrent guesses cannot slip past the cap. The browser calls the API through the Next.js `/backend` rewrite so the cookie is first-party on the web origin. Direct calls from another site are rejected with `CSRF_REJECTED`.

Logs and `security_events.metadata` record the action, result, request id, and organization id. They do not record passwords, token values, or cookie values. The browser does not put the session in `localStorage` or `sessionStorage`. The old `salesos-auth-demo` flags are removed on a successful login and are not read.

The web app must be opened on an origin listed in `WEB_ORIGIN`. On this machine port 3000 was already taken by another project, so the browser-path check used `http://127.0.0.1:3010` with an API on `127.0.0.1:3011` whose `WEB_ORIGIN` was that page.
