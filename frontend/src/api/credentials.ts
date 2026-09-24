import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export type CredentialType = 'aws' | 'github';

export interface CredentialSummary {
  id: string;
  type: CredentialType;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCredentialInput {
  type: CredentialType;
  label: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  username?: string;
  pat?: string;
}

export interface UpdateCredentialInput {
  label?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  username?: string;
  pat?: string;
}

export const listCredentials = () => apiGet<CredentialSummary[]>('/credentials');

export const createCredential = (input: CreateCredentialInput) => apiPost<CredentialSummary>('/credentials', input);

export const updateCredential = (id: string, input: UpdateCredentialInput) =>
  apiPatch<CredentialSummary>(`/credentials/${id}`, input);

export const deleteCredential = (id: string) => apiDelete(`/credentials/${id}`);
