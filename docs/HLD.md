# Kosha — High-Level Design

See [TRD](TRD.md) for tech stack and the security/data-model decisions this design implements, and [LLD](LLD.md) for the concrete schema and API contract.

## System architecture

```mermaid
---
id: 927466c8-fbfa-4ca5-96e5-0d522aa4c049
---
flowchart LR
    subgraph Client
        FE["React (Vite) + SCSS"]
    end

    subgraph Kosha Backend [NestJS]
        AUTH[Auth Module]
        USERS[Users/Access Module]
        PROJ[Projects Module]
        ENV[Environments Module]
        VAR[Variables Module]
        CRED[Credentials Module]
        REQ[Requests Module]
        AUDIT[Audit Module]
        NOTIF[Notifications Module]
    end

    PG[(PostgreSQL\nmetadata)]
    S3[(AWS S3\nversioned, per credential)]
    GH[[GitHub repos\nHelm ConfigMap/Secret]]
    GOOGLE[Google OAuth]
    CHAT[Google Chat webhook]

    FE -->|HTTPS, JWT in httpOnly cookie| AUTH
    FE --> USERS
    FE --> PROJ
    FE --> ENV
    FE --> VAR
    FE --> CRED
    FE --> REQ
    FE --> AUDIT
    FE --> NOTIF

    AUTH --> GOOGLE
    AUTH --> PG
    USERS --> PG
    PROJ --> PG
    ENV --> PG
    CRED --> PG
    REQ --> PG
    AUDIT --> PG
    NOTIF --> PG
    NOTIF --> CHAT

    VAR --> PG
    VAR -->|credential-scoped access key/secret key| S3
    VAR -->|credential-scoped PAT, read-only| GH
```

Two data planes, one metadata store — see [TRD — Architecture](TRD.md#architecture) for the rationale. Postgres never holds a secret's actual value; S3 is the source of truth for S3-backed values; GitHub is read live at request time for GitHub-backed components and never written to.

## Module boundaries (NestJS)

One module per bounded concern, matching the API grouping in [LLD](LLD.md#api-design):

| Module | Owns |
|---|---|
| `AuthModule` | Google OAuth callback, whitelist check, JWT issue/refresh/revoke, single-session enforcement |
| `UsersModule` | User records, roles, deactivation, `ProjectAssignment`s, pending `AccessRequest`s |
| `ProjectsModule` | Projects and `ProjectComponent`s |
| `EnvironmentsModule` | Environments and `EnvironmentComponentConfig`s (S3/GitHub connection setup) |
| `VariablesModule` | Variable read/write/import/diff/history/rollback against S3 or GitHub, Secret masking, `VariableMetadata` |
| `CredentialsModule` | AWS/GitHub credential storage, usage lookup, deletion warning |
| `RequestsModule` | `DeleteRequest` / `RollbackRequest` creation and Admin approval/rejection |
| `AuditModule` | Append-only `AuditLog` writes (called by every other module) and the `/audit-log` read API |
| `NotificationsModule` | In-app notifications feed + best-effort Google Chat webhook delivery |

A cross-cutting `AuthzGuard` (role + `ProjectAssignment` scope check) and a `SecretMaskingInterceptor` sit in front of every controller that can return variable data — these are shared, not duplicated per module, since [PRD — Non-functional requirements](PRD.md#non-functional-requirements) requires masking on *every* read path.

## Key flows

### 1. Sign-in (whitelisted vs. not)

```mermaid
sequenceDiagram
    participant U as User
    participant FE
    participant Auth as AuthModule
    participant DB as Postgres
    participant Chat as Google Chat

    U->>FE: Click "Sign in with Google"
    FE->>Auth: GET /auth/google
    Auth->>U: Redirect to Google consent
    U->>Auth: GET /auth/google/callback (Google profile)
    Auth->>DB: SELECT user WHERE email = ?
    alt email found (whitelisted)
        Auth->>DB: create session (refresh token id)
        Auth->>FE: Set httpOnly cookies, redirect to app
    else email not found
        Auth->>DB: upsert AccessRequest(status=pending)
        Auth->>Chat: notify Admins (best-effort)
        Auth->>DB: create in-app notification for Admins
        Auth->>FE: redirect to "request pending" page
    end
```

### 2. Member edits a non-Secret variable

```mermaid
sequenceDiagram
    participant M as Member
    participant FE
    participant Var as VariablesModule
    participant Guard as AuthzGuard
    participant DB as Postgres
    participant S3

    M->>FE: Edit KEY=value, Save
    FE->>Var: PATCH .../variables/:key
    Var->>Guard: check ProjectAssignment covers this env+component
    Guard-->>Var: allowed
    Var->>DB: SELECT VariableMetadata WHERE key = ? 
    alt isSecret = true
        Var-->>FE: 403 (Members can never write a Secret's value)
    else isSecret = false
        Var->>S3: PutObject (new version) via component's credential
        Var->>DB: INSERT AuditLog(action=update, user=M)
        Var-->>FE: 200
    end
```

### 3. Member requests a delete → Admin approves

```mermaid
sequenceDiagram
    participant M as Member
    participant Req as RequestsModule
    participant DB as Postgres
    participant Notif as NotificationsModule
    participant A as Admin
    participant Var as VariablesModule

    M->>Req: POST /requests (type=delete, target=...)
    Req->>DB: INSERT DeleteRequest(status=pending)
    Req->>Notif: notify Admins (in-app + Chat, best-effort)
    Note over A: later
    A->>Req: POST /requests/:id/approve
    Req->>Var: execute the actual delete
    Var->>DB: INSERT AuditLog(action=delete, user=A, metadata={requestedBy: M})
    Req->>DB: UPDATE DeleteRequest(status=approved, reviewer=A)
    Req->>Notif: notify M of outcome
```

### 4. Admin reveals a Secret

Same guard path as flow 2, except the caller's role is checked *before* the masking step is even applied — the value is fetched from S3, an `AuditLog(action=reveal)` row is written, and only then is the value returned. There is no separate "hidden" endpoint a Member could hit to skip masking; masking is applied per-role inside the one variable-read path.

### 5. Bulk `.env` import

Two-step: `POST .../import/preview` parses the pasted/uploaded block (dedupe, strip `export`/quotes) and returns a proposed diff without writing anything; `POST .../import/commit` applies it. Existing Secret-flagged keys are excluded from what a Member's commit can overwrite — the commit endpoint re-checks `VariableMetadata.isSecret` server-side rather than trusting whatever the preview step showed the client.

## Deployment view

Kosha runs as one deployable unit (frontend + backend + Postgres) inside Divami's own infrastructure — it does not need to be deployed per-client. It reaches into any AWS account or GitHub org purely through the access-key/secret-key or PAT stored in that connection's `Credential` row; Kosha's own hosting location is independent of where the projects it manages actually run. See [TRD — Deployment shape](TRD.md#deployment-shape).
