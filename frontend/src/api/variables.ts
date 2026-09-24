import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type { DeleteOutcome, RollbackOutcome } from './requests';

export interface VariableSummary {
  key: string;
  value: string | null;
  isSecret: boolean;
}

export interface VariableHistoryEntry {
  versionId: string;
  isCurrent: boolean;
  lastModified: string | undefined;
  value: string | null;
}

export interface ImportPlan {
  creates: { key: string; value: string }[];
  updates: { key: string; value: string }[];
  skipped: { key: string; reason: string }[];
}

const base = (environmentId: string, configId: string) =>
  `/environments/${environmentId}/components/${configId}`;

export const listVariables = (environmentId: string, configId: string) =>
  apiGet<VariableSummary[]>(`${base(environmentId, configId)}/variables`);

export const createVariable = (
  environmentId: string,
  configId: string,
  key: string,
  value: string,
  isSecret: boolean,
) => apiPost<void>(`${base(environmentId, configId)}/variables`, { key, value, isSecret });

export const updateVariable = (environmentId: string, configId: string, key: string, value: string) =>
  apiPatch<void>(`${base(environmentId, configId)}/variables/${encodeURIComponent(key)}`, { value });

export const updateSecretFlag = (environmentId: string, configId: string, key: string, isSecret: boolean) =>
  apiPatch<void>(`${base(environmentId, configId)}/variables/${encodeURIComponent(key)}/secret-flag`, {
    isSecret,
  });

export const deleteVariable = (environmentId: string, configId: string, key: string) =>
  apiDelete<DeleteOutcome>(`${base(environmentId, configId)}/variables/${encodeURIComponent(key)}`);

export const revealVariable = (environmentId: string, configId: string, key: string) =>
  apiPost<{ value: string }>(`${base(environmentId, configId)}/variables/${encodeURIComponent(key)}/reveal`);

export const getVariableHistory = (environmentId: string, configId: string, key: string) =>
  apiGet<VariableHistoryEntry[]>(`${base(environmentId, configId)}/variables/${encodeURIComponent(key)}/history`);

export const rollbackVariable = (environmentId: string, configId: string, key: string, targetVersionId: string) =>
  apiPost<RollbackOutcome>(`${base(environmentId, configId)}/rollback`, { key, targetVersionId });

export const previewImport = (environmentId: string, configId: string, envText: string) =>
  apiPost<ImportPlan>(`${base(environmentId, configId)}/import/preview`, { envText });

export const commitImport = (environmentId: string, configId: string, envText: string) =>
  apiPost<ImportPlan>(`${base(environmentId, configId)}/import/commit`, { envText });
