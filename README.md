# Kosha

Centralized environment-variable manager for Divami's client and internal projects.

Replaces `.env` files sitting unmanaged on servers/S3 — with no access control, no audit trail, and every routine change dependent on the DevOps team — with a single system where access is scoped per person, destructive actions require Admin approval, and every action is attributed to a user and a timestamp.

## Docs

- [Vision](docs/VISION.md) — why this exists, guiding principles
- [BRD](docs/BRD.md) — business problem, goals, scope
- [PRD](docs/PRD.md) — roles, features, entities
- [TRD](docs/TRD.md) — architecture, data model, security model
- [HLD](docs/HLD.md) — system architecture, module boundaries, key flows
- [LLD](docs/LLD.md) — database schema (ER diagram) and full API contract

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React (Vite) + SCSS |
| Backend | NestJS |
| Auth | Google OAuth (Passport) + email whitelist, JWT in httpOnly cookie |
| Metadata DB | PostgreSQL (TypeORM, migrations only) |
| Secret storage | AWS S3 (versioned) |
| Second source | GitHub-hosted Helm charts (read-only) |
| Notifications | Google Chat webhook + in-app notifications |

## Status

Implemented — every feature in [PRD](docs/PRD.md) is built (project/environment management, variable table, bulk import, environment compare, version history & rollback, the delete/rollback approval workflow, audit log, credentials, members, notifications).

## Getting started

1. Postgres running locally, database created (see `DATABASE_URL` below).
2. `cd backend && cp .env.example .env` — fill in your own Google OAuth, DB, and encryption values — then `npm install && npm run migration:run && npm run start:dev`.
3. `cd frontend && cp .env.example .env && npm install && npm run dev`.

Backend serves the API on `PORT` (default 3000); frontend runs on Vite's dev server (default 5173). `backend/.env`'s `FRONTEND_URL` is comma-separated if you need more than one origin allowed (e.g. a dev port that isn't the default).
