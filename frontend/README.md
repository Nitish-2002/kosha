# Kosha frontend

React (Vite) app for Kosha, Divami's centralized environment-variable manager. See the root [README](../README.md) and [docs/](../docs/) for the product spec; this file is just the frontend's own map. Conventions and non-negotiables live in [../CLAUDE.md](../CLAUDE.md).

## Stack

React + Vite + SCSS. No CSS-in-JS, no component library — every shared UI element (`Select`, `DatePicker`, `ConfirmDialog`, ...) is hand-built in `components/`. Red-and-black palette throughout (one scoped exception: green/red status coloring on the environment-compare page — see CLAUDE.md).

## What's implemented — one page per PRD feature

| Page | Route | What it does |
|---|---|---|
| `LoginPage` | `/login` | Google sign-in |
| `PendingPage` | `/pending-approval` | Shown to a signed-in user not yet on the whitelist |
| `HomePage` | `/` | Landing page — your projects at a glance |
| `ProjectsPage` | `/projects` | Full project list, search/sort, create/archive/delete (Admin) |
| `ProjectDetailPage` | `/projects/:id`, `/projects/:id/environments/:envId` | Components, environments, the variable table itself (CRUD, Secret masking, history/rollback, bulk `.env` import) |
| `ComparePage` | `/projects/:id/compare` | Diffs two of a project's environments, one table per shared component |
| `CredentialsPage` | `/credentials` | AWS/GitHub credentials (Admin) |
| `MembersPage` | `/members` | Roles, per-project/environment/component access grants (Admin) |
| `RequestsPage` | `/requests` | Two tabs: whitelist access requests, and Members' delete/rollback requests (Admin) |
| `AuditLogPage` | `/audit-log` | Filterable, append-only action log (Admin) |

Member vs Admin visibility is enforced both here (hiding controls) and on the backend (the actual authority) — never assume the frontend check alone is what's protecting anything.

## Folder structure

```
src/
├── pages/          # one file per route (see table above)
├── components/     # shared UI reused across pages — check here before adding a new one
├── api/            # one file per backend module, thin fetch wrappers + response types
├── context/         # AuthContext (current user), ToastContext (toast notifications)
├── lib/            # small helpers (e.g. date formatting)
├── styles/         # _variables.scss (palette/tokens), global.scss
├── constants.ts    # every shared literal constant (page sizes, layout widths, option lists) — one place, not scattered
├── App.tsx         # routes
└── main.tsx        # entry point, StrictMode
```

## Getting started

```bash
cp .env.example .env   # set VITE_API_BASE_URL
npm install
npm run dev
```

Runs on Vite's dev server (default port 5173). If the backend's `FRONTEND_URL` doesn't include whatever port this actually lands on (Vite auto-increments when the default is taken), API calls will fail CORS — see the comma-separated `FRONTEND_URL` note in `backend/.env`.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check + production build |
| `npm run lint` | oxlint |
