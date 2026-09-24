import { apiDelete, apiGet, apiPost } from './client';

export interface AssignmentSummary {
  id: string;
  userId: string;
  userEmail: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  projectComponentId: string | null;
  componentName: string | null;
  createdAt: string;
}

export interface CreateAssignmentInput {
  projectId: string;
  environmentId: string;
  projectComponentId?: string;
}

export const listAssignments = (userId: string) => apiGet<AssignmentSummary[]>(`/users/${userId}/assignments`);

export const listAllAssignments = () => apiGet<AssignmentSummary[]>('/assignments');

export const listProjectAssignments = (projectId: string) =>
  apiGet<AssignmentSummary[]>(`/projects/${projectId}/assignments`);

export const createAssignment = (userId: string, input: CreateAssignmentInput) =>
  apiPost<AssignmentSummary>(`/users/${userId}/assignments`, input);

export const removeAssignment = (id: string) => apiDelete(`/assignments/${id}`);
