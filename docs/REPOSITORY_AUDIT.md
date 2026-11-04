# SalesOS repository audit

**Status:** Phase 1 audit only. No application implementation was written in this run.  
**Date:** 4 November 2026  
**Scope:** Code Colonies SalesOS Enterprise v2.1 interactive prototype at the repository root, plus the reference specification under `sales-os-docs/`.  
**Auditor execution:** commands below were run on this machine (Node v22.21.0, npm 10.9.4). Results are reported only for commands that actually finished.

## 1. What this repository is

SalesOS v2.1 is a clickable Next.js prototype of an autonomous, multi-product sales workspace. The visual system, navigation, and local interactions are the asset to preserve. Every business action is simulated in the browser. There is no API, database, queue, authentication server, or LLM call.

The production target is already described, but not implemented, in:

- `sales-os-docs/Code_Colonies_SalesOS_Developer_Package/SalesOS_BRD_SRS_Architecture.md`
- `sales-os-docs/Code_Colonies_SalesOS_Developer_Package/schema.sql` (reference DDL, not a migration)
- `sales-os-docs/Code_Colonies_SalesOS_Developer_Package/openapi.yaml` (partial contract, not a generated API)
- `sales-os-docs/Code_Colonies_SalesOS_Developer_Package/docker-compose.yml` (structure only; Dockerfiles are absent)
- `docs/PRODUCTION_BACKLOG.md`, `docs/SCREEN_MAP.md`, `docs/ENTERPRISE_V2_IMPLEMENTATION.md`

This audit does not treat those reference files as a running system.

## 2. Source layout

Application source is five files plus configuration. Screen count is large because `components/SalesOS.jsx` and `components/Enterprise.jsx` are dense single-file clients, not because the tree is modular.

| Path | Role |
|---|---|
| `package.json` | Prototype `2.1.0`. Scripts: `dev`, `build`, `start`, `check:source`. No `lint`, `typecheck`, or `test` script. |
| `next.config.mjs` | `reactStrictMode: true` only. |
| `app/layout.jsx` | Root layout. Metadata title and description. Imports CSS. No providers. |
| `app/page.jsx` | Renders `<SalesOS />`. The only App Router page. |
| `app/globals.css` | Tailwind layers plus the entire sales UI, mostly on a few very long lines. |
| `app/enterprise.css` | Enterprise and sign-in styles. |
| `components/SalesOS.jsx` | Client shell: menu, local store, and all original sales screens. |
| `components/Enterprise.jsx` | Sign-in flow and enterprise settings screens. |
| `components/data.js` | Hardcoded seed companies, products, agents, threads, meetings, runs. |
| `tailwind.config.js` | Content globs `app/**/*.{js,jsx}` and `components/**/*.{js,jsx}`. Custom violet scale. |
| `postcss.config.js` | Tailwind + Autoprefixer. |
| `public/` | Empty. |
| `docs/` | Prior handoff notes, screen map, production backlog, source smoke script. |
| `sales-os-docs/` | BRD/SRS, Figma exports (duplicated), developer package. Not compiled by Next.js. |
| `START_MAC_LINUX.sh`, `START_WINDOWS.bat` | `npm install` then `npm run dev`. |

Not present:

- `tsconfig.json`, ESLint config, Prettier config, test runner, CI workflow
- `app/api`, middleware, server actions that call a backend
- Prisma, NestJS, Redis, Dockerfiles, `.env.example`
- Git repository (`git rev-parse` reports this directory is not a git repo)

`typescript` is a devDependency and is used only by `docs/check_source.cjs` as a parser. It does not type-check the app.

## 3. Next.js, routing, dependencies

### Resolved versions (lockfile after `npm install`)

| Package | Declared | Installed |
|---|---|---|
| next | `^15.3.0` | **15.5.29** |
| react | `^19.0.0` | **19.3.1** |
| react-dom | `^19.0.0` | **19.3.1** |
| lucide-react | `^0.468.0` | **0.468.0** |
| tailwindcss | `^3.4.17` | **3.4.19** |
| postcss | `^8.5.0` | **8.5.32** (direct) |
| autoprefixer | `^10.4.20` | **10.6.2** |
| typescript | `^5.8.3` | **5.9.3** |

Next 15.5.29 also depends on a nested `postcss@8.4.31`. See the audit finding in section 7.

### Routing

App Router with one route.

| URL | File | Behavior |
|---|---|---|
| `/` | `app/page.jsx` | Client component chooses a screen from React state `page`. |
| (implicit) | Next `_not-found` | Default not-found page. Confirmed by the production build output. |

There are no `/login`, `/leads`, or `/settings` URLs. The sidebar writes ids such as `command`, `agents`, `inbox`, `preferences`. Refresh keeps the signed-in flag and the data store, but the selected screen resets to Command Center because `page` is not persisted.

`layout.jsx` is a Server Component. `SalesOS` and `Enterprise` are `'use client'`. The whole product UI is client-rendered.

### Dependency and tooling gaps

- No data-fetching library, no Zod, no auth library.
- Tailwind content config will not see a future `apps/web` TypeScript tree until the glob is updated.
- `next.config.mjs` does not set security headers, image domains, or a rewrite to an API.
- Dev and start bind `0.0.0.0`. That is convenient for a demo and too open as a production default.

## 4. Local state architecture

One React tree owns all product state.

```text
SalesOS
  useState(store)          seeded from components/data.js + initialEnterprise()
  useState(signedIn)       sessionStorage or localStorage flag
  useState(page)           sidebar screen id
  useState(selected*)      agent, run, lead, message, meeting
  useState(search, filter, period, tab, modal, toast, draft)
  Enterprise               reads store.enterprise and writes it back through change()
```

Persistence:

| Key | Storage | Contents |
|---|---|---|
| `salesos-prototype-v2` | `localStorage` | Entire store, including enterprise settings, threads, and masked connector fields. |
| `salesos-auth-demo` | `sessionStorage` | String `active` after demo sign-in. |
| `salesos-auth-demo-remember` | `localStorage` | String `active` when "Remember me" is checked. |

Hydration merges saved JSON over a fresh seed. Unknown future fields survive only if they were saved. There is no schema version migration beyond the key name.

Mutations are local:

- `change(key, value)` replaces a top-level store key.
- `update(key, id, patch)` maps an array by `id`.
- `log()` prepends an activity row and a synthetic `RUN-2xxx` execution.
- Enterprise `track()` prepends an audit row capped at 120 entries.
- `DynamicForm` keeps field state inside the modal and submits plain objects.

There is no context provider, reducer, URL sync, optimistic server update, or error boundary.

### State that looks shared but is not

- Settings "Active workspace" changes the label `store.tenant` among `Code Colonies`, `Northstar Demo Tenant`, and `Sample Agency Workspace`. Leads, messages, users, and connectors do not change.
- AI model select stores a label. No client is constructed.
- Analytics period buttons store `7 days` / `30 days` / `90 days`. Chart data is a fixed array.
- Command Center "Qualified leads" is `count(stage === Qualified) + 44`. Other KPI tiles use fixed strings (`1,248`, `312`, `18`).
- Currency is always `₹` via `en-IN`, independent of the preference currency field.
- Meeting action-item checkboxes call `notify` only. Checked state is not written to the store.
- SSO checklist checkboxes are uncontrolled and are not saved.
- WhatsApp "insights" numbers (`142`, `109`, `14`, `6`) are literals.

## 5. Screen inventory

Sidebar order in `components/SalesOS.jsx`:

| Screen id | Label | Owner file |
|---|---|---|
| `command` | Command Center | `SalesOS.jsx` |
| `agents` | AI Agents | `SalesOS.jsx` |
| `inspector` | Execution Inspector | `SalesOS.jsx` |
| `leads` | Lead Discovery | `SalesOS.jsx` |
| `campaigns` | Campaigns | `SalesOS.jsx` |
| `inbox` | AI Conversations | `SalesOS.jsx` |
| `qualification` | Qualification | `SalesOS.jsx` |
| `meetings` | Meetings & Notes | `SalesOS.jsx` |
| `approvals` | Approval Center | `SalesOS.jsx` |
| `analytics` | Analytics | `SalesOS.jsx` |
| `products` | Products & Services | `SalesOS.jsx` |
| `preferences` | Preferences | `Enterprise.jsx` |
| `security` | Security Center | `Enterprise.jsx` |
| `sso` | SSO & Authentication | `Enterprise.jsx` |
| `users` | Users & Roles | `Enterprise.jsx` |
| `integrations` | Integrations | `Enterprise.jsx` |
| `whatsapp` | WhatsApp AI | `Enterprise.jsx` |
| `webhooks` | Webhooks | `Enterprise.jsx` |
| `audit` | Audit Logs | `Enterprise.jsx` |
| `settings` | AI & Workspace Settings | `SalesOS.jsx` |

Auth is a gate in front of the shell, not a menu item: login, forgot password, reset preview, MFA, SSO preview (`EnterpriseAuth`).

Figma register under `sales-os-docs/` also contains mobile boards (`M01`–`M06`), an end-to-end journey (`F01`), and per-agent boards (`G01`–`G11`). The running prototype folds agent boards into one Agents screen and does not ship separate mobile routes. Responsive CSS exists for the desktop shell.

## 6. Simulated features and buttons

Nothing in this list performs a network request. Confirmation: source search of `app/` and `components/` shows no `fetch(`. Toasts and audit rows are the only "results".

### 6.1 Authentication (demo)

| Control | Actual behavior |
|---|---|
| Sign in | Requires an email containing `@` and a password of at least 8 characters. Password is not checked, hashed, or stored. |
| Remember me | Writes a local flag. It is not a session token. |
| Forgot password | Shows the same confirmation for any address. Sends no email. |
| Reset password | Compares the two fields in the browser. No token, no stored credential. |
| MFA | Any six characters. Not TOTP. |
| Google / Microsoft / other SSO | Selects a label, then continues to the same MFA screen. No redirect, state, nonce, or PKCE. |
| Sign out | Removes the local flags and appends a demo audit row. |

### 6.2 Command Center

| Control | Actual behavior |
|---|---|
| Run AI cycle | If supervisor is on, appends an activity row and a completed run. No job is queued. |
| Pause / Resume Supervisor | Flips `store.supervisor`. Does not stop a worker. |
| Agent tiles, inspector, approvals links | `navigate()` only. |

### 6.3 AI Agents

| Control | Actual behavior |
|---|---|
| Select agent | Local selection among eight seed roles. |
| Enable switch | Flips `agents[].enabled`. |
| Test agent | Appends a simulated run. Disabled when the agent is paused. Does not call a model. |

The eight roles are Supervisor, Research, Outreach, Conversation, Qualification, Meeting, Meeting Intelligence, and Follow-up & Insights. Objectives, tools, and guardrails are seed strings.

### 6.4 Execution Inspector

| Control | Actual behavior |
|---|---|
| Status filters | Filter the in-memory run list. |
| Copy details | `navigator.clipboard.writeText` of the run JSON. |
| Replay simulation | Appends another local run. Does not re-execute steps. |
| View policy approvals | Navigation. |

### 6.5 Lead Discovery

| Control | Actual behavior |
|---|---|
| Search and stage filter | Client filter over eight fictional companies on `.example` domains. |
| Run AI research | Log + toast. No search provider. |
| Mark engaged | Sets `stage` to `Engaged`. |
| Prepare pitch / Queue for approval | Builds a template string and inserts a `Pending` approval. Nothing is sent. |

### 6.6 Campaigns

| Control | Actual behavior |
|---|---|
| New campaign | Inserts a `Draft` with owner `Maya Patel`. |
| Configure | Edits name, market, ICP, cadence locally. |
| Activate / Pause | Toggles `Active` and `Paused`. No policy check and no send. |

### 6.7 AI Inbox

| Control | Actual behavior |
|---|---|
| Generate contextual draft | Fills the textarea from `requirements` strings. |
| Human handoff | Sets status `Escalated`. |
| Send (demo) | Appends the textarea to the local thread. Toast states that no email was sent. |
| Prepare meeting | Opens the schedule modal. |

### 6.8 Qualification

| Control | Actual behavior |
|---|---|
| Score factors | Fixed points (`+24/+23/+20/+10/+10`), not computed from the lead. |
| Mark qualified | Sets stage `Qualified`. |
| Request meeting | Opens the schedule modal. |

### 6.9 Meetings

| Control | Actual behavior |
|---|---|
| New meeting | Inserts an `Upcoming` record. No calendar provider. |
| Transcript / AI Notes / Action Items | Renders seed text. Empty transcript shows an explicit empty state. |
| Task checkbox | Toast only. |
| Add action item | Appends a string on the meeting. |
| Prepare follow-up | Activity log only. |

### 6.10 Approvals

Approve and Reject set `status` and append a run. Approval does not enqueue an external action.

### 6.11 Analytics

Period switch changes the subtitle. Bars, rates (`14.7%`, `5.2%`, `3.8%`), and warnings are static. "Actions requiring review" is the only live count (pending approvals).

### 6.12 Products

| Control | Actual behavior |
|---|---|
| Add offering | Appends a local product. |
| Create campaign | Opens the campaign modal. |
| Knowledge base | Toast: production would open a knowledge base. No documents exist. |

Seed offerings: Sales Automation, Workflow Automation, Privacy Operations. These are demo catalogue rows, not code branches, but owners, currency, timezone, and the greeting are Code Colonies-specific literals.

### 6.13 Preferences, security, users

All writes stay in `store.enterprise` and append audit rows.

- Preference theme is stored. CSS stays on the light theme. The UI says so.
- Security toggles (MFA required, SSO-only, session length) are not enforced on the demo login.
- Revoke session removes a fictional row. It does not revoke a token.
- Invite user checks for `@` and inserts `Invited`. No email is sent.
- Role dropdown and permission checkboxes update local arrays. The shell never reads them to hide a menu.

### 6.14 Integrations, webhooks, WhatsApp, SSO, audit

Connector manifest (nine adapters): Gmail, SMTP/IMAP, Microsoft 365, Google Calendar, WhatsApp Business Cloud API, HubSpot, Salesforce, custom REST, Ollama/LLM.

| Control | Actual behavior |
|---|---|
| Save connector | Non-secret fields are stored. Password fields become the string `•••••• (demo placeholder)`. Status is forced to `Unverified`. |
| Test connection | Toast. No socket. |
| Advanced property | Any key/value is stored in the connector config, including a value that a user might paste as a secret. |
| Add webhook | Client-side `https:` URL check. No DNS or allowlist. |
| Test webhook | Toast. No HTTP request. |
| WhatsApp bot test | Keyword script: "price", "meet"/"demo", or a generic reply. Not an LLM. |
| Template / opt-in actions | Local list edits. No Meta API. |
| SSO save / test / disable | Local provider objects. Test does not contact an IdP. |
| Export CSV | Builds a Blob from the in-memory audit list and downloads it. The list is client-mutable. |

## 7. Commands executed in this audit

| Command | Result |
|---|---|
| `npm install` | Exit 0. Reported "added 1 package, and audited 104 packages". `package-lock.json` timestamp updated at 12:55 local time. Application source was not edited by this command. |
| `npm run check:source` | Exit 0. TypeScript parser reported `PASS syntax` for the eight source/config files and `PASS source syntax and feature presence checks`. This is a syntax and string-presence smoke test, not a typecheck. |
| `npm run lint` | Exit 1. `Missing script: "lint"`. ESLint is not installed. No ESLint config file exists. |
| `npx --no-install tsc --noEmit --pretty false` | Exit 1. TypeScript 5.9.3 printed compiler help because there is no `tsconfig.json`. It did not type-check `SalesOS.jsx` or `Enterprise.jsx`. |
| `npm run build` | Exit 0. Next.js 15.5.29 compiled successfully in about 4.1s. Static pages generated: `/` (202 kB route, 304 kB first load) and `/_not-found`. The log line "Linting and checking validity of types" appeared and the build continued. That line is not evidence of an ESLint run or a strict `tsc` project check, because neither is configured. |
| `npm audit` | Exit 0 with vulnerabilities reported (npm audit uses exit 0 here). 1 high, 1 moderate. See below. |
| `npm ls postcss --all` | Direct `postcss@8.5.32`. Nested `next/node_modules/postcss@8.4.31`. |
| Browser E2E, unit tests, load tests | **Not run.** No test suite exists. Do not treat the production build as behavioral acceptance. |

`npm run dev` was already running in another terminal when `npm run build` wrote `.next`. Restart the dev server if the running session looks stale.

### npm audit detail

`npm audit` reported:

- **high** — `postcss <=8.5.22`, via the nested copy at `node_modules/next/node_modules/postcss` (`8.4.31`). Advisories cited by npm: GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849.
- **moderate** — `next` `9.3.4-canary.0` through `16.3.0-preview.10`, because that range depends on the vulnerable nested PostCSS. Installed Next is 15.5.29.

`npm audit fix --force` proposes installing `next@16.4.5`, which is a breaking upgrade. This audit did not apply that upgrade. The direct PostCSS 8.5.32 dependency is outside the `<=8.5.22` range npm printed; the finding is the nested 8.4.31 copy.

Prototype exposure is limited: the app does not accept attacker-controlled CSS as a PostCSS pipeline. The finding still blocks a production dependency policy until Next no longer vendors the affected PostCSS or the advisory is re-evaluated against 15.5.29.

## 8. Code observations that matter for the rewrite

1. **Design is the product surface.** Replacing `SalesOS.jsx` with a new visual system would throw away the prototype. The safe move is to keep the components and feed them from an API client.
2. **Company logic is data, except for a few literals.** Scoring, outreach, and qualification do not branch on "Privacy Operations" or "Code Colonies". Hardcoding that must be removed is the seed, the `₹` formatter, default emails, owner names, the "Good morning, Founder" title, and the three fake tenant labels.
3. **Permissions are decorative.** `canEditRoles` in `Enterprise.jsx` is unused. `log` is passed into `Enterprise` and unused. `selectedUser`, `copyStatus`, and `integrationsHealth` are unused or never rendered. Menu entries are visible to every demo user.
4. **Audit rows are editable client state.** They cannot be compliance evidence.
5. **Secrets can reach `localStorage`.** Password fields are masked on save, but the advanced connector property stores arbitrary text, and the whole store is JSON in `localStorage`.
6. **Ids are mixed.** Leads and meetings use numbers. Messages use strings. Runs use `RUN-1042`. Production ids should be UUID, with the UI still able to show a short public code.
7. **Reference schema is ahead of the UI and behind the enterprise screens.** `schema.sql` covers tenants, products, leads, messages, agent runs, meetings, and RLS. It does not yet model sessions, MFA, SSO providers, preferences, webhook deliveries, or a step log. `openapi.yaml` covers a subset of the BRD route table.
8. **Duplicate design packs** (`SalesOS_Figma_Design` and `SalesOS_Figma_Design 2`) are reference assets. They are not a second application.

## 9. Fitness for the target architecture

| Target requirement | Prototype today |
|---|---|
| Strict tenant isolation | Label switch only. One shared store. |
| Authentication and RBAC | Demo flag. Roles not enforced. |
| Audited external actions | Local audit array. No external actions. |
| Persistent agent runs | `localStorage` runs. Lost if storage is cleared. Replay does not resume work. |
| Pause, resume, retries | Supervisor boolean. No queue, no retry, no dead letter. |
| Deterministic approval policies | Buttons set status. No policy function. |
| Encrypted integration credentials | Placeholder string in the browser. |
| Configurable products, ICPs, workflows | Forms edit seed rows. No versioned knowledge. |
| Pluggable LLM | Select box of disconnected adapter names. |
| No hardcoded company or product logic | Mostly true in control flow. False in seed content and a few formatters. |

## 10. Recommended reading order for the plan

1. This audit.
2. `docs/ARCHITECTURE.md` — monorepo, runtime, tenancy, agents.
3. `docs/DATABASE_DESIGN.md` — relational model and RLS.
4. `docs/SCREEN_API_MAPPING.md` — which screen replaces which simulation.
5. `docs/IMPLEMENTATION_PLAN.md` — phased tasks.
6. `docs/SECURITY_CHECKLIST.md` — controls that gate each phase.

The BRD remains the requirements baseline (FR, NFR, AT, ADR). Where this plan names packages, it follows the requested monorepo (`packages/database`, `packages/shared`, `packages/agent-core`, `packages/integrations`) and maps the BRD package names onto those four.
