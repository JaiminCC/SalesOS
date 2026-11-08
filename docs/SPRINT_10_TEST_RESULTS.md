# Sprint 10 test results

Commands were run on 8 November 2026 against the Sprint 10 tree. Exit codes are the process status after each command.

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 |
| `pnpm check:source` | 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 |
| `pnpm test:e2e` with `PLAYWRIGHT_BROWSERS_PATH` unset | 0 |

`pnpm test` passed shared 43, agent-core 6, integrations 8, database 27, API 38, worker 30, and the web secret scan. The database suite includes the clean migration probe, forced RLS isolation, the WhatsApp domain test, and the no-send source scan. The API suite includes the webhook HMAC test and the Redis rate-limit test. The worker suite includes the WhatsApp SIGKILL recovery test.

The first `pnpm test:e2e` exited 1 because `PLAYWRIGHT_BROWSERS_PATH` pointed at an empty sandbox cache. The suite was rerun with that variable unset so Playwright used the installed Chromium. That run exited 0: 10 passed, including the signed-in WhatsApp fixture test.

A session cookie on the same host had been able to reject a valid webhook signature as CSRF. The webhook path now accepts a valid signature without a CSRF header. The API integration test covers that case.

Ollama acceptance is not part of `pnpm test`. It was run separately:

`pnpm --filter @salesos/api exec vitest run --config vitest.acceptance.config.ts src/whatsapp/whatsapp-model.acceptance.ts`

Exit 0. One test passed in 7.6 seconds. The recorded result was provider `ollama`, model `gemma4:e4b`, draft source `MODEL`, origin `STUB_TESTED`.

The closeout also applied forward migration `20261108142000_whatsapp_ingress_guard`. Application and worker roles can no longer select `whatsapp_ingress`. The public webhook limit is a Redis window and returns 503 when Redis is unreachable.

No screenshot rewrite remains in `docs/verification`. The five PNGs rewritten by the browser suite were restored.

Live Meta was not called. No WhatsApp message was sent. No email was sent.
