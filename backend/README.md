# Kosha backend

NestJS API for Kosha, Divami's centralized environment-variable manager. See the root [README](../README.md) and [docs/](../docs/) for the product spec; this file is just the backend's own map. Conventions and non-negotiables live in [../CLAUDE.md](../CLAUDE.md).

## Stack

NestJS + TypeORM + PostgreSQL, S3 for versioned secret storage, GitHub (read-only) as a second variable source, Google OAuth (Passport) + JWT in an httpOnly cookie for auth.

## What's implemented

Every module below is a real, working feature — nothing here is a stub:

| Module | What it does |
|---|---|
| `auth` | Google OAuth login, JWT access/refresh cookies, one active session per user |
| `users` | User records, roles (Admin/Member), deactivate/reactivate |
| `access-requests` | Whitelist queue for people who signed in but aren't a user yet |
| `projects` | Projects and their declared components |
| `project-assignments` | Per-Member scoping: which projects/environments/components they can see |
| `environments` | Environments and their wired component connections (S3 or GitHub) |
| `variables` | The variable table itself — CRUD, Secret masking, version history, bulk `.env` import |
| `requests` | `DeleteRequest`/`RollbackRequest` — a Member's destructive action becomes a pending request instead of executing |
| `request-reviews` | Admin's approve/reject queue for the above |
| `diff` | Compares two components' variables (used by the frontend's per-project environment-compare page) |
| `credentials` | AWS/GitHub credentials, encrypted at rest, referenced by id (never inlined elsewhere) |
| `audit` | Append-only log of every create/update/delete/rollback/reveal/import |
| `notifications` | In-app notifications + Google Chat webhook |

## Folder structure

```
src/
├── <module>/                  # one per row in the table above
│   ├── *.controller.ts        # routes only — no DB/business logic here
│   ├── *.service.ts           # business logic
│   ├── *.repository.ts        # DB access (TypeORM), the only place querying that entity
│   ├── *.entity.ts            # TypeORM entities
│   └── dto/                   # request validation (class-validator)
├── common/
│   ├── decorators/            # @Public(), @Roles()
│   ├── guards/                # JwtAuthGuard (global), RolesGuard
│   └── middleware/            # per-request logging
├── config/                    # env validation, DB config, comma-separated FRONTEND_URL parsing
├── migrations/                # TypeORM migrations — the only way schema changes (no synchronize:true)
├── app.module.ts
├── main.ts                    # bootstrap: global prefix /api, CORS, ValidationPipe
└── data-source.ts             # used by the TypeORM CLI only, not the running app
```

A few modules (`project-assignments`, `requests`, `environments`) register another module's entity locally via `TypeOrmModule.forFeature([...])` instead of importing that module directly — done specifically to avoid circular module imports; look for the comment explaining it wherever you see this.

## Getting started

```bash
cp .env.example .env   # fill in DB/OAuth/encryption values
npm install
npm run migration:run
npm run start:dev
```

Serves on `PORT` (default 3000) under the `/api` prefix.

## Scripts

| Command | Does |
|---|---|
| `npm run start:dev` | Dev server, watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | ESLint (`--fix`) |
| `npm run migration:generate` / `migration:run` / `migration:revert` | TypeORM migrations |
