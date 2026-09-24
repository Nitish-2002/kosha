import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import { environmentColor } from '../lib/environmentColor';
import { formatTimestamp } from '../lib/formatDate';
import { fetchMyPendingKeys, pendingKey } from '../lib/pendingRequests';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Select } from '../components/Select';
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
  const [pageIndex, setPageIndex] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(PROJECT_PAGE_SIZES[0]);
  // Which row's "+N environments" popover is open — one at a time.
  const [openEnvironmentsProjectId, setOpenEnvironmentsProjectId] = useState<string | null>(null);

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
      else cmp = new Date(lastUpdatedAt(a)).getTime() - new Date(lastUpdatedAt(b)).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [projects, search, sortKey, sortDir]);

  // Clamped, so deleting the last row on the last page drops back a page.
  const pageCount = Math.max(1, Math.ceil(visibleProjects.length / rowsPerPage));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pageStart = currentPage * rowsPerPage;
  const pageProjects = visibleProjects.slice(pageStart, pageStart + rowsPerPage);

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
      prev.size === pageProjects.length ? new Set() : new Set(pageProjects.map((project) => project.id)),
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
          {projects.length > 0 && (
            <p>
              {projects.length} project{projects.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div className="projects-header-actions">
          {projects.length > 0 && (
            <label className="projects-search">
              <SearchIcon />
              <input
                aria-label="Search projects"
                placeholder="Search projects"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPageIndex(0);
                }}
              />
            </label>
          )}
          {isAdmin && (
            <button className="projects-add-btn" onClick={() => setCreating((open) => !open)}>
              {creating ? 'Close' : '+ New project'}
            </button>
          )}
        </div>
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
      ) : projects.length === 0 ? (
        <div className="projects-empty-state">
          <span className="projects-empty-icon" aria-hidden="true">
            <FolderIcon />
          </span>
          <h2>{isAdmin ? 'Create your first project' : 'No projects yet'}</h2>
          <p>
            {isAdmin
              ? "A project groups an application's components and environments. Connect each component to a GitHub file or S3 object and Kosha keeps its variables in one place."
              : 'An Admin needs to assign you to a project before it shows up here.'}
          </p>
          {isAdmin && !creating && (
            <button className="projects-add-btn" onClick={() => setCreating(true)}>
              + New project
            </button>
          )}
        </div>
      ) : visibleProjects.length === 0 ? (
        <p className="projects-empty">No projects match “{search}”.</p>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
          <table className="projects-table">
            <thead>
              <tr>
                {isAdmin && (
                  <th className="projects-th-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === pageProjects.length}
                      onChange={toggleSelectAll}
                      aria-label="Select all projects"
                    />
                  </th>
                )}
                <SortableHeader label="Project" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Environments" sortKey="environments" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Components" sortKey="components" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                {isAdmin && <th>Members</th>}
                <SortableHeader label="Last updated" sortKey="updatedAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {pageProjects.map((project) => (
                <ProjectTableRow
                  key={project.id}
                  project={project}
                  environmentsOpen={openEnvironmentsProjectId === project.id}
                  onToggleEnvironments={() =>
                    setOpenEnvironmentsProjectId((current) => (current === project.id ? null : project.id))
                  }
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
          <div className="projects-pagination">
            <div className="projects-pagination-info">
              <span>
                Showing {pageStart + 1}–{pageStart + pageProjects.length} of {visibleProjects.length} projects
              </span>
              <label>
                Rows per page
                <Select
                  value={String(rowsPerPage)}
                  onChange={(value) => {
                    setRowsPerPage(Number(value));
                    setPageIndex(0);
                  }}
                  options={PROJECT_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
                />
              </label>
            </div>
            {pageCount > 1 && (
              <nav className="projects-pagination-pages" aria-label="Pagination">
                <button disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}>
                  Previous
                </button>
                {Array.from({ length: pageCount }, (_, pageNumber) => (
                  <button
                    key={pageNumber}
                    className={pageNumber === currentPage ? 'projects-page-btn--current' : undefined}
                    aria-current={pageNumber === currentPage ? 'page' : undefined}
                    onClick={() => setPageIndex(pageNumber)}
                  >
                    {pageNumber + 1}
                  </button>
                ))}
                <button disabled={currentPage >= pageCount - 1} onClick={() => setPageIndex(currentPage + 1)}>
                  Next
                </button>
              </nav>
            )}
          </div>
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

const PROJECT_PAGE_SIZES = [10, 25, 50];

// Latest audited change when the API provides it (Admins), else the project
// row's own updatedAt (renames/archives only).
function lastUpdatedAt(project: ProjectSummary): string {
  return project.lastActivity?.at ?? project.updatedAt;
}

// Chips shown inline before collapsing the rest into a "+N" popover.
const VISIBLE_ENVIRONMENT_CHIPS = 3;

function ProjectTableRow({
  project,
  environmentsOpen,
  onToggleEnvironments,
  selected,
  isAdmin,
  deletePending,
  onToggleSelected,
  onOpen,
  onChange,
  onRequestDelete,
}: {
  project: ProjectSummary;
  environmentsOpen: boolean;
  onToggleEnvironments: () => void;
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
  // Viewport coordinates for the "+N" popover. It's position: fixed because
  // the table sits in a horizontal-scroll container, which would otherwise
  // clip it (overflow-x: auto clips vertically too).
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // A fixed popover doesn't follow its button, so close it when the page
  // scrolls or resizes — but not when the popover's own list scrolls.
  useEffect(() => {
    if (!environmentsOpen) return;
    function closeOnPageScroll(event: Event): void {
      if (popoverRef.current?.contains(event.target as Node)) return;
      onToggleEnvironments();
    }
    window.addEventListener('scroll', closeOnPageScroll, { capture: true });
    window.addEventListener('resize', onToggleEnvironments);
    return () => {
      window.removeEventListener('scroll', closeOnPageScroll, { capture: true });
      window.removeEventListener('resize', onToggleEnvironments);
    };
  }, [environmentsOpen, onToggleEnvironments]);

  function openEnvironments(button: HTMLElement): void {
    const buttonRect = button.getBoundingClientRect();
    const popoverWidth = 280;
    setPopoverPosition({
      top: buttonRect.bottom + 8,
      left: Math.max(8, Math.min(buttonRect.left, window.innerWidth - popoverWidth - 8)),
    });
    onToggleEnvironments();
  }

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
        <span className="projects-name">
          {project.name}
          {isArchived && <span className="project-archived-badge">Archived</span>}
        </span>
        {project.description ? (
          <span className="projects-description">{project.description}</span>
        ) : (
          <span className="projects-description projects-description--empty">No description</span>
        )}
      </td>
      <td className="projects-td-environments" onClick={(e) => e.stopPropagation()}>
        {project.environments.length === 0 ? (
          <span className="projects-muted">—</span>
        ) : (
          <div className="projects-env-chips">
            {project.environments.slice(0, VISIBLE_ENVIRONMENT_CHIPS).map((environment, environmentIndex) => (
              <Link
                key={environment.id}
                to={`/projects/${project.id}/environments/${environment.id}`}
                className="projects-env-chip"
              >
                <span className="projects-env-dot" style={{ background: environmentColor(environmentIndex) }} aria-hidden="true" />
                {environment.name}
              </Link>
            ))}
            {project.environments.length > VISIBLE_ENVIRONMENT_CHIPS && (
              <button
                className="projects-env-more"
                aria-expanded={environmentsOpen}
                aria-label={`Show all ${project.environments.length} environments`}
                onClick={(e) => (environmentsOpen ? onToggleEnvironments() : openEnvironments(e.currentTarget))}
              >
                +{project.environments.length - VISIBLE_ENVIRONMENT_CHIPS}
              </button>
            )}
            {environmentsOpen && popoverPosition && (
              <div
                ref={popoverRef}
                className="projects-env-popover"
                role="dialog"
                aria-label="All environments"
                style={{ top: popoverPosition.top, left: popoverPosition.left }}
              >
                <div className="projects-env-popover-header">
                  <span>{project.environments.length} environments</span>
                  <button className="icon-btn" aria-label="Close" onClick={onToggleEnvironments}>
                    <CloseIcon />
                  </button>
                </div>
                <ul>
                  {project.environments.map((environment, environmentIndex) => (
                    <li key={environment.id}>
                      <Link to={`/projects/${project.id}/environments/${environment.id}`}>
                        <span className="projects-env-dot" style={{ background: environmentColor(environmentIndex) }} aria-hidden="true" />
                        <span className="projects-env-popover-name">{environment.name}</span>
                        <ChevronRightIcon />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </td>
      <td className="projects-td-number">{project.components.length}</td>
      {isAdmin && <td className="projects-td-number">{project.memberCount ?? 0}</td>}
      <td className="projects-td-updated">
        {formatTimestamp(lastUpdatedAt(project))}
        {project.lastActivity?.byEmail && (
          <span className="projects-updated-by">{project.lastActivity.byEmail.split('@')[0]}</span>
        )}
      </td>
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
        <button className="icon-btn" aria-label={`Open ${project.name}`} title="Open" onClick={onOpen}>
          <ChevronRightIcon />
        </button>
      </td>
    </tr>
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

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
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
