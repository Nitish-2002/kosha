import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type { DeleteOutcome } from './requests';

export interface ProjectComponentItem {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  components: ProjectComponentItem[];
  environments: { id: string; name: string }[];
  environmentCount: number;
  // Admin-only; null for a Member.
  memberCount: number | null;
  // Latest audited write (who + when). Admin-only, Projects list only.
  lastActivity: { at: string; byEmail: string | null } | null;
}

export const listProjects = () => apiGet<ProjectSummary[]>('/projects');
export const getProject = (id: string) => apiGet<ProjectSummary>(`/projects/${id}`);

export const createProject = (input: { name: string; description?: string }) =>
  apiPost<ProjectSummary>('/projects', input);

export const updateProject = (id: string, input: { name?: string; description?: string }) =>
  apiPatch<ProjectSummary>(`/projects/${id}`, input);

export const archiveProject = (id: string) => apiPost<ProjectSummary>(`/projects/${id}/archive`);
export const unarchiveProject = (id: string) => apiPost<ProjectSummary>(`/projects/${id}/unarchive`);

export const deleteProject = (id: string) => apiDelete<DeleteOutcome>(`/projects/${id}`);

export const addComponent = (projectId: string, name: string) =>
  apiPost<ProjectSummary>(`/projects/${projectId}/components`, { name });

export const removeComponent = (projectId: string, componentId: string) =>
  apiDelete(`/projects/${projectId}/components/${componentId}`);
