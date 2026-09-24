import { apiGet, apiPost } from './client';

// Admin: the action executed immediately ('deleted'/'executed'). Member: a
// DeleteRequest/RollbackRequest was filed instead ('requested') —
// CLAUDE.md #3, one endpoint per destructive action, role check server-side.
export type DeleteOutcome = { status: 'deleted' } | { status: 'requested' };
export type RollbackOutcome = { status: 'executed' } | { status: 'requested' };

export type RequestKind = 'delete' | 'rollback';
export type RequestTargetType = 'variable' | 'component' | 'environment' | 'project';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface RequestItem {
  id: string;
  kind: RequestKind;
  requesterId: string;
  requesterEmail: string;
  targetType: RequestTargetType | null;
  projectId: string | null;
  projectName: string | null;
  environmentId: string | null;
  environmentName: string | null;
  projectComponentId: string | null;
  componentName: string | null;
  key: string | null;
  targetVersionId: string | null;
  status: RequestStatus;
  reviewerId: string | null;
  reviewerEmail: string | null;
  reviewerNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export const listPendingRequests = () => apiGet<RequestItem[]>('/requests');
export const listMyRequests = () => apiGet<RequestItem[]>('/requests/mine');

export const approveRequest = (id: string, note?: string) =>
  apiPost<void>(`/requests/${id}/approve`, note ? { note } : undefined);

export const rejectRequest = (id: string, note?: string) =>
  apiPost<void>(`/requests/${id}/reject`, note ? { note } : undefined);
