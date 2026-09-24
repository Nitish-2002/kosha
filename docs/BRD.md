# Kosha — Business Requirements Document

## Problem statement

Divami runs many client and internal projects, each with its own set of environment variables (API keys, database URLs, third-party credentials). Today those variables live as plain `.env` files directly on app servers or in S3 buckets, with no access control, no versioning discipline, and no audit trail — anyone with server or bucket access can read or overwrite any value, and nothing records who did it or when.

On top of that, changing an environment variable — whether the project runs in Divami's AWS account or a client's — currently has to go through the DevOps team, since they're the ones with direct server/bucket access. Every routine change (a new API key, a rotated credential, a config tweak) becomes a DevOps request, making DevOps a dependency and a bottleneck for work that project engineers should be able to do themselves.

This creates four concrete business problems:

- **No access control.** Values sit unprotected on servers/S3; there's no way to scope who can see or edit what.
- **No audit trail.** If a value changes or leaks, there's no record of who changed it or when.
- **No safe delegation.** Because access isn't scoped, only DevOps (who already hold server/bucket access) can safely make changes — every project-level env change routes through them regardless of whether it needs that level of trust.
- **No recovery path.** Overwriting a value on a server or in a bucket has no built-in rollback; recovery depends on backups or memory.

## Business goals

1. Move environment-variable storage and editing out of raw servers/S3 access and into a governed system, for both Divami-hosted and client-hosted projects.
2. Let project engineers make routine environment-variable changes themselves, without going through DevOps for every change, while keeping DevOps (as Admins) in control of destructive or sensitive actions.
3. Produce a complete, tamper-evident audit trail of every access and change, sufficient to answer "who touched this and when" for any project.
4. Reduce the time-to-make a routine env change from "file a DevOps request and wait" to "make the change in Kosha, scoped to what you're allowed to touch."

## Stakeholders

| Stakeholder | Interest |
|---|---|
| DevOps team | Offload routine, low-risk environment-variable changes to project engineers without losing control over deletions, rollbacks, and secret exposure |
| Project engineers (Members) | Make the changes they need without waiting on DevOps for every request, scoped to exactly the projects/environments they work on |
| Engineering leadership / Admins | Visibility into who has access to what, and a full history of changes, across all projects |
| Clients | Their credentials are handled with the same rigor and audit trail regardless of whose AWS account hosts the infrastructure |

## Success metrics

- Zero direct server/S3 access required for routine environment-variable changes on projects onboarded onto Kosha.
- 100% of create/update/delete/rollback/reveal/import actions have an audit log entry with user, project, environment, key, and timestamp.
- Deletions and rollbacks always pass through an Admin approval step for Members — zero exceptions.
- Routine env changes on onboarded projects no longer require filing a DevOps request.

## Scope

**In scope (v1):**
- Environment variable management for S3-backed projects (Divami or client AWS accounts).
- Read-only visibility into GitHub-hosted Helm chart ConfigMaps/Secrets for EKS-deployed projects.
- Two-role access model (Admin / Member) with project+environment+component-level assignment.
- Google OAuth authentication restricted to a whitelist, with a pending-access-request flow for anyone not yet whitelisted.
- Full CRUD on projects/environments/variables, bulk import, diff/compare, version history and rollback, and an approval workflow for deletes and rollbacks.
- Complete audit log, Admin-viewable.
- Google Chat + in-app notifications for approval requests and whitelist requests.

### Out of scope

- Any write path into GitHub/Helm-managed secrets (that source is read-only by design — see [PRD](PRD.md)).
- Secret backends other than S3 and GitHub (e.g. HashiCorp Vault, a client's own Secrets Manager).
- Automated credential rotation.
- CLI or CI/CD integration for pulling variables directly into pipelines.
- Roles beyond Admin/Member (e.g. per-project owners, read-only auditors) — exactly two roles, by design.

These are candidates for later phases; see [VISION — Where this goes](VISION.md#where-this-goes).

## Risks

- **Credential handling risk:** Kosha itself becomes a high-value target since it holds references to (and, for S3, values of) every project's secrets. Mitigated by: JWT in httpOnly cookies, Secret-flag masking enforced server-side, credentials stored by reference (never inlined into environment configs), and Admin-only credential management.
- **Migration risk:** Getting existing server/S3 `.env` sprawl into Kosha depends on people actually doing the import. Mitigated by the bulk paste/upload importer, designed to make onboarding an existing project fast.
- **Whitelist bypass risk:** Google OAuth alone doesn't restrict who can attempt to sign in. Mitigated by the email whitelist plus a pending-access-request flow that requires explicit Admin approval before any access is granted.
- **DevOps handoff risk:** Moving routine changes away from DevOps means Kosha's access controls must actually hold up — if scoping or masking has a gap, the same risk DevOps exclusivity was containing reappears at a larger scale. Mitigated by making Secret-masking and scope checks structural (enforced server-side on every path), not optional.
