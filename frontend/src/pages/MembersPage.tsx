import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/useAuth';
import type { UserRole } from '../context/auth-context';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import {
  deactivateUser,
  listUsers,
  reactivateUser,
  updateUserRole,
  type UserSummary,
} from '../api/users';
import { Select } from '../components/Select';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AccessDrawer } from '../components/AccessDrawer';
import { ROLE_OPTIONS } from '../constants';
import './MembersPage.scss';


export function MembersPage() {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const [members, setMembers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<UserSummary | null>(null);
  const [managingMember, setManagingMember] = useState<UserSummary | null>(null);

  function refresh(): void {
    listUsers()
      .then(setMembers)
      .catch(() => showToast('Could not load members.', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [showToast]);

  const visibleMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => member.email.toLowerCase().includes(query));
  }, [members, search]);

  async function handleRoleChange(member: UserSummary, role: UserRole): Promise<void> {
    setBusyId(member.id);
    try {
      await updateUserRole(member.id, role);
      showToast(`${member.email} is now ${role}.`);
      refresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update role.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDeactivate(): Promise<void> {
    if (!pendingDeactivate) return;
    const target = pendingDeactivate;
    setBusyId(target.id);
    try {
      await deactivateUser(target.id);
      showToast(`${target.email} deactivated.`);
      refresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not deactivate that user.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReactivate(member: UserSummary): Promise<void> {
    setBusyId(member.id);
    try {
      await reactivateUser(member.id);
      showToast(`${member.email} reactivated.`);
      refresh();
    } catch {
      showToast('Could not reactivate that user.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="members-page">
      <div className="members-header">
        <h1>Members</h1>
        <p>Everyone with access to Kosha.</p>
      </div>

      {members.length > 0 && (
        <input
          className="members-search"
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      <div className="members-table-wrap">
        {loading ? (
          <p className="members-empty">Loading…</p>
        ) : visibleMembers.length === 0 ? (
          <p className="members-empty">
            {members.length === 0 ? 'No members yet.' : 'No members match your search.'}
          </p>
        ) : (
          <table className="members-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => {
                const isSelf = member.id === currentUser?.id;
                return (
                  <tr key={member.id}>
                    <td>
                      {member.email}
                      {isSelf && <span className="members-you"> (you)</span>}
                    </td>
                    <td>
                      <Select
                        value={member.role}
                        options={ROLE_OPTIONS}
                        onChange={(value) => void handleRoleChange(member, value as UserRole)}
                      />
                    </td>
                    <td>
                      <span className={`members-status members-status--${member.status}`}>{member.status}</span>
                    </td>
                    <td className="members-actions">
                      {member.role === 'member' && (
                        <button onClick={() => setManagingMember(member)}>Manage access</button>
                      )}
                      {member.status === 'active' ? (
                        <button
                          className="members-deactivate-btn"
                          disabled={isSelf || busyId === member.id}
                          title={isSelf ? "You can't deactivate your own account" : undefined}
                          onClick={() => setPendingDeactivate(member)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button disabled={busyId === member.id} onClick={() => void handleReactivate(member)}>
                          Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pendingDeactivate && (
        <ConfirmDialog
          title="Deactivate member?"
          message={`"${pendingDeactivate.email}" will be signed out immediately and unable to log back in until reactivated.`}
          confirmLabel="Deactivate"
          onConfirm={() => void confirmDeactivate()}
          onCancel={() => setPendingDeactivate(null)}
        />
      )}

      {managingMember && <AccessDrawer member={managingMember} onClose={() => setManagingMember(null)} />}
    </div>
  );
}
