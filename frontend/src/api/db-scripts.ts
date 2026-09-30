import { apiGet, apiPatch, apiPost } from './client';

export type DbScriptStatus = 'pending' | 'applied' | 'not_applicable';

export interface DbScriptState {
  environmentId: string;
  status: DbScriptStatus;
  appliedByEmail: string | null;
  appliedAt: string | null;
  // A Member's undo request is waiting for an Admin.
  undoRequested: boolean;
  // Set when this "applied" came over in a restored dump, not run by hand.
  fromDump: { sourceEnvironmentName: string; dumpTakenOn: string } | null;
}

export type RefreshRule = 'not_applicable' | 'rerun_after_restore' | 'in_source' | 'not_in_source';

// One script's fate in a DB refresh — see refresh-plan.ts in the backend.
export interface RefreshPlanRow {
  scriptId: string;
  label: string;
  currentStatus: DbScriptStatus;
  sourceStatus: DbScriptStatus;
  resultStatus: DbScriptStatus;
  rule: RefreshRule;
}

export interface DbScriptEnvironment {
  id: string;
  name: string;
  lastRefresh: { sourceEnvironmentName: string; dumpTakenOn: string; recordedAt: string } | null;
}

// Admin: set back to pending right away. Member: an undo request was filed.
export type UnapplyOutcome = { status: 'reverted'; script: DbScript } | { status: 'requested' };

export interface DbScript {
  id: string;
  sequence: number;
  name: string;
  sql: string;
  rerunAfterRestore: boolean;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
  // One per environment in DbScriptBoard.environments, same order.
  states: DbScriptState[];
}

export interface DbScriptBoard {
  // Lower → higher; a Member sees only their assigned environments.
  environments: DbScriptEnvironment[];
  scripts: DbScript[];
}

export interface DbScriptInput {
  name: string;
  sql: string;
  rerunAfterRestore: boolean;
  notApplicableEnvironmentIds: string[];
}

export const listDbScripts = (projectId: string) => apiGet<DbScriptBoard>(`/projects/${projectId}/db-scripts`);

export const createDbScript = (projectId: string, input: DbScriptInput) =>
  apiPost<DbScript>(`/projects/${projectId}/db-scripts`, input);

export const updateDbScript = (projectId: string, scriptId: string, input: DbScriptInput) =>
  apiPatch<DbScript>(`/projects/${projectId}/db-scripts/${scriptId}`, input);

export const markDbScriptApplied = (projectId: string, scriptId: string, environmentId: string) =>
  apiPost<DbScript>(`/projects/${projectId}/db-scripts/${scriptId}/environments/${environmentId}/apply`);

export const unapplyDbScript = (projectId: string, scriptId: string, environmentId: string, reason?: string) =>
  apiPost<UnapplyOutcome>(
    `/projects/${projectId}/db-scripts/${scriptId}/environments/${environmentId}/unapply`,
    reason ? { reason } : {},
  );

// Admin-only. The dump came from sourceEnvironmentId and was restored into
// targetEnvironmentId.
export const previewDbRefresh = (projectId: string, sourceEnvironmentId: string, targetEnvironmentId: string) =>
  apiPost<RefreshPlanRow[]>(`/projects/${projectId}/db-refreshes/preview`, { sourceEnvironmentId, targetEnvironmentId });

export const recordDbRefresh = (
  projectId: string,
  input: { sourceEnvironmentId: string; targetEnvironmentId: string; dumpTakenOn: string },
) => apiPost<RefreshPlanRow[]>(`/projects/${projectId}/db-refreshes`, input);

// "002 add_users_email_index" — how a script is named everywhere in the UI.
export function dbScriptLabel(script: Pick<DbScript, 'sequence' | 'name'>): string {
  return `${String(script.sequence).padStart(3, '0')} ${script.name}`;
}

// Saves a file of these scripts' SQL, in order, each under a comment
// header — what someone downloads to run everything still pending in one
// environment.
export function downloadSqlBundle(scripts: DbScript[], environmentName: string): void {
  const header = [
    `-- Kosha: DB scripts still to run in ${environmentName}, in order.`,
    '-- Run them, then mark each one applied in Kosha.',
  ].join('\n');
  const body = scripts.map((script) => `-- ===== ${dbScriptLabel(script)} =====\n${script.sql.trim()}\n`).join('\n');
  const fileUrl = URL.createObjectURL(new Blob([`${header}\n\n${body}`], { type: 'application/sql' }));
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = `${environmentName.replace(/[^\w.-]+/g, '_')}_scripts_to_run.sql`;
  link.click();
  URL.revokeObjectURL(fileUrl);
}
