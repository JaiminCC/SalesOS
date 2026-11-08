# WhatsApp Embedded Signup

Mode A is prepared and not executed. When `META_EMBEDDED_SIGNUP_CONFIG_ID` is present, overview reports Embedded Signup as `AUTHORIZATION_REQUIRED`. When it is absent, the state is `NOT_CONFIGURED`.

Sprint 10 does not exchange an authorization code, does not call the Graph token endpoint, and does not mark a returned WABA as verified. A future authorized exchange must bind the tenant and actor, reject a replayed code, check the granted permissions, validate the WABA with the provider, encrypt the token, and write an audit event. Until that exists, administrators use manual configuration, which stays `CONFIGURED_UNVERIFIED`.

Status: NOT_CONFIGURED unless an operator later supplies a configuration id. Even then the account is not live-verified.
