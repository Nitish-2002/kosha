import { apiGet } from './client';

export type AuditAction = 'create' | 'update' | 'delete' | 'rollback' | 'reveal' | 'import';

export interface AuditLogEntry {
  id: string;
  userId: string;
  userEmail: string;
  action: AuditAction;
  projectId: string | null;
  projectName: string | null;
  environmentId: string | null;
  environmentName: string | null;
  componentName: string | null;
  key: string | null;
  details: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
}

export interface AuditLogFilter {
  projectId?: string;
  userId?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function listAuditLog(filter: AuditLogFilter): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  if (filter.projectId) params.set('projectId', filter.projectId);
  if (filter.userId) params.set('userId', filter.userId);
  if (filter.action) params.set('action', filter.action);
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  params.set('limit', String(filter.limit ?? 50));
  params.set('offset', String(filter.offset ?? 0));
  return apiGet<AuditLogPage>(`/audit-log?${params.toString()}`);
}
