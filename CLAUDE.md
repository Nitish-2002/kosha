# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this project is

Kosha is a centralized environment-variable manager for Divami's client and internal projects — see [docs/VISION.md](docs/VISION.md), [docs/BRD.md](docs/BRD.md), [docs/PRD.md](docs/PRD.md), [docs/TRD.md](docs/TRD.md), [docs/HLD.md](docs/HLD.md) (module boundaries, key flows), and [docs/LLD.md](docs/LLD.md) (DB schema, full API contract) for full context. Read those before making architectural decisions; this file only covers conventions and non-negotiables, not the product spec.

## Non-negotiables (don't compromise these for convenience)

1. **Secret masking is server-side, always.** Never add a code path where a Secret-flagged value (S3) or a GitHub Secret manifest's value (never fetched at all) could reach a Member's API response. Masking decisions come from `VariableMetadata` in Postgres, checked before the value is fetched — not filtered client-side after the fact.
2. **Every write is attributed.** Any create/update/delete/rollback/reveal/import must produce an `AuditLog` row with the real authenticated user (from the JWT), never a service account.
3. **Members never delete or roll back directly.** Those actions always go through `DeleteRequest`/`RollbackRequest` and Admin approval. There is one endpoint per destructive action, with the role check inside it — not two endpoints a client could choose between.
4. **No `synchronize: true`.** All Postgres schema changes are TypeORM migrations, committed and reviewed.
5. **Credentials are referenced, never inlined.** AWS/GitHub credentials live once in the `credentials` table, encrypted at rest, referenced by id. Don't add a field that duplicates credential material into an environment/component config.
6. **Exactly two roles.** Don't introduce a third role or a per-project owner tier to solve a scoping problem — use `ProjectAssignment` scoping instead.
7. **Out-of-scope access is always 403, never a leaky 404/200.** A Member hitting a project/environment/component outside their assignments gets a flat 403 — the response must not hint at whether the resource exists, what it's named, or who has it.
8. **`VariableMetadata.isSecret` is Admin-only to change, always.** No endpoint — including the general variable-update path — lets a Member's request set or clear a key's Secret flag. A new variable a Member creates starts non-Secret; only an Admin flags it.
9. **One active session per user.** A fresh login invalidates the previous session's refresh token. Don't add a "stay logged in everywhere" path around this.
10. **Component references are a real FK, not a string.** `EnvironmentComponentConfig` points at `ProjectComponent` by id (`ON DELETE RESTRICT`), never a free-text component name — this is what makes "pick from the project's declared components" a database guarantee, not just a UI convention.
11. **Every API route is private by default.** Apply the auth guard globally (e.g. Nest's `APP_GUARD`), and mark the handful of public routes (`/auth/google`, `/auth/google/callback`) with an explicit `@Public()` decorator the guard checks for. New routes must be protected without anyone remembering to add a guard — a forgotten `@UseGuards()` on one controller must never be how an endpoint ends up public. If a route genuinely needs to be public, that's a deliberate, visible exception, not the default.

## Coding rules

1. **Name variables/functions for what they hold or do**, not generic placeholders (`data`, `temp`, `res`) — a reader shouldn't need to trace the value back to its source to know what it is.
2. **Reuse common components** — before adding a new UI component, check `frontend/src/components` (or equivalent shared location) for one that already does the job. Don't fork a near-duplicate.
3. **`npm run build` and lint must pass** (both frontend and backend) before considering a change done.
4. **TypeScript strict mode** on both frontend and backend — no loosening `tsconfig.json` to make an error go away.
5. **Vet every new dependency for known vulnerabilities** — run `npm audit` after install and fix (upgrade/patch) any reported vulnerability before committing. Don't add a dependency with an unresolved high/critical advisory.
6. **No `^` or `~` in package.json** — pin exact versions on every dependency to avoid drift between installs.
7. **No complex code** — favor the simplest working implementation (this is also just Ponytail — see below). If a piece of logic needs a paragraph to explain, it's a candidate for simplifying, not commenting.
8. **Every backend API call logs a console line** — each request handler (or a shared logging interceptor/middleware) should print at least method + route + user on every call, so request activity is visible in server logs regardless of the audit log.
9. **Every migration is reversible** — write a working `down()`, not just `up()`, so a bad migration can actually be rolled back.
10. **All timestamps are UTC** — stored in Postgres as UTC, logged as UTC, converted to IST only at display time in the frontend.
11. **Never commit `.env` files or real credentials** to this repo — `.gitignore` covers `.env*`. Doubly important here since Kosha's whole job is managing other projects' secrets responsibly.
12. **Display timestamps as `DD/MM/YYYY, HH:mm` IST** — a plain absolute format, no relative-time ("2 hours ago") library needed for this.
13. **Auto re-mask a revealed Secret after 30s** — an Admin's on-demand reveal shows the value, then the UI re-masks it automatically after 30 seconds (or on navigating away, whichever comes first), rather than leaving it revealed indefinitely.
14. **Revealed Secret values never persist client-side beyond the reveal** — hold a revealed value only in transient component state, never in localStorage/sessionStorage/global store, so it doesn't outlive the component or survive a refresh.

## Conventions

- Backend: NestJS, one module per bounded concern (auth, projects, environments, variables, credentials, audit, requests, request-reviews, access-requests, project-assignments, diff, notifications).
- Frontend: React + Vite + SCSS. No CSS-in-JS, no component library beyond what's already chosen without asking first.
- **Palette is red and black**, with one scoped exception: the environment-compare view's row status (added/removed/changed) additionally uses a success-green and the existing red for that purpose only, matching the reference implementation (`envvault`) — define it as its own `--color-success`/`--color-success-bg` pair alongside the red/black tokens, not scattered hex values, and don't reuse green anywhere else in the app. A second scoped exception: each environment gets an identity **dot** color (`--color-env-1`…`--color-env-8`, assigned by position via `lib/environmentColor.ts`) in the environment switcher, Settings list and Projects-list chips — dots only, never text, fills or buttons. Everywhere else stays red-and-black: define both as SCSS variables/CSS custom properties up front (base black, an accent red, and enough shades of each for text/background/border/hover states) and reuse them everywhere; don't hardcode hex values in component files.
- **Mobile responsive throughout** — every screen (including the variable table, diff view, and audit log) must work down to phone width, not just desktop. Use relative units and flex/grid wrapping; a wide table gets a horizontal-scroll container on small screens rather than breaking the page layout.
- Migrations live under the backend's TypeORM migrations directory; never hand-edit the schema in a running database.
- Retention (audit log, S3 version history) is 7 days, driven by config — see [docs/TRD.md#retention](docs/TRD.md#retention).

## Working style

This repo follows Ponytail principles: prefer the standard library and framework-native features (NestJS guards/interceptors for authz, masking, and the request-logging rule above, TypeORM migrations, native `<input>` types) over custom abstractions or new dependencies. No speculative flexibility — build what the PRD/TRD describe, not what might be needed later. If a task seems to need a new dependency, check whether NestJS, TypeORM, or the browser platform already covers it first.

When a requirement is ambiguous or contradicts the docs, ask rather than guess — this product's whole value proposition is precise access control and audit behavior, so a wrong guess there is expensive to unwind later.
