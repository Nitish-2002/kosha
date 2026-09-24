import { apiGet, apiPost } from './client';
import type { UserRole } from '../context/auth-context';

export interface AccessRequestItem {
  id: string;
  email: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export const listPendingAccessRequests = () => apiGet<AccessRequestItem[]>('/access-requests');
export const approveAccessRequest = (id: string, role: UserRole) =>
  apiPost<void>(`/access-requests/${id}/approve`, { role });
export const rejectAccessRequest = (id: string) => apiPost<void>(`/access-requests/${id}/reject`);
