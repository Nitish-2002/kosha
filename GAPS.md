# Known gaps

Not security holes (those were reviewed — access control, JWT, mass-assignment, SQL injection, XSS, and credential-leak attempts all held up). These are completeness/robustness/ops gaps found during review.

## Feature completeness

- **No Member-facing "my requests" page.** `GET /requests/mine` works on the backend; no frontend page calls it. A Member can't check their delete/rollback request's status except via the notification bell.
- **Pending-request badges only show a Member their own requests.** A second Member's attempt on the same item is still blocked (409, one-pending-per-target unique index), but they only learn that on click.

## Robustness

- Malformed UUID in a path param (e.g. `/environments/not-a-uuid/components`) returns a raw 500 instead of a clean 400. No data leak, just an unhandled case — needs `ParseUUIDPipe` on the relevant params.

## Process / ops

- **Near-zero test coverage.** Only 2 spec files (`auth.service`, `crypto.service`) across ~15 backend modules; frontend has none. Everything else was verified by live manual/Playwright testing this session, not a regression-proof suite.
- **No CI/CD.** No `.github/workflows` — build/lint/`npm audit` aren't enforced automatically on push.
- **No Dockerfile.** TRD says "containerized, deployable," but no container artifact exists in the repo.
- **No health-check endpoint** for a load balancer/orchestrator to probe.
- **No audit-log retention job.** TRD/LLD describe a scheduled 7-day purge of `audit_logs`; nothing implements it yet.
