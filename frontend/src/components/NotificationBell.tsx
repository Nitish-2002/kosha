import { useEffect, useRef, useState } from 'react';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '../api/notifications';
import {
  FLOATING_PANEL_VIEWPORT_MARGIN,
  NOTIFICATION_IDLE_MS,
  NOTIFICATION_PANEL_WIDTH,
  NOTIFICATION_POLL_MS,
} from '../constants';
import './NotificationBell.scss';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function refresh(): void {
    listNotifications()
      .then(setNotifications)
      .catch(() => undefined);
  }

  // Polls so a new notification (e.g. a request needing review) shows up
  // without a reload — but only while someone is actually here: the tab is
  // visible AND there's been input in the last NOTIFICATION_IDLE_MS. An idle
  // or hidden tab makes no calls at all; the first input (or returning to
  // the tab) after that checks straight away, so nothing is missed.
  useEffect(() => {
    let lastActivityAt = Date.now();
    let idle = false;

    function userIsHere(): boolean {
      return document.visibilityState === 'visible' && Date.now() - lastActivityAt < NOTIFICATION_IDLE_MS;
    }

    function pollTick(): void {
      if (userIsHere()) refresh();
      else idle = true;
    }

    function handleActivity(): void {
      lastActivityAt = Date.now();
      if (idle && document.visibilityState === 'visible') {
        idle = false;
        refresh();
      }
    }

    refresh();
    const timer = setInterval(pollTick, NOTIFICATION_POLL_MS);
    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, handleActivity, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', handleActivity);
    return () => {
      clearInterval(timer);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, handleActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', handleActivity);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  function toggleOpen(): void {
    const next = !open;
    if (next && triggerRef.current) {
      // Prefer hanging from the trigger's right edge (the usual dropdown
      // look), but clamp so it can never run off either side of the
      // viewport — the bell isn't the rightmost thing in the header (the
      // profile chip and logout button sit to its right), so anchoring
      // purely to the trigger's edge is exactly what pushed this off-screen
      // on narrow viewports before.
      const rect = triggerRef.current.getBoundingClientRect();
      const preferredLeft = rect.right - NOTIFICATION_PANEL_WIDTH;
      const maxLeft = window.innerWidth - NOTIFICATION_PANEL_WIDTH - FLOATING_PANEL_VIEWPORT_MARGIN;
      const left = Math.min(Math.max(preferredLeft, FLOATING_PANEL_VIEWPORT_MARGIN), maxLeft);
      setPanelPosition({ top: rect.bottom + 8, left });
    }
    setOpen(next);
    if (next) {
      refresh();
    }
  }

  async function handleMarkAllRead(): Promise<void> {
    await markAllNotificationsRead();
    refresh();
  }

  async function handleItemClick(notification: NotificationItem): Promise<void> {
    if (!notification.readAt) {
      await markNotificationRead(notification.id);
      refresh();
    }
  }

  return (
    <div className="notification-bell" ref={rootRef}>
      <button ref={triggerRef} className="notification-bell-trigger" onClick={toggleOpen} aria-label="Notifications">
        <BellIcon />
        {unreadCount > 0 && <span className="notification-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-panel" style={{ top: panelPosition.top, left: panelPosition.left }}>
          <div className="notification-panel-header">
            <h3>Notifications</h3>
            {unreadCount > 0 && <button onClick={() => void handleMarkAllRead()}>Mark all read</button>}
          </div>
          {notifications.length === 0 ? (
            <p className="notification-empty">No notifications yet.</p>
          ) : (
            <ul className="notification-list">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    className={
                      notification.readAt ? 'notification-item' : 'notification-item notification-item--unread'
                    }
                    onClick={() => void handleItemClick(notification)}
                  >
                    <span>{describeNotification(notification)}</span>
                    <span className="notification-time">{new Date(notification.createdAt).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function describeNotification(notification: NotificationItem): string {
  const email = typeof notification.payload?.email === 'string' ? notification.payload.email : 'Someone';
  switch (notification.type) {
    case 'access_request_created':
      return `${email} requested access to Kosha.`;
    case 'access_request_approved':
      return 'Your access request was approved.';
    case 'access_request_rejected':
      return 'Your access request was rejected.';
    case 'delete_request_created':
      return 'A new delete request needs your review.';
    case 'delete_request_approved':
      return 'Your delete request was approved.';
    case 'delete_request_rejected':
      return 'Your delete request was rejected.';
    case 'rollback_request_created':
      return 'A new rollback request needs your review.';
    case 'rollback_request_approved':
      return 'Your rollback request was approved.';
    case 'rollback_request_rejected':
      return 'Your rollback request was rejected.';
    default:
      return 'New notification.';
  }
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 1.5a4.5 4.5 0 0 0-4.5 4.5v2.3c0 .5-.18.98-.5 1.36L2.7 11.2c-.7.82-.11 2.08.96 2.08h10.68c1.07 0 1.66-1.26.96-2.08l-1.3-1.54a2.1 2.1 0 0 1-.5-1.36V6A4.5 4.5 0 0 0 9 1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M7 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
