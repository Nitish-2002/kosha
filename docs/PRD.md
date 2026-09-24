# Kosha — Product Requirements Document

See [BRD](BRD.md) for the business problem and [VISION](VISION.md) for the guiding principles this product is built around.

## Roles

Exactly two roles. No per-project owner tier, no read-only auditor tier — those are handled by scoping an Admin or Member's assignments, not by adding roles.

| Role | Can do |
|---|---|
| **Admin** | Sees and edits everything across all projects and all client/Divami AWS accounts — Admin is always global, never scoped per-client. Direct (non-approval) delete and rollback. Manages users, the whitelist, projects, environments, and credentials. Approves/rejects Member delete and rollback requests. |
| **Member** | Scoped to explicitly assigned project + environment (+ component) combinations. Can view and edit non-Secret variables within scope, and add new variables. Can never see or edit the *value* of a Secret-flagged variable. Cannot delete or roll back directly — must submit a request for Admin approval. |

## Authentication & access

- Sign-in is Google OAuth only.
- On successful OAuth, the backend checks the signed-in email against a whitelist.
  - **Whitelisted:** a JWT is issued in an httpOnly cookie; the user lands in the app with whatever role/assignments an Admin has already configured for them.
  - **Not whitelisted:** the sign-in is held as a **pending access request** instead of granting entry. Admins are notified via Google Chat webhook and the in-app notifications page. An Admin approves (choosing role + initial assignments) or rejects the request. The requester is notified of the outcome.
- No self-service role escalation: a Member can never grant themselves Admin, additional project assignments, or Secret visibility.

## Core entities

(Full technical schema in [TRD — Data Model](TRD.md#data-model); this section describes what each entity means to a user.)

- **Project** — name, description, and a free-form list of components (e.g. `ai-service`, `frontend`, `backend`). A project is the top-level container both for client work and internal Divami tools.
- **Environment** — belongs to a project (`dev`, `qa`, `hotfix-aug`, or anything else a project needs). Each **component** within an environment has its own independent connection — either to S3 or to GitHub — because real projects routinely spread their components across different buckets and repos rather than sharing one per environment. A component connection can only be set up for a component already declared on the Project — picked from a dropdown, not typed freely — so an environment config can never drift from or typo past the project's declared component list.
  - **S3 connection**: bucket, region, credential (selected from whichever access-key/secret-key credentials are saved in the Credentials tab — Divami's own or a client's, they're just entries in the same list), optional key override.
  - **GitHub connection**: repo, branch, credential (a PAT saved in the Credentials tab), path to the ConfigMap manifest, path to the Secret manifest.
- **ProjectAssignment** — scopes a Member to specific project + environment (+ component) combinations. This is the unit of delegation: an Admin assigns exactly the surface area a Member needs.
- **VariableMetadata** — marks which keys are Secret. Only meaningful for S3-sourced environments, since GitHub-sourced secrecy is structural (see below). **Only an Admin can set or change a key's Secret flag** — a Member can add a new variable, but it's created non-Secret by default, and neither flagging it Secret nor un-flagging an existing Secret is something a Member can do. This closes the obvious loophole of a Member un-flagging a Secret to read it.
- **AuditLog** — append-only. Every create, update, delete, rollback, reveal, and import is recorded with user, project, environment, key, and timestamp.
- **Credential** — a saved AWS access key/secret key pair, or a GitHub PAT, managed by Admins only in the Credentials tab. Referenced by id from environment/component configs — never inlined, never duplicated per environment. When configuring an S3 or GitHub connection, the UI lists every saved credential of the matching type to pick from. Deleting a credential warns the Admin first, listing every environment/component config that references it — it's still a plain delete after that, not a hard block; Kosha doesn't auto-migrate or fix up the affected configs.
- **DeleteRequest / RollbackRequest** — a Member's request for a destructive action, held pending Admin approval or rejection.

## Features

### 1. Project & environment management
- Admins create/edit/archive projects, including the component list.
- Admins create/edit/delete environments within a project, and configure each component's connection (S3 or GitHub) independently, picking a credential from the Credentials tab.
- Admins assign Members to project + environment (+ component) combinations; a Member sees only what they're assigned to.

### 2. Variable table view
- Table of key/value pairs for a selected project + environment + component.
- Secret-flagged values are masked (`••••••••`) everywhere they could appear: the table, the edit form, the diff view, and version history. This is enforced server-side — masked values are never sent to the client in the first place, not hidden client-side.
- Members can view and edit non-Secret values within their assignment; they cannot see a Secret's value under any circumstance, including in history.
- Admins can reveal a Secret's value on demand; every reveal is written to the audit log.

### 3. Bulk `.env` import
- Paste or upload a `.env`-formatted block against a target project + environment + component.
- The importer dedupes keys, strips `export ` prefixes and surrounding quotes, and shows a preview before committing.
- If a Member imports into an environment that already has Secret-flagged keys, those keys are protected from being silently overwritten by the import — the import cannot touch an existing Secret's value without Admin action.

### 4. Environment comparison / diff
- Pick two project+environment(+component) targets and see keys that differ, that exist only on one side, or that are missing.
- Secret values are masked in the diff exactly as they are in the table.
- One-click "add to environment" copies a missing key (and, for non-Secret keys, its value) from one side into the other.

### 5. Version history & rollback
- Every change to an S3-backed environment is a new S3 object version — history is never destroyed.
- Members and Admins can view version history for a key or a whole environment file.
- Rolling back **creates a new version** with the old content; it never deletes intervening history.
- A Member rolling back submits a **RollbackRequest**; an Admin must approve it before it executes. Admins can roll back directly.
- Version history is retained for 7 days (see [TRD — Retention](TRD.md#retention)).

### 6. Delete / rollback approval workflow
- Any delete (of a variable, environment, or project) or rollback initiated by a Member creates a pending request instead of executing immediately.
- Admins see pending requests in-app and via Google Chat notification, and approve or reject with an optional note.
- The requester is notified of the outcome. Approved requests execute and are logged with both the requester and the approver.

### 7. Audit log
- `/audit-log`, Admin-only.
- Every create/update/delete/rollback/reveal/import is a row: who, what project/environment/key, what action, and when.
- Filterable by project, user, action type, and date range.
- Retained for 7 days (see [TRD — Retention](TRD.md#retention)).

### 8. EKS/GitHub read-only source
- A project whose components are deployed via Helm to EKS can point a component's connection at a GitHub repo instead of S3, referencing the paths to the rendered ConfigMap and Secret manifests.
- This path is **read-only by design**: Kosha never writes to the repo, and never calls AWS Secrets Manager or any live cluster API.
- For GitHub-sourced Secret manifests, only **key names** are ever surfaced — values are never fetched, never stored, never displayed. This makes GitHub-sourced secrecy structural rather than a flag someone has to remember to set.

### 9. Credential management (Admin-only)
- The Credentials tab lists every saved credential — AWS (access key/secret key) or GitHub (PAT) — by label and type. Raw secret material is write-only through the UI: once saved, it's never redisplayed, only replaced.
- Admin can add, edit (rotate the underlying key/PAT), and delete a credential.
- Deleting a credential first shows which environment/component configs reference it (see [Core entities — Credential](#core-entities)), then proceeds as a plain delete — no automatic fix-up of the configs left pointing at it.

### 10. Members / users management (Admin-only)
- A global **Members** tab, structured the same way as the Credentials tab: one flat list of every user, independent of any single project.
- From here an Admin can change a user's role, view/edit their `ProjectAssignment`s, deactivate/reactivate a user, and manage the whitelist (add/remove emails) and pending access requests — all in one place, instead of scattered across the sign-in flow.
- Deactivating a user blocks their login immediately (their refresh token is invalidated) but leaves their existing `ProjectAssignment`s and audit history untouched, as a historical record. Reactivating restores their prior assignments rather than starting from a blank slate.
- Any Delete/RollbackRequest a now-deactivated user had filed stays visible and actionable by an Admin — approving or rejecting it never depends on the requester's account still being active.

### 11. Notifications
- In-app bell + Google Chat webhook, covering three kinds of events:
  1. A non-whitelisted sign-in creates a pending access request → notifies Admins.
  2. A Member submits a Delete or Rollback request → notifies Admins.
  3. An Admin approves or rejects a request → notifies the original requester.
- Read in full on the in-app notifications page; the Chat webhook is a best-effort mirror of the same events (see [TRD — Non-functional requirements](TRD.md#non-functional-requirements)).

## Session policy

- JWT access token: 15-minute expiry.
- Refresh token: 1-day expiry.
- **Single active session per user** — logging in on a new device invalidates the previous session's refresh token, so only one device can be signed in at a time.

## Non-functional requirements

- **Secret values never reach a Member's API response, period.** Not truncated, not redacted client-side after fetch — the backend excludes the value from the payload entirely for any request made as a Member. This applies to every read path: table, edit form, diff, history, export.
- **No anonymous or shared actions**: every write is tied to the authenticated user's identity via the JWT, never a service account or shared login.
- **Consistent behavior across AWS accounts**: an S3 connection's behavior in Kosha doesn't depend on whose AWS account the credential belongs to — Divami's and a client's credentials are used identically, they're just different entries in the Credentials tab.
- **No destructive path bypasses approval**: there is no UI or API route that lets a Member delete or roll back without going through a request.

## Visual design

- **Palette: red and black.** No other brand color scheme.
- **Mobile responsive.** Every screen — including the variable table, diff view, and audit log — must be usable at phone width, not just desktop.

## Retention

- Audit log entries: retained 7 days.
- S3 object version history: retained 7 days (via S3 lifecycle rules on the versioned bucket).
