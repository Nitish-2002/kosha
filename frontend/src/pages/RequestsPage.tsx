import { useEffect, useState } from 'react';
import { useToast } from '../context/useToast';
import type { UserRole } from '../context/auth-context';
import {
  approveAccessRequest,
  listPendingAccessRequests,
  rejectAccessRequest,
  type AccessRequestItem,
} from '../api/access-requests';
import { approveRequest, listPendingRequests, rejectRequest, type RequestItem } from '../api/requests';
import { Select } from '../components/Select';
import { ROLE_OPTIONS } from '../constants';
import { formatTimestamp } from '../lib/formatDate';
import './RequestsPage.scss';

// One line describing what's actually being asked for — the row's own
// project/environment/component/key fields already carry the specifics,
// this just turns them into a sentence.
function describeChangeRequest(item: RequestItem): string {
  if (item.kind === 'rollback') {
    return item.key ? `Roll back "${item.key}" to an earlier version` : 'Roll back the whole file to an earlier version';
  }
  switch (item.targetType) {
    case 'project':
      return `Delete project "${item.projectName ?? 'this project'}"`;
    case 'environment':
      return `Delete environment "${item.environmentName ?? 'this environment'}"`;
    case 'component':
      return `Remove "${item.componentName ?? 'this component'}" connection`;
    case 'variable':
      return `Delete variable "${item.key ?? ''}"`;
    default:
      return 'Delete';
  }
}

type Tab = 'access' | 'changes';

// Two unrelated approval queues that happened to both be called "requests":
// access requests decide who gets a Kosha account at all, delete/rollback
// requests decide whether an existing Member's destructive action executes.
// Different data, different approve action — kept as separate tabs (not one
// merged list) so each row still means one clear thing, but under one nav
// entry instead of two that both read "requests".
export function RequestsPage() {
  const [tab, setTab] = useState<Tab>('access');

  return (
    <div className="requests-page">
      <div className="requests-header">
        <h1>Requests</h1>
        <p>Access requests and Member-filed delete/rollback requests, waiting on your approval.</p>
      </div>

      <div className="requests-tabs">
        <button
          className={tab === 'access' ? 'requests-tab requests-tab--active' : 'requests-tab'}
          onClick={() => setTab('access')}
        >
          Access
        </button>
        <button
          className={tab === 'changes' ? 'requests-tab requests-tab--active' : 'requests-tab'}
          onClick={() => setTab('changes')}
        >
          Delete &amp; rollback
        </button>
      </div>

      {tab === 'access' ? <AccessRequestsTab /> : <ChangeRequestsTab />}
    </div>
  );
}

function AccessRequestsTab() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleChoice, setRoleChoice] = useState<Record<string, UserRole>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh(): void {
    listPendingAccessRequests()
      .then(setRequests)
      .catch(() => showToast('Could not load access requests.', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [showToast]);

  async function handleApprove(request: AccessRequestItem): Promise<void> {
    const role = roleChoice[request.id] ?? 'member';
    setBusyId(request.id);
    try {
      await approveAccessRequest(request.id, role);
      showToast(`${request.email} approved as ${role}.`);
      refresh();
    } catch {
      showToast('Could not approve that request.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(request: AccessRequestItem): Promise<void> {
    setBusyId(request.id);
    try {
      await rejectAccessRequest(request.id);
      showToast(`${request.email} rejected.`);
      refresh();
    } catch {
      showToast('Could not reject that request.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="requests-empty">Loading…</p>;
  if (requests.length === 0) return <p className="requests-empty">No pending access requests.</p>;

  return (
    <ul className="requests-list">
      {requests.map((request) => (
        <li key={request.id} className="requests-row">
          <div className="requests-info">
            <strong>{request.email}</strong>
            <span className="requests-meta">Requested {formatTimestamp(request.createdAt)}</span>
          </div>
          <div className="requests-actions">
            <Select
              value={roleChoice[request.id] ?? 'member'}
              options={ROLE_OPTIONS}
              onChange={(value) => setRoleChoice((current) => ({ ...current, [request.id]: value as UserRole }))}
            />
            <button
              className="requests-approve-btn"
              disabled={busyId === request.id}
              onClick={() => void handleApprove(request)}
            >
              Approve
            </button>
            <button
              className="requests-reject-btn"
              disabled={busyId === request.id}
              onClick={() => void handleReject(request)}
            >
              Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChangeRequestsTab() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh(): void {
    listPendingRequests()
      .then(setRequests)
      .catch(() => showToast('Could not load pending requests.', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [showToast]);

  async function handleApprove(item: RequestItem): Promise<void> {
    setBusyId(item.id);
    try {
      await approveRequest(item.id, notes[item.id]);
      showToast('Request approved.');
      refresh();
    } catch {
      showToast('Could not approve that request.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(item: RequestItem): Promise<void> {
    setBusyId(item.id);
    try {
      await rejectRequest(item.id, notes[item.id]);
      showToast('Request rejected.');
      refresh();
    } catch {
      showToast('Could not reject that request.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="requests-empty">Loading…</p>;
  if (requests.length === 0) return <p className="requests-empty">No pending delete/rollback requests.</p>;

  return (
    <ul className="requests-list">
      {requests.map((item) => (
        <li key={item.id} className="requests-row">
          <div className="requests-info">
            <strong>{describeChangeRequest(item)}</strong>
            <span className="requests-meta">
              {[item.projectName, item.environmentName].filter(Boolean).join(' / ')}
            </span>
            <span className="requests-meta">
              Requested by {item.requesterEmail} — {formatTimestamp(item.createdAt)}
            </span>
          </div>
          <div className="requests-actions">
            <input
              className="requests-note"
              placeholder="Optional note…"
              value={notes[item.id] ?? ''}
              onChange={(e) => setNotes((current) => ({ ...current, [item.id]: e.target.value }))}
            />
            <button
              className="requests-approve-btn"
              disabled={busyId === item.id}
              onClick={() => void handleApprove(item)}
            >
              Approve
            </button>
            <button
              className="requests-reject-btn"
              disabled={busyId === item.id}
              onClick={() => void handleReject(item)}
            >
              Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
