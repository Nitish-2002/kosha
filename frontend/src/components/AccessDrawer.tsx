import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import { listProjects, type ProjectSummary } from '../api/projects';
import {
  createAssignment,
  listAssignments,
  removeAssignment,
  type AssignmentSummary,
} from '../api/project-assignments';
import { Select } from './Select';
import { ConfirmDialog } from './ConfirmDialog';
import { environmentColor } from '../lib/environmentColor';
import './AccessDrawer.scss';

// A Member sees only what they hold a ProjectAssignment for (PRD — Core
// entities). Per environment the Admin picks None or Access, and for Access
// either All components (one wildcard assignment — also covers components
// added later) or a Selected set (one assignment per component). Changes are
// staged and only written on "Save changes" — a stray click never changes
// what a real Member can access by itself.
interface EnvironmentAccess {
  projectId: string;
  hasAccess: boolean;
  allComponents: boolean;
  componentIds: string[];
}

type AccessDraft = Record<string, EnvironmentAccess>; // environmentId → access

function accessFromAssignments(assignments: AssignmentSummary[]): AccessDraft {
  const draft: AccessDraft = {};
  for (const assignment of assignments) {
    const entry = draft[assignment.environmentId] ?? {
      projectId: assignment.projectId,
      hasAccess: true,
      allComponents: false,
      componentIds: [],
    };
    if (assignment.projectComponentId === null) entry.allComponents = true;
    else entry.componentIds = [...entry.componentIds, assignment.projectComponentId];
    draft[assignment.environmentId] = entry;
  }
  return draft;
}

const NO_ACCESS = (projectId: string): EnvironmentAccess => ({
  projectId,
  hasAccess: false,
  allComponents: true,
  componentIds: [],
});

function sameAccess(first: EnvironmentAccess, second: EnvironmentAccess): boolean {
  if (first.hasAccess !== second.hasAccess) return false;
  if (!first.hasAccess) return true;
  if (first.allComponents !== second.allComponents) return false;
  return first.allComponents || [...first.componentIds].sort().join() === [...second.componentIds].sort().join();
}

// `lockedProjectId` pins the drawer to one project (opened from that
// project's Settings → Access) — no other project cards, no "Add project".
export function AccessDrawer({
  member,
  lockedProjectId,
  onClose,
}: {
  member: { id: string; email: string };
  lockedProjectId?: string;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [draft, setDraft] = useState<AccessDraft>({});
  const [shownProjectIds, setShownProjectIds] = useState<string[]>([]);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function loadAssignments(): Promise<AssignmentSummary[]> {
    return listAssignments(member.id).then((assignmentsData) => {
      setAssignments(assignmentsData);
      setDraft(accessFromAssignments(assignmentsData));
      return assignmentsData;
    });
  }

  useEffect(() => {
    Promise.all([listProjects(), loadAssignments()])
      .then(([projectsData, assignmentsData]) => {
        setProjects(projectsData);
        setShownProjectIds(
          lockedProjectId ? [lockedProjectId] : [...new Set(assignmentsData.map((assignment) => assignment.projectId))],
        );
      })
      .catch(() => showToast('Could not load access data.', 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  const savedAccess = useMemo(() => accessFromAssignments(assignments), [assignments]);

  function accessFor(environmentId: string, projectId: string, source: AccessDraft): EnvironmentAccess {
    return source[environmentId] ?? NO_ACCESS(projectId);
  }

  const changedEnvironmentIds = projects
    .flatMap((project) => project.environments.map((environment) => ({ environment, project })))
    .filter(
      ({ environment, project }) =>
        !sameAccess(accessFor(environment.id, project.id, draft), accessFor(environment.id, project.id, savedAccess)),
    )
    .map(({ environment }) => environment.id);

  // "Selected" with nothing ticked isn't a valid grant — make them pick one or choose None.
  const hasEmptySelection = Object.values(draft).some(
    (access) => access.hasAccess && !access.allComponents && access.componentIds.length === 0,
  );

  function updateAccess(environmentId: string, projectId: string, patch: Partial<EnvironmentAccess>): void {
    setDraft((current) => ({
      ...current,
      [environmentId]: { ...accessFor(environmentId, projectId, current), ...patch },
    }));
  }

  function toggleComponent(environmentId: string, projectId: string, componentId: string): void {
    const current = accessFor(environmentId, projectId, draft);
    updateAccess(environmentId, projectId, {
      componentIds: current.componentIds.includes(componentId)
        ? current.componentIds.filter((id) => id !== componentId)
        : [...current.componentIds, componentId],
    });
  }

  async function saveChanges(): Promise<boolean> {
    setSaving(true);
    try {
      for (const environmentId of changedEnvironmentIds) {
        const project = projects.find((candidate) =>
          candidate.environments.some((environment) => environment.id === environmentId),
        )!;
        const wanted = accessFor(environmentId, project.id, draft);
        // Every component ticked by hand means "All" for real — a wildcard
        // grant also covers components added to the project later.
        const allComponents =
          wanted.allComponents ||
          (project.components.length > 0 &&
            project.components.every((component) => wanted.componentIds.includes(component.id)));
        // null = the wildcard ("All components") assignment.
        const wantedKeys: (string | null)[] = !wanted.hasAccess ? [] : allComponents ? [null] : wanted.componentIds;
        const existing = assignments.filter((assignment) => assignment.environmentId === environmentId);

        for (const assignment of existing) {
          if (!wantedKeys.includes(assignment.projectComponentId)) await removeAssignment(assignment.id);
        }
        for (const projectComponentId of wantedKeys) {
          if (!existing.some((assignment) => assignment.projectComponentId === projectComponentId)) {
            await createAssignment(member.id, {
              projectId: project.id,
              environmentId,
              projectComponentId: projectComponentId ?? undefined,
            });
          }
        }
      }
      const changeCount = changedEnvironmentIds.length;
      await loadAssignments();
      showToast(`${changeCount} change${changeCount === 1 ? '' : 's'} saved.`);
      return true;
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save those changes.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function discardChanges(): void {
    setDraft(accessFromAssignments(assignments));
  }

  function requestClose(): void {
    if (changedEnvironmentIds.length > 0) setConfirmDiscard(true);
    else onClose();
  }

  function toggleProjectCard(projectId: string): void {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  const shownProjects = shownProjectIds
    .map((projectId) => projects.find((project) => project.id === projectId))
    .filter((project): project is ProjectSummary => project !== undefined);
  const addableProjects = projects.filter((project) => !shownProjectIds.includes(project.id));
  const changeCount = changedEnvironmentIds.length;

  return (
    <>
      <div className="access-drawer-backdrop" onClick={requestClose} />
      <div className="access-drawer" role="dialog" aria-modal="true" aria-label={`Manage access for ${member.email}`}>
        <div className="access-drawer-header">
          <span className="access-drawer-avatar" aria-hidden="true">
            {member.email[0].toUpperCase()}
          </span>
          <div className="access-drawer-title">
            <span className="access-drawer-eyebrow">Manage access</span>
            <h2>{member.email}</h2>
          </div>
          <button className="access-drawer-close" aria-label="Close" onClick={requestClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="access-drawer-body">
          <p className="access-drawer-note">
            <LockIcon />
            Secret values are always masked for members. Only admins can reveal them.
          </p>

          {loading ? (
            <p className="access-drawer-empty">Loading…</p>
          ) : (
            <>
              {shownProjects.length === 0 && (
                <p className="access-drawer-empty">No project access yet. Add a project below.</p>
              )}

              {shownProjects.map((project) => {
                const open = !collapsedProjectIds.has(project.id);
                const grantedCount = project.environments.filter(
                  (environment) => accessFor(environment.id, project.id, draft).hasAccess,
                ).length;
                return (
                  <section key={project.id} className="access-project">
                    <button className="access-project-header" aria-expanded={open} onClick={() => toggleProjectCard(project.id)}>
                      <span className="access-project-name">{project.name}</span>
                      <span className="access-project-summary">
                        {grantedCount} of {project.environments.length} environments
                      </span>
                      <ChevronIcon open={open} />
                    </button>

                    {open &&
                      (project.environments.length === 0 ? (
                        <p className="access-drawer-empty">This project has no environments yet.</p>
                      ) : (
                        project.environments.map((environment, environmentIndex) => {
                          const access = accessFor(environment.id, project.id, draft);
                          const changed = changedEnvironmentIds.includes(environment.id);
                          return (
                            <div
                              key={environment.id}
                              className={`access-environment${changed ? ' access-environment--changed' : ''}`}
                            >
                              <div className="access-environment-row">
                                <span
                                  className="access-environment-dot"
                                  style={{ background: environmentColor(environmentIndex) }}
                                  aria-hidden="true"
                                />
                                <span className="access-environment-name">
                                  {environment.name}
                                  {changed && <span className="access-unsaved">Unsaved</span>}
                                </span>
                                <div className="access-level" role="radiogroup" aria-label={`${environment.name} access`}>
                                  <button
                                    role="radio"
                                    aria-checked={!access.hasAccess}
                                    onClick={() => updateAccess(environment.id, project.id, { hasAccess: false })}
                                  >
                                    None
                                  </button>
                                  <button
                                    role="radio"
                                    aria-checked={access.hasAccess}
                                    onClick={() => updateAccess(environment.id, project.id, { hasAccess: true })}
                                  >
                                    Access
                                  </button>
                                </div>
                              </div>

                              {access.hasAccess && (
                                <div className="access-scope">
                                  <div className="access-scope-row">
                                    <span className="access-scope-label">Components</span>
                                    <div className="access-scope-options" role="radiogroup" aria-label="Component scope">
                                      <button
                                        role="radio"
                                        aria-checked={access.allComponents}
                                        onClick={() => updateAccess(environment.id, project.id, { allComponents: true })}
                                      >
                                        All components
                                      </button>
                                      <button
                                        role="radio"
                                        aria-checked={!access.allComponents}
                                        onClick={() => updateAccess(environment.id, project.id, { allComponents: false })}
                                      >
                                        Selected ({access.componentIds.length})
                                      </button>
                                    </div>
                                  </div>
                                  {access.allComponents ? (
                                    <span className="access-scope-hint">
                                      Includes all {project.components.length} components and any added later.
                                    </span>
                                  ) : (
                                    <div className="access-component-chips">
                                      {project.components.map((component) => (
                                        <button
                                          key={component.id}
                                          aria-pressed={access.componentIds.includes(component.id)}
                                          onClick={() => toggleComponent(environment.id, project.id, component.id)}
                                        >
                                          {component.name}
                                        </button>
                                      ))}
                                      {access.componentIds.length === 0 && (
                                        <span className="access-scope-warning">Pick at least one component.</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ))}
                  </section>
                );
              })}

              {!lockedProjectId && addableProjects.length > 0 && (
                <div className="access-add-project">
                  <Select
                    value=""
                    onChange={(projectId) => setShownProjectIds((current) => [...current, projectId])}
                    options={addableProjects.map((project) => ({ value: project.id, label: project.name }))}
                    placeholder="+ Add project access"
                    searchable={addableProjects.length > 8}
                  />
                </div>
              )}

              <p className="access-drawer-footnote">
                Access lets them see and edit this environment's variables. Deletes and rollbacks still go to an Admin
                for approval.
              </p>
            </>
          )}
        </div>

        <div className="access-drawer-footer">
          <span className={changeCount > 0 ? 'access-footer-count access-footer-count--changed' : 'access-footer-count'}>
            {changeCount > 0 ? `${changeCount} unsaved change${changeCount === 1 ? '' : 's'}` : 'No changes'}
          </span>
          <button className="outline-btn" onClick={discardChanges} disabled={changeCount === 0 || saving}>
            Discard
          </button>
          <button
            className="access-save-btn"
            onClick={() => void saveChanges()}
            disabled={changeCount === 0 || saving || hasEmptySelection}
          >
            {saving ? 'Saving…' : changeCount > 0 ? `Save changes (${changeCount})` : 'Save changes'}
          </button>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Unsaved changes"
          message={`You have ${changeCount} unsaved access change${changeCount === 1 ? '' : 's'}. Save before leaving, or discard?`}
          confirmLabel="Discard"
          primaryLabel="Save changes"
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
          onPrimary={() => {
            setConfirmDiscard(false);
            void saveChanges().then((saved) => {
              if (saved) onClose();
            });
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
