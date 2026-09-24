# Kosha — Vision

## Why Kosha exists

Right now, every project at Divami keeps its environment variables as plain `.env` files sitting directly on app servers or in S3 buckets — no access control, no versioning discipline, no audit trail. Because only the DevOps team has direct server/bucket access, every routine environment-variable change — whether the project runs in Divami's own AWS account or a client's — has to be routed through them. DevOps ends up as a bottleneck for work that project engineers should be able to do themselves, and there's still no record of who changed what and when.

Kosha replaces that with one place to store, view, edit, and audit environment variables for every Divami project — client and internal — whether the project's infrastructure lives in Divami's own AWS account or a client's.

## Guiding principles

These four rules shape every feature decision in Kosha. If a proposed feature conflicts with one of them, the principle wins.

1. **Secure by default, not by discipline.** The system enforces correct behavior structurally — Secret values are masked everywhere they could appear, Members can't reach data outside their assignments — rather than relying on people remembering to be careful.

2. **Delegate safely.** Day-to-day work (viewing, editing, adding variables) should not require an Admin. Only actions that destroy or expose something sensitive — deletions, rollbacks, revealing a Secret — need Admin approval or Admin-only access. This is what lets Admins hand work to Members without handing over the keys to break things.

3. **Nothing happens invisibly.** Every meaningful action is attributed to a person and a timestamp, permanently. No shared logins, no anonymous changes, no silent overwrites.

4. **Same experience, any cloud.** A project hosted in Divami's AWS account and a project hosted in a client's AWS account (or deployed via Helm to a client's EKS cluster) should look and behave the same way inside Kosha. The backend integration differs; the workflow doesn't.

## Where this goes

The first version covers S3-backed secret storage and read-only GitHub/Helm-based environments, Google OAuth with a whitelist, the two-role model, and the full audit/approval workflow described in the [PRD](PRD.md). Beyond that, natural extensions include: additional secret backends (e.g. a client's own Secrets Manager, HashiCorp Vault), scheduled credential rotation, and CLI/CI integration so pipelines can pull variables from Kosha directly instead of from checked-in `.env` files. None of that is in scope for v1 — see [BRD — Out of Scope](BRD.md#out-of-scope) — but the data model (per-component connections, credential-by-reference) is deliberately shaped so those can be added without a rewrite.
