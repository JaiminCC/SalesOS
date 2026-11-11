# Calendar provider verification

## Readiness states

| State | Meaning |
| --- | --- |
| `NOT_CONFIGURED` | Client id/secret absent |
| `CONFIGURATION_INVALID` | Incomplete or too-short secret |
| `CONFIGURED_UNVERIFIED` | Reserved for configured credentials before auth |
| `AUTHORIZATION_REQUIRED` | Auth URL may be built; code not exchanged |
| `CONNECTED_UNVERIFIED` | Encrypted token stored via stub exchange helper; free/busy not verified |
| `READ_ACCESS_VERIFIED` | Only after an actual authorized provider read succeeds |

`calendar_verifications.origin` may be `STUB_TESTED` or `LOCAL_CAPTURE` only. A stub free/busy response is not live verification. The OAuth callback consumes single-use state and returns `AUTHORIZATION_REQUIRED` with `codeExchanged: false`. It does not call Google or Microsoft token endpoints.

## Activation steps (not performed here)

1. Set provider client id and secret in the deployment environment.
2. Complete interactive OAuth with read-only scopes only.
3. Persist tokens through the encrypted credential path.
4. Run an authorized free/busy or getSchedule read.
5. Only then mark `READ_ACCESS_VERIFIED`.

Provider-validated availability without that readiness returns `NEEDS_PROVIDER_VERIFICATION` and empty slots. The UI prints `LOCAL_ONLY` and does not claim Google or Microsoft confirmation.

## External writes

`createExternalEvent`, `updateExternalEvent`, `deleteExternalEvent`, `createConference`, and `sendCalendarInvitation` throw before network access. Confirmed bookings store `CLOSED_GATE` link rows without provider event identifiers.
