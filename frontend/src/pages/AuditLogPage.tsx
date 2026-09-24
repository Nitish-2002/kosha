import { useEffect, useState } from 'react';
import { useToast } from '../context/useToast';
import { listAuditLog, type AuditAction, type AuditLogEntry } from '../api/audit';
import { listProjects, type ProjectSummary } from '../api/projects';
import { listUsers, type UserSummary } from '../api/users';
import { formatTimestamp } from '../lib/formatDate';
import { Select } from '../components/Select';
import { DatePicker } from '../components/DatePicker';
import { AUDIT_ACTION_OPTIONS, AUDIT_LOG_PAGE_SIZE } from '../constants';
import './AuditLogPage.scss';

export function AuditLogPage() {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [members, setMembers] = useState<UserSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  // ?userId= pre-filters (Members page → "View activity in audit log").
  const [userId, setUserId] = useState(() => new URLSearchParams(window.location.search).get('userId') ?? '');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listProjects().catch(() => []).then((data) => setProjects(data ?? []));
    listUsers().catch(() => []).then((data) => setMembers(data ?? []));
  }, []);

  // loading is only ever true for the first fetch — a filter change just
  // replaces entries/total in place once it resolves, same convention as
  // every other list page in this app (no re-armed spinner on refetch).
  function refresh(): void {
    listAuditLog({
      projectId: projectId || undefined,
      userId: userId || undefined,
      action: (action as AuditAction) || undefined,
      // Both anchored to local midnight, not UTC — a bare "yyyy-mm-dd" parses
      // as UTC midnight per spec, but "yyyy-mm-ddTHH:mm:ss" (no "Z") parses
      // in the browser's local time, so mixing the two forms for from/to
      // would misalign them by the local UTC offset. "To" is end-of-day, not
      // start-of-day — from === to previously produced a zero-width instant
      // (00:00:00.000 to 00:00:00.000) that matched nothing, instead of the
      // whole day the picker visually suggests.
      from: from ? new Date(`${from}T00:00:00.000`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
      limit: AUDIT_LOG_PAGE_SIZE,
      offset,
    })
      .then((page) => {
        setEntries(page.items);
        setTotal(page.total);
      })
      .catch(() => showToast('Could not load the audit log.', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [projectId, userId, action, from, to, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateFilter(setter: (value: string) => void, value: string): void {
    setter(value);
    setOffset(0);
  }

  function clearFilters(): void {
    setProjectId('');
    setUserId('');
    setAction('');
    setFrom('');
    setTo('');
    setOffset(0);
  }

  const hasFilters = projectId || userId || action || from || to;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + AUDIT_LOG_PAGE_SIZE, total);

  return (
    <div className="audit-log-page">
      <div className="audit-log-header">
        <h1>Audit log</h1>
        <p>Every create, update, delete, rollback, reveal, and import — who, what, and when. Retained for 7 days.</p>
      </div>

      <div className="audit-log-filters">
        <label>
          Project
          <Select
            value={projectId}
            onChange={(value) => updateFilter(setProjectId, value)}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="All projects"
            searchable
          />
        </label>
        <label>
          User
          <Select
            value={userId}
            onChange={(value) => updateFilter(setUserId, value)}
            options={members.map((m) => ({ value: m.id, label: m.email }))}
            placeholder="All users"
            searchable
          />
        </label>
        <label>
          Action
          <Select
            value={action}
            onChange={(value) => updateFilter(setAction, value)}
            options={AUDIT_ACTION_OPTIONS}
            placeholder="All actions"
          />
        </label>
        <label>
          From
          <DatePicker value={from} onChange={(value) => updateFilter(setFrom, value)} placeholder="Any" maxDate={to} />
        </label>
        <label>
          To
          <DatePicker value={to} onChange={(value) => updateFilter(setTo, value)} placeholder="Any" minDate={from} />
        </label>
        {hasFilters && (
          <button className="audit-log-clear-btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <p className="audit-log-empty">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="audit-log-empty">
          {hasFilters ? 'No audit log entries match those filters.' : 'No audit log entries yet.'}
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="audit-log-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Project</th>
                  <th>Environment</th>
                  <th>Component</th>
                  <th>Key / Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="audit-log-td-when">{formatTimestamp(entry.createdAt)}</td>
                    <td>{entry.userEmail}</td>
                    <td>
                      <span className={`audit-log-action audit-log-action--${entry.action}`}>{entry.action}</span>
                    </td>
                    <td>{entry.projectName ?? '—'}</td>
                    <td>{entry.environmentName ?? '—'}</td>
                    <td>{entry.componentName ?? '—'}</td>
                    <td>
                      {entry.key && <span className="audit-log-td-key">{entry.key}</span>}
                      {entry.key && entry.details && ' — '}
                      {entry.details && <span className="audit-log-detail">{entry.details}</span>}
                      {!entry.key && !entry.details && '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <span>
              {rangeStart}–{rangeEnd} of {total}
            </span>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - AUDIT_LOG_PAGE_SIZE))}>
              Previous
            </button>
            <button disabled={rangeEnd >= total} onClick={() => setOffset(offset + AUDIT_LOG_PAGE_SIZE)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
