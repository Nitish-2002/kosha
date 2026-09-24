import { apiGet, apiPost } from './client';

export type NotificationType =
  | 'access_request_created'
  | 'access_request_approved'
  | 'access_request_rejected'
  | 'delete_request_created'
  | 'delete_request_approved'
  | 'delete_request_rejected'
  | 'rollback_request_created'
  | 'rollback_request_approved'
  | 'rollback_request_rejected';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export const listNotifications = () => apiGet<NotificationItem[]>('/notifications');
export const markNotificationRead = (id: string) => apiPost<void>(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => apiPost<void>('/notifications/read-all');
