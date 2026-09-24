import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import {
  archiveProject,
  createProject,
  deleteProject,
  listProjects,
  unarchiveProject,
  type ProjectSummary,
} from '../api/projects';
import { formatTimestamp } from '../lib/formatDate';
import { fetchMyPendingKeys, pendingKey } from '../lib/pendingRequests';
import { ConfirmDialog } from '../components/ConfirmDialog';
import './ProjectsPage.scss';

type SortKey = 'name' | 'components' | 'environments' | 'updatedAt';
type SortDir = 'asc' | 'desc';

export function ProjectsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { showToast } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // A Member's own pending delete requests (Admins delete directly, never request).
  const [myPendingKeys, setMyPendingKeys] = useState<Set<string>>(new Set());

  function refresh(): void {
    if (!isAdmin) fetchMyPendingKeys().then(setMyPendingKeys).catch(() => undefined);
    listProjects()
      .then(setProjects)
      .catch(() => showToast('Could not load projects.', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [showToast, isAdmin]);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? projects.filter(
          (project) =>
            project.name.toLowerCase().includes(query) || (project.description ?? '').toLowerCase().includes(query),
        )
      : projects;

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'components') cmp = a.components.length - b.components.length;
      else if (sortKey === 'environments') cmp = a.environmentCount - b.environmentCount;
      else cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [projects, search, sortKey, sortDir]);

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function toggleSelected(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(): void {
    setSelectedIds((prev) =>
      prev.size === visibleProjects.length ? new Set() : new Set(visibleProjects.map((p) => p.id)),
    );
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    const targets = pendingDelete;
    try {
      const results = await Promise.all(targets.map((project) => deleteProject(project.id)));
      const requested = results.filter((r) => r.status === 'requested').length;
      if (requested === 0) {
        showToast(targets.length === 1 ? `"${targets[0].name}" deleted.` : `${targets.length} projects deleted.`);
      } else if (requested === targets.length) {
        showToast(
          targets.length === 1
            ? `Delete request for "${targets[0].name}" submitted for Admin approval.`
            : `${targets.length} delete requests submitted for Admin approval.`,
        );
      } else {
        showToast(`${targets.length - requested} deleted, ${requested} submitted for Admin approval.`);
      }
      setSelectedIds(new Set());
      refresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not delete the selected project(s).', 'error');
    } finally {
      setPendingDelete(null);
    }
  }

  const selectedProjects = projects.filter((p) => selectedIds.has(p.id));

  return (
    <div className="projects-page">
      <div className="projects-header">
        <div>
          <h1>Projects</h1>
          <p>Client and internal projects. Click one to manage its components and environments.</p>
        </div>
        {isAdmin && (
          <button className="projects-add-btn" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Close' : '+ New project'}
          </button>
        )}
      </div>

      {isAdmin && creating && (
        <ProjectForm
          onCancel={() => setCreating(false)}
          onSaved={(message) => {
            showToast(message);
            setCreating(false);
            refresh();
          }}
        />
      )}

      {projects.length > 0 && (
        <input
          className="projects-search"
          placeholder="Search by name or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {isAdmin && selectedIds.size > 0 && (
        <div className="projects-bulk-bar">
          <span>{selectedIds.size} selected</span>
          <button className="projects-bulk-delete-btn" onClick={() => setPendingDelete(selectedProjects)}>
            Delete Selected
          </button>
        </div>
      )}

      {loading ? (
        <p className="projects-empty">Loading…</p>
      ) : visibleProjects.length === 0 ? (
        <p className="projects-empty">
          {projects.length === 0 ? 'No projects yet. Create one to get started.' : 'No projects match your search.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="projects-table">
            <thead>
              <tr>
                {isAdmin && (
                  <th className="projects-th-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === visibleProjects.length}
                      onChange={toggleSelectAll}
                      aria-label="Select all projects"
                    />
                  </th>
                )}
                <SortableHeader label="Project Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <th>Description</th>
                <SortableHeader label="Components" sortKey="components" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Environments" sortKey="environments" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Last Updated" sortKey="updatedAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map((project) => (
                <ProjectTableRow
                  key={project.id}
                  project={project}
                  environmentCount={project.environmentCount}
                  selected={selectedIds.has(project.id)}
                  isAdmin={isAdmin}
                  deletePending={myPendingKeys.has(pendingKey.project(project.id))}
                  onToggleSelected={() => toggleSelected(project.id)}
                  onOpen={() => navigate(`/projects/${project.id}`)}
                  onChange={refresh}
                  onRequestDelete={() => setPendingDelete([project])}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.length === 1 ? 'Delete project?' : `Delete ${pendingDelete.length} projects?`}
          message={
            isAdmin
              ? pendingDelete.length === 1
                ? `"${pendingDelete[0].name}" and its ${pendingDelete[0].components.length} component(s) will be permanently deleted. This can't be undone.`
                : `The following projects and all their components/environments will be permanently deleted. This can't be undone:\n${pendingDelete.map((p) => `• ${p.name}`).join('\n')}`
              : pendingDelete.length === 1
                ? `This will send a delete request for "${pendingDelete[0].name}" to an Admin for approval — nothing is deleted yet.`
                : `This will send delete requests for ${pendingDelete.length} projects to an Admin for approval — nothing is deleted yet.`
          }
          confirmLabel={isAdmin ? 'Delete' : 'Request delete'}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <th>
      <button type="button" className={active ? 'sort-header sort-header--active' : 'sort-header'} onClick={() => onSort(sortKey)}>
        {label}
        <SortIcon direction={active ? dir : null} />
      </button>
    </th>
  );
}

function SortIcon({ direction }: { direction: SortDir | null }) {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="sort-icon">
      {direction === 'desc' ? (
        <path d="m2.5 4.5 3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="m2.5 7.5 3.5-3 3.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function ProjectForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createProject({ name, description: description || undefined });
      onSaved(`"${name}" created.`);
      setName('');
      setDescription('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="projects-form" onSubmit={(e) => void handleSubmit(e)}>
      <h2>New project</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Client X" required />
      </label>
      <label>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this project?"
          rows={2}
        />
      </label>
      {error && <p className="projects-error">{error}</p>}
      <div className="projects-form-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="projects-add-btn" disabled={submitting}>
          {submitting ? 'Saving…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function ProjectTableRow({
  project,
  environmentCount,
  selected,
  isAdmin,
  deletePending,
  onToggleSelected,
  onOpen,
  onChange,
  onRequestDelete,
}: {
  project: ProjectSummary;
  environmentCount: number;
  selected: boolean;
  isAdmin: boolean;
  deletePending: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
  onChange: () => void;
  onRequestDelete: () => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const isArchived = project.archivedAt !== null;

  async function handleArchiveToggle(): Promise<void> {
    setBusy(true);
    try {
      if (isArchived) {
        await unarchiveProject(project.id);
        showToast(`"${project.name}" unarchived.`);
      } else {
        await archiveProject(project.id);
        showToast(`"${project.name}" archived.`);
      }
      onChange();
    } catch {
      showToast('Could not update that project.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={isArchived ? 'projects-row projects-row--archived' : 'projects-row'} onClick={onOpen}>
      {isAdmin && (
        <td onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label={`Select ${project.name}`} />
        </td>
      )}
      <td className="projects-td-name">
        {project.name}
        {isArchived && <span className="project-archived-badge">Archived</span>}
      </td>
      <td className="projects-td-description">{project.description || '—'}</td>
      <td>{project.components.length}</td>
      <td>{environmentCount}</td>
      <td className="projects-td-updated">{formatTimestamp(project.updatedAt)}</td>
      <td className="projects-td-actions" onClick={(e) => e.stopPropagation()}>
        {isAdmin && (
          <button
            className="icon-btn"
            aria-label={isArchived ? 'Unarchive' : 'Archive'}
            title={isArchived ? 'Unarchive' : 'Archive'}
            onClick={() => void handleArchiveToggle()}
            disabled={busy}
          >
            {isArchived ? <UnarchiveIcon /> : <ArchiveIcon />}
          </button>
        )}
        {deletePending ? (
          <span className="pending-badge">Delete requested</span>
        ) : (
          <button
            className="icon-btn danger"
            aria-label={isAdmin ? 'Delete' : 'Request delete'}
            title={isAdmin ? 'Delete' : 'Request delete'}
            onClick={onRequestDelete}
            disabled={busy}
          >
            <DeleteIcon />
          </button>
        )}
      </td>
    </tr>
  );
}

function ArchiveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M1.5 3.5h10v2h-10z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M2.5 5.5v5.5h8V5.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function UnarchiveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M1.5 3.5h10v2h-10z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M2.5 5.5v5.5h8V5.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6.5 10V7M5 8.5l1.5-1.5L8 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M2 3.5h9M5 3.5V2h3v1.5M3 3.5l.5 7.5h5l.5-7.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
