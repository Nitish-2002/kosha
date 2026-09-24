import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type { DeleteOutcome } from './requests';

export type ComponentConfigSourceType = 's3' | 'github';

export interface EnvironmentSummary {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentConfigSummary {
  id: string;
  environmentId: string;
  projectComponentId: string;
  componentName: string;
  sourceType: ComponentConfigSourceType;
  s3Bucket: string | null;
  s3Region: string | null;
  s3CredentialId: string | null;
  s3KeyOverride: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  githubCredentialId: string | null;
  githubConfigmapPath: string | null;
  githubSecretPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateComponentConfigInput {
  projectComponentId: string;
  sourceType: ComponentConfigSourceType;
  s3Bucket?: string;
  s3Region?: string;
  s3CredentialId?: string;
  s3KeyOverride?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubCredentialId?: string;
  githubConfigmapPath?: string;
  githubSecretPath?: string;
}

export const listEnvironments = (projectId: string) =>
  apiGet<EnvironmentSummary[]>(`/projects/${projectId}/environments`);

export const getEnvironment = (id: string) => apiGet<EnvironmentSummary>(`/environments/${id}`);

export const createEnvironment = (projectId: string, name: string) =>
  apiPost<EnvironmentSummary>(`/projects/${projectId}/environments`, { name });

export const deleteEnvironment = (id: string) => apiDelete<DeleteOutcome>(`/environments/${id}`);

export const listComponentConfigs = (environmentId: string) =>
  apiGet<ComponentConfigSummary[]>(`/environments/${environmentId}/components`);

export const addComponentConfig = (environmentId: string, input: CreateComponentConfigInput) =>
  apiPost<ComponentConfigSummary>(`/environments/${environmentId}/components`, input);

export interface UpdateComponentConfigInput {
  s3Bucket?: string;
  s3Region?: string;
  s3CredentialId?: string;
  s3KeyOverride?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubCredentialId?: string;
  githubConfigmapPath?: string;
  githubSecretPath?: string;
}

export const updateComponentConfig = (environmentId: string, configId: string, input: UpdateComponentConfigInput) =>
  apiPatch<ComponentConfigSummary>(`/environments/${environmentId}/components/${configId}`, input);

export const removeComponentConfig = (environmentId: string, configId: string) =>
  apiDelete<DeleteOutcome>(`/environments/${environmentId}/components/${configId}`);

export interface TestConnectionInput {
  sourceType: ComponentConfigSourceType;
  s3Bucket?: string;
  s3Region?: string;
  s3CredentialId?: string;
  s3KeyOverride?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubCredentialId?: string;
  githubConfigmapPath?: string;
  githubSecretPath?: string;
}

export interface GithubBulkPreviewInput {
  githubRepo: string;
  githubBranch: string;
  githubCredentialId: string;
  pathTemplate: string;
}

export interface GithubBulkPreviewRow {
  projectComponentId: string;
  componentName: string;
  path: string;
  status: 'found' | 'not-found' | 'already-connected';
}

export const previewGithubBulk = (environmentId: string, input: GithubBulkPreviewInput) =>
  apiPost<GithubBulkPreviewRow[]>(`/environments/${environmentId}/components/github-bulk/preview`, input);

export const testConnection = (input: TestConnectionInput) =>
  apiPost<{ success: true }>('/environments/test-connection', input);
