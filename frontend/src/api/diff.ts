import { apiGet, apiPost } from './client';

export interface DiffEntry {
  key: string;
  value: string | null;
  isSecret: boolean;
}

export interface DiffDifferingEntry {
  key: string;
  fromValue: string | null;
  toValue: string | null;
  isSecret: boolean;
}

export interface DiffResult {
  onlyInFrom: DiffEntry[];
  onlyInTo: DiffEntry[];
  differing: DiffDifferingEntry[];
  matching: DiffEntry[];
}

export const getDiff = (fromConfigId: string, toConfigId: string) =>
  apiGet<DiffResult>(`/diff?fromConfigId=${fromConfigId}&toConfigId=${toConfigId}`);

export const addToEnvironment = (fromConfigId: string, toConfigId: string, key: string) =>
  apiPost<void>('/diff/add-to-environment', { fromConfigId, toConfigId, key });
