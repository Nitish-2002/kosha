# Kosha — Technical Requirements Document

See [PRD](PRD.md) for the product/feature spec this implements.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React (Vite) + SCSS |
| Backend | NestJS |
| Auth | Google OAuth (Passport strategy) + email whitelist, JWT in an httpOnly cookie |
| Metadata DB | PostgreSQL (TypeORM, migration-based — `synchronize` off in every environment) |
| Secret storage | AWS S3 (versioned, source of truth for S3-backed environments) |
| Second source | GitHub-hosted Helm charts (read-only, for EKS-deployed projects) |
| Notifications | Google Chat webhook + in-app bell/notifications page |

## Architecture

Two data planes, one metadata store:

- **PostgreSQL** holds everything about *who can do what* and *what happened*: users, roles, projects, environments, component connection configs, credential references, assignments, variable metadata (Secret flags), audit log, delete/rollback requests. It never holds a secret's actual value.
- **S3** holds the actual `.env` content for S3-backed components, one object per component per environment, versioned. This is the real source of truth for values; Postgres only stores the pointer (bucket/region/key/credential id) plus the Secret flags for that key set.
- **GitHub** is read from directly at request time for GitHub-backed components — Kosha fetches the ConfigMap/Secret manifest at the configured path/branch and parses out keys (and, for ConfigMaps only, values). Nothing from GitHub is persisted beyond a short-lived read-through cache.

Credentials (AWS access key/secret, or GitHub PAT) are stored once in a `credentials` table, encrypted at rest, and referenced by id from any number of environment/component configs. No credential value is ever duplicated into an environment config.

## Data model

Entities as introduced in [PRD — Core entities](PRD.md#core-entities); this is the technical shape.

- **User** — id, email, role (`admin` | `member`), status (`active` | `pending` | `deactivated`), current refresh-token id (for single-session enforcement), timestamps.
- **Credential** — id, type (`aws` | `github`), encrypted secret material (access key/secret key, or PAT), a display label, created-by, timestamps. Admin-managed only.
- **Project** — id, name, description.
- **ProjectComponent** — id, project id, name. Normalized out of `Project` specifically so `EnvironmentComponentConfig` can hold a real foreign key to it (see below) instead of a free-text column that could drift.
- **Environment** — id, project id, name.
- **EnvironmentComponentConfig** — id, environment id, **project component id (FK, `ON DELETE RESTRICT`)**, source type (`s3` | `github`), and:
  - if `s3`: bucket, region, credential id, optional key override.
  - if `github`: repo, branch, credential id, configmap path, secret path.
  - One row per (environment, project component) — this is what replaced the earlier one-connection-per-environment model. The FK to `ProjectComponent` (rather than a component name string) is what makes the PRD's "component picked from a dropdown, never free text" rule a DB-level guarantee rather than a UI-only convention — the database itself refuses an orphaned config, and refuses to let a component be deleted from a project while a config still points at it.
- **ProjectAssignment** — id, user id, project id, environment id (nullable = all environments in project), project component id (nullable = all components) — nullable fields widen scope, not narrow it.
- **VariableMetadata** — id, environment component config id, key, `isSecret` boolean, last-changed-by (user id). S3-sourced only. The `isSecret` field is only ever written by a request that has passed an Admin-only guard — there is no code path, including the general variable-update endpoint, that lets a Member's request change it.
- **AuditLog** — id, user id, project id, environment id, component name, action (`create` | `update` | `delete` | `rollback` | `reveal` | `import`), key (nullable for bulk actions), metadata (jsonb, e.g. old/new version ids), timestamp. Append-only — no update/delete endpoint on this table, ever.
- **DeleteRequest** / **RollbackRequest** — id, requester id, target (project/environment/component/key), type-specific payload (e.g. target version id for rollback), status (`pending` | `approved` | `rejected`), reviewer id, reviewer note, timestamps. Approval/rejection reads only the requester id stored here, never a live join against `User.status` — so a request from a since-deactivated user is still fully actionable.

## Security model

- **AuthN**: Google OAuth via Passport; on callback, look up email in the whitelist table. Not found → create/update a `pending` access request, notify Admins, redirect to a "request pending" page — no JWT issued. Found → issue a 15-minute access JWT and a 1-day refresh token, both as httpOnly (+ `Secure`, `SameSite=Lax`) cookies.
- **Session policy**: only one active session per user. Issuing a new refresh token (a fresh login) overwrites `User.currentRefreshTokenId`, which immediately invalidates any refresh token from a prior session — so signing in on a second device signs the first one out. Logout clears both cookies and the stored refresh-token id server-side.
- **Credential deletion**: before deleting, the endpoint returns the list of `EnvironmentComponentConfig` rows referencing that credential id so the UI can warn the Admin; the delete itself is unconditional (no FK `RESTRICT` on `Credential`, unlike `ProjectComponent`) — Kosha doesn't try to detect whether the credential's underlying AWS/GitHub access is "still needed" by a live deployment, only whether Kosha itself references it.
- **AuthZ**: every request handler resolves the caller's role and, for Members, their `ProjectAssignment` rows, before touching data. A Member request for a project/environment/component outside their assignments is a 403, not a filtered 200.
- **Secret masking**: enforced in the service layer, not the controller or frontend. Any DTO that could carry a variable value passes through a masking step keyed off `VariableMetadata.isSecret` (S3) or is structurally excluded (GitHub Secret manifests — key names only, ever, regardless of role). A Member's response never contains the real value, in any endpoint — table fetch, diff, history, or export.
- **Credential isolation**: credential secret material is only ever decrypted server-side, at the moment of an S3/GitHub API call, and never included in any API response — not even to Admins in the general project/environment views. Viewing raw credential material (if ever needed) would be its own explicit, audited action.
- **Destructive-action gating**: the delete/rollback endpoints check role first. Admin → executes and logs directly. Member → writes a `DeleteRequest`/`RollbackRequest` row instead of touching the target, and returns 202. There is exactly one code path for each destructive action; the role check happens inside it, not by having two separate endpoints a client could pick between.

## Retention

- **Audit log**: rows older than 7 days are purged (scheduled job / Postgres partition + `DROP` on a 7-day cadence).
- **S3 version history**: an S3 lifecycle rule on each versioned bucket expires noncurrent versions after 7 days.

Both numbers are configuration, not hardcoded logic — set via environment config so they can be revisited without a code change if compliance needs change.

## Non-functional requirements

- **No `synchronize: true`, ever** — all schema changes are TypeORM migrations, reviewed and applied explicitly.
- **Idempotent imports** — re-running the same `.env` paste against the same target should not create duplicate `create` audit entries where nothing actually changed (a no-op diff should not be logged as a write).
- **Read paths must not depend on S3/GitHub being reachable to enforce masking** — masking decisions come from Postgres (`VariableMetadata`) before the value is even fetched, so a misbehaving external call can't accidentally leak an unmasked value by skipping the masking step.
- **Notifications are best-effort** — a failed Google Chat webhook call must not block the underlying action (a request is still created/approved even if the Chat notification fails; the in-app notification is the source of truth).

## Deployment shape

Kosha itself runs as a standard NestJS + Postgres + React/Vite app (containerized, deployable to Divami's own infrastructure). It does not need to run inside every client's environment — it reaches into a client's AWS account only via the access-key/secret-key credential configured for that connection, and into a client's GitHub repo only via the configured PAT. Kosha's own hosting is independent of the projects it manages.
