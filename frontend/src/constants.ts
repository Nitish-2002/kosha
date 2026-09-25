import type { AuditAction } from './api/audit';

// Every named constant used across the frontend, in one place — a tuning
// change (a timeout, a page size, a layout width) shouldn't require hunting
// through whichever component happens to use it, and a value needed in more
// than one place (e.g. ROLE_OPTIONS) has exactly one definition instead of
// silently drifting apart.

// Dropdown/panel positioning (Select, DatePicker, NotificationBell) — how
// close a floating panel is allowed to get to the viewport edge before it's
// clamped back on-screen.
export const FLOATING_PANEL_VIEWPORT_MARGIN = 16;

// NotificationBell: fixed width of the notification dropdown panel, used to
// compute its clamped left position.
export const NOTIFICATION_PANEL_WIDTH = 320;

// NotificationBell: how often it polls for new notifications in the
// background, so a new one (e.g. a request needing review) shows up without
// the user having to reload the page or click the bell themselves.
export const NOTIFICATION_POLL_MS = 30_000;
// No input for this long counts as idle — the bell stops polling until the next input.
export const NOTIFICATION_IDLE_MS = 2 * 60_000;

// AuditLogPage: rows fetched per page.
export const AUDIT_LOG_PAGE_SIZE = 50;

// ProjectDetailPage: variables table rows per page (client-side — the whole
// environment's variables are already loaded).
export const VARIABLES_PAGE_SIZE = 25;

// ProjectDetailPage: CLAUDE.md #13 — an Admin's on-demand Secret reveal
// re-masks automatically after this long (or on navigating away, whichever
// comes first).
export const SECRET_REVEAL_DURATION_MS = 30_000;

// DatePicker: calendar grid weekday header, Sunday-first to match
// toLocaleDateString('en-GB') week numbering used elsewhere on the same
// component.
export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Role picker options — shared by RequestsPage's Access tab (approving a
// whitelist request) and MembersPage (changing an existing member's role).
// Kosha has exactly two roles (CLAUDE.md #6); this list is the one place
// that's true.
export const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];

// CredentialsPage: the two supported credential types (CLAUDE.md — Kosha
// reads from S3 or a read-only GitHub source, nothing else).
export const CREDENTIAL_TYPE_OPTIONS = [
  { value: 'aws', label: 'AWS (access key / secret key)' },
  { value: 'github', label: 'GitHub (username + personal access token)' },
];

// AuditLogPage: the Action filter dropdown — mirrors AuditLog.action's full
// value set (audit-log.entity.ts on the backend).
export const AUDIT_ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'rollback', label: 'Rollback' },
  { value: 'reveal', label: 'Reveal' },
  { value: 'import', label: 'Import' },
  { value: 'request', label: 'Request' },
  { value: 'reject', label: 'Reject' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'refresh', label: 'Session refresh' },
];

// MembersPage: sentinel column key in the access-grant matrix meaning "every
// component in this environment" as opposed to one specific component id.
export const ALL_COMPONENTS_KEY = 'ALL';

// LoginPage: marketing copy under the sign-in button.
export const LOGIN_FEATURES = [
  'Secure by default, not by discipline',
  'Every change attributed to a person and a timestamp',
  'Delegate work without handing over the keys',
];
