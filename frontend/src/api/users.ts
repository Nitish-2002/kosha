import { apiGet, apiPatch, apiPost } from './client';
import type { UserRole } from '../context/auth-context';

export interface UserSummary {
  id: string;
  email: string;
  role: UserRole;
  status: 'active' | 'deactivated';
  createdAt: string;
  updatedAt: string;
}

export const listUsers = () => apiGet<UserSummary[]>('/users');
export const updateUserRole = (id: string, role: UserRole) => apiPatch<UserSummary>(`/users/${id}/role`, { role });
export const deactivateUser = (id: string) => apiPost<UserSummary>(`/users/${id}/deactivate`);
export const reactivateUser = (id: string) => apiPost<UserSummary>(`/users/${id}/reactivate`);
