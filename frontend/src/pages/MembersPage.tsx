import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import type { UserRole } from '../context/auth-context';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import { deactivateUser, listUsers, reactivateUser, updateUserRole, type UserSummary } from '../api/users';
import { listAllAssignments, type AssignmentSummary } from '../api/project-assignments';
import { Select } from '../components/Select';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AccessDrawer } from '../components/AccessDrawer';
import { formatTimestamp } from '../lib/formatDate';
import './MembersPage.scss';

// "Needs access": an active Member who holds no assignment yet — signed in,
// but sees nothing until an Admin grants a project.
type MemberStatus = 'active' | 'waiting' | 'deactivated';
type StatusFilter = MemberStatus | 'all';

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: 'Active',
  waiting: 'Needs access',
  deactivated: 'Deactivated',
};

const MEMBERS_PAGE_SIZE = 20;

type PendingAction =
  | { kind: 'role'; member: UserSummary; role: UserRole }
  | { kind: 'deactivate'; member: UserSummary };

// "GenHRX-AI · Staging (frontend), Pre-Production (All)" — one line per project.
function accessLines(assignments: AssignmentSummary[]): string[] {
  const byProject = new Map<string, { projectName: string; scopesByEnvironment: Map<string, string[]> }>();
  for (const assignment of assignments) {
    const projectEntry = byProject.get(assignment.projectId) ?? {
      projectName: assignment.projectName,
      scopesByEnvironment: new Map<string, string[]>(),
    };
    const scopes = projectEntry.scopesByEnvironment.get(assignment.environmentName) ?? [];
    projectEntry.scopesByEnvironment.set(assignment.environmentName, [...scopes, assignment.componentName ?? 'All']);
    byProject.set(assignment.projectId, projectEntry);
  }
  return [...byProject.values()].map(({ projectName, scopesByEnvironment }) => {
    const environments = [...scopesByEnvironment.entries()].map(
      ([environmentName, scopes]) => `${environmentName} (${scopes.includes('All') ? 'All' : scopes.join(', ')})`,
    );
    return `${projectName} · ${environments.join(', ')}`;
  });
}

export function MembersPage() {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const [members, setMembers] = useState<UserSummary[]>([]);
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [managingMember, setManagingMember] = useState<UserSummary | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh(): void {
    Promise.all([listUsers(), listAllAssignments()])
      .then(([usersData, assignmentsData]) => {
        setMembers(usersData);
        setAssignments(assignmentsData);
      })
      .catch(() => showToast('Could not load members.', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [showToast]);

  // Close the ⋯ menu on any click outside it.
  useEffect(() => {
    if (!openMenuUserId) return;
    function closeMenu(event: MouseEvent): void {
      if (!(event.target as HTMLElement).closest('.members-menu, .members-menu-btn')) setOpenMenuUserId(null);
    }
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [openMenuUserId]);

  const assignmentsByUser = useMemo(() => {
    const grouped = new Map<string, AssignmentSummary[]>();
    for (const assignment of assignments) {
      grouped.set(assignment.userId, [...(grouped.get(assignment.userId) ?? []), assignment]);
    }
    return grouped;
  }, [assignments]);

  function statusOf(member: UserSummary): MemberStatus {
    if (member.status === 'deactivated') return 'deactivated';
    if (member.role === 'member' && !assignmentsByUser.has(member.id)) return 'waiting';
    return 'active';
  }

  const statusCounts: Record<StatusFilter, number> = { all: members.length, active: 0, waiting: 0, deactivated: 0 };
  for (const member of members) statusCounts[statusOf(member)] += 1;

  const visibleMembers = members.filter((member) => {
    if (statusFilter !== 'all' && statusOf(member) !== statusFilter) return false;
    if (roleFilter && member.role !== roleFilter) return false;
    return member.email.toLowerCase().includes(search.trim().toLowerCase());
  });

  const pageCount = Math.max(1, Math.ceil(visibleMembers.length / MEMBERS_PAGE_SIZE));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pageMembers = visibleMembers.slice(currentPage * MEMBERS_PAGE_SIZE, (currentPage + 1) * MEMBERS_PAGE_SIZE);

  function pickStatus(filter: StatusFilter): void {
    setStatusFilter(filter);
    setPageIndex(0);
  }

  async function confirmPendingAction(): Promise<void> {
    if (!pendingAction) return;
    const { member } = pendingAction;
    setBusy(true);
    try {
      if (pendingAction.kind === 'role') {
        await updateUserRole(member.id, pendingAction.role);
        showToast(`${member.email} is now ${pendingAction.role === 'admin' ? 'an Admin' : 'a Member'}.`);
      } else {
        await deactivateUser(member.id);
        showToast(`${member.email} deactivated.`);
      }
      refresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update that member.', 'error');
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  async function handleReactivate(member: UserSummary): Promise<void> {
    setOpenMenuUserId(null);
    try {
      await reactivateUser(member.id);
      showToast(`${member.email} reactivated.`);
      refresh();
    } catch {
      showToast('Could not reactivate that user.', 'error');
    }
  }

  return (
    <div className="members-page">
      <div className="members-header">
        <div>
          <h1>Members</h1>
          <p>People appear here after their first Google sign-in. Grant them access to the projects they need.</p>
        </div>
        {statusCounts.waiting > 0 && (
          <button className="members-waiting-btn" onClick={() => pickStatus('waiting')}>
            <span className="members-dot members-dot--waiting" aria-hidden="true" />
            {statusCounts.waiting} {statusCounts.waiting === 1 ? 'person needs' : 'people need'} access
          </button>
        )}
      </div>

      <div className="members-toolbar">
        <label className="members-search">
          <SearchIcon />
          <input
            aria-label="Search members"
            placeholder="Search by email"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPageIndex(0);
            }}
          />
        </label>
        <div className="members-status-tabs" role="group" aria-label="Filter by status">
          {(['all', 'active', 'waiting', 'deactivated'] as const).map((filter) => (
            <button key={filter} aria-pressed={statusFilter === filter} onClick={() => pickStatus(filter)}>
              {filter === 'all' ? 'All' : STATUS_LABEL[filter]} <span>{statusCounts[filter]}</span>
            </button>
          ))}
        </div>
        <div className="members-role-filter">
          <Select
            value={roleFilter}
            onChange={(role) => {
              setRoleFilter(role as UserRole | '');
              setPageIndex(0);
            }}
            options={[
              { value: '', label: 'All roles' },
              { value: 'admin', label: 'Admin' },
              { value: 'member', label: 'Member' },
            ]}
          />
        </div>
      </div>

      <div className="members-card">
        <div className="members-row members-row--head">
          <span>Member</span>
          <span>Role</span>
          <span>Status</span>
          <span>Access</span>
          <span>Last active</span>
          <span />
        </div>

        {loading ? (
          <p className="members-empty">Loading…</p>
        ) : pageMembers.length === 0 ? (
          <p className="members-empty">{members.length === 0 ? 'No members yet.' : 'No members match.'}</p>
        ) : (
          pageMembers.map((member) => {
            const isSelf = member.id === currentUser?.id;
            const status = statusOf(member);
            const access =
              member.role === 'admin'
                ? ['All projects · full access']
                : accessLines(assignmentsByUser.get(member.id) ?? []);
            const menuOpen = openMenuUserId === member.id;
            return (
              <div key={member.id} className="members-row">
                <div className="members-identity">
                  <span className="members-avatar" aria-hidden="true">
                    {member.email[0].toUpperCase()}
                  </span>
                  <div className="members-identity-text">
                    <span className="members-email">
                      {member.email}
                      {isSelf && <span className="members-you"> (you)</span>}
                    </span>
                    <span className="members-sub">Joined {formatTimestamp(member.createdAt)}</span>
                  </div>
                </div>
                <span>
                  <span className={`members-role members-role--${member.role}`}>
                    {member.role === 'admin' ? 'Admin' : 'Member'}
                  </span>
                </span>
                <span className="members-status">
                  <span className={`members-dot members-dot--${status}`} aria-hidden="true" />
                  {STATUS_LABEL[status]}
                </span>
                <span className={`members-access${access.length === 0 ? ' members-access--none' : ''}`}>
                  {access.length === 0 ? 'No access yet' : access.map((line) => <span key={line}>{line}</span>)}
                </span>
                <span className="members-last-active">
                  {member.lastLoginAt ? formatTimestamp(member.lastLoginAt) : '—'}
                </span>
                <div className="members-actions">
                  {!isSelf && member.role === 'member' && member.status === 'active' && (
                    <button
                      className={status === 'waiting' ? 'members-grant-btn' : 'outline-btn outline-btn--small'}
                      onClick={() => setManagingMember(member)}
                    >
                      {status === 'waiting' ? 'Grant access' : 'Manage access'}
                    </button>
                  )}
                  {!isSelf && (
                    <button
                      className="members-menu-btn"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      aria-label={`More actions for ${member.email}`}
                      onClick={() => setOpenMenuUserId(menuOpen ? null : member.id)}
                    >
                      <MoreIcon />
                    </button>
                  )}
                  {menuOpen && (
                    <div className="members-menu" role="menu">
                      {member.status === 'active' && (
                        <button
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuUserId(null);
                            setPendingAction({ kind: 'role', member, role: member.role === 'admin' ? 'member' : 'admin' });
                          }}
                        >
                          {member.role === 'admin' ? 'Change role to Member…' : 'Change role to Admin…'}
                        </button>
                      )}
                      <Link role="menuitem" to={`/audit-log?userId=${member.id}`}>
                        View activity in audit log
                      </Link>
                      {member.status === 'active' ? (
                        <button
                          role="menuitem"
                          className="members-menu-danger"
                          onClick={() => {
                            setOpenMenuUserId(null);
                            setPendingAction({ kind: 'deactivate', member });
                          }}
                        >
                          Deactivate…
                        </button>
                      ) : (
                        <button role="menuitem" onClick={() => void handleReactivate(member)}>
                          Reactivate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {!loading && visibleMembers.length > 0 && (
          <div className="members-footer">
            <span>
              Showing {currentPage * MEMBERS_PAGE_SIZE + 1}–{currentPage * MEMBERS_PAGE_SIZE + pageMembers.length} of{' '}
              {visibleMembers.length}
            </span>
            <div className="members-footer-pages">
              <button disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}>
                Previous
              </button>
              <button disabled={currentPage >= pageCount - 1} onClick={() => setPageIndex(currentPage + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {pendingAction && (
        <ConfirmDialog
          title={
            pendingAction.kind === 'deactivate'
              ? 'Deactivate member?'
              : `Make ${pendingAction.role === 'admin' ? 'an Admin' : 'a Member'}?`
          }
          message={
            pendingAction.kind === 'deactivate'
              ? `"${pendingAction.member.email}" will be signed out immediately and unable to log back in until reactivated.`
              : pendingAction.role === 'admin'
                ? `"${pendingAction.member.email}" will get full access to every project, including revealing Secrets.`
                : `"${pendingAction.member.email}" will only see the projects they're assigned to.`
          }
          confirmLabel={busy ? 'Saving…' : pendingAction.kind === 'deactivate' ? 'Deactivate' : 'Change role'}
          onConfirm={() => void confirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {managingMember && (
        <AccessDrawer
          member={managingMember}
          onClose={() => {
            setManagingMember(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}
