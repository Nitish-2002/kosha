import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import { listProjects, type ProjectSummary } from '../api/projects';
import { listEnvironments, type EnvironmentSummary } from '../api/environments';
import {
  createAssignment,
  listAssignments,
  removeAssignment,
  type AssignmentSummary,
} from '../api/project-assignments';
import { Select } from './Select';
import { ConfirmDialog } from './ConfirmDialog';
import { ALL_COMPONENTS_KEY } from '../constants';
import './AccessDrawer.scss';

// A Member sees only what they hold a ProjectAssignment for (PRD — Core
// entities). Rather than a "view current access" list plus a separate
// "grant access" form that can drift out of sync (an admin picking a
// combination that already exists, only finding out after submitting),
// this is one live matrix per project: environments as rows, components as
// columns, a checked cell means granted. Clicking a cell grants or revokes
// it immediately — there's nothing to submit and no invalid state to hit.
type CellAction = 'grant' | 'revoke';

// `lockedProjectId` pins the drawer to one project (opened from that
// project's page) — the cross-project summary and project picker are hidden.
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
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(lockedProjectId ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Staged, not-yet-written changes — a click only marks a cell as pending;
  // nothing is granted or revoked until "Save changes" is clicked. A stray
  // click while scanning the matrix (or navigating away) should never by
  // itself change what a real Member can access.
  const [pendingChanges, setPendingChanges] = useState<Map<string, CellAction>>(new Map());
  const [confirmDiscard, setConfirmDiscard] = useState<(() => void) | null>(null);

  function refreshAssignments(): Promise<AssignmentSummary[]> {
    return listAssignments(member.id).then((assignmentsData) => {
      setAssignments(assignmentsData);
      return assignmentsData;
    });
  }

  useEffect(() => {
    Promise.all([listProjects(), refreshAssignments()])
      .then(([projectsData, assignmentsData]) => {
        setProjects(projectsData);
        // Land on a project the member is already assigned to, if any —
        // otherwise leave it to the admin to pick one.
        if (!lockedProjectId && assignmentsData.length > 0) setSelectedProjectId(assignmentsData[0].projectId);
      })
      .catch(() => showToast('Could not load access data.', 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  useEffect(() => {
    if (!selectedProjectId) {
      setEnvironments([]);
      return;
    }
    listEnvironments(selectedProjectId)
      .catch(() => [])
      .then((environmentsData) => setEnvironments(environmentsData ?? []));
  }, [selectedProjectId]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  // Read-only "what does this member actually have" overview, grouped by
  // project then environment — answers that at a glance instead of making
  // an admin click through each project's matrix one at a time to find out.
  const accessSummary = useMemo(() => {
    const projectOrder: string[] = [];
    const byProject = new Map<string, { projectName: string; environments: Map<string, string[]> }>();
    for (const assignment of assignments) {
      if (!byProject.has(assignment.projectId)) {
        byProject.set(assignment.projectId, { projectName: assignment.projectName, environments: new Map() });
        projectOrder.push(assignment.projectId);
      }
      const entry = byProject.get(assignment.projectId)!;
      const scopeLabel = assignment.componentName ?? 'All';
      const existing = entry.environments.get(assignment.environmentName) ?? [];
      entry.environments.set(assignment.environmentName, [...existing, scopeLabel]);
    }
    return projectOrder.map((projectId) => {
      const { projectName, environments } = byProject.get(projectId)!;
      const environmentSummaries = [...environments.entries()].map(
        ([environmentName, scopes]) => `${environmentName} (${scopes.includes('All') ? 'All' : scopes.join(', ')})`,
      );
      return { projectId, projectName, environmentSummaries };
    });
  }, [assignments]);

  // environmentId -> column key ('ALL' or componentId) -> assignment id
  const grantMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const assignment of assignments) {
      if (assignment.projectId !== selectedProjectId) continue;
      const key = assignment.projectComponentId ?? ALL_COMPONENTS_KEY;
      if (!map.has(assignment.environmentId)) map.set(assignment.environmentId, new Map());
      map.get(assignment.environmentId)!.set(key, assignment.id);
    }
    return map;
  }, [assignments, selectedProjectId]);

  // A click only stages a change locally — see the `pendingChanges` comment
  // above for why nothing is written to the server here.
  function stageCell(environmentId: string, columnKey: string): void {
    const cellId = `${environmentId}:${columnKey}`;
    setPendingChanges((prev) => {
      const next = new Map(prev);
      if (next.has(cellId)) {
        // Clicking a already-staged cell again cancels that staged change.
        next.delete(cellId);
      } else {
        const committedGranted = grantMap.get(environmentId)?.has(columnKey) ?? false;
        next.set(cellId, committedGranted ? 'revoke' : 'grant');
      }
      return next;
    });
  }

  function discardPendingChanges(): void {
    setPendingChanges(new Map());
  }

  // Switching projects or closing the drawer with staged-but-unsaved changes
  // would otherwise silently drop them with no trace — confirm first, same
  // as any other action that throws away unsaved work.
  function guardUnsavedChanges(action: () => void): void {
    if (pendingChanges.size === 0) {
      action();
      return;
    }
    setConfirmDiscard(() => action);
  }

  // Returns whether the save actually succeeded — callers that need to chain
  // a next step (like leaving the drawer) on a successful save, and not on
  // a failed one, check this instead of assuming the promise resolving means
  // it worked (errors here are caught and toasted, not rethrown).
  async function saveChanges(): Promise<boolean> {
    setSaving(true);
    try {
      const touchedEnvironmentIds = new Set<string>();
      for (const [cellId, action] of pendingChanges) {
        const [environmentId, columnKey] = cellId.split(':');
        touchedEnvironmentIds.add(environmentId);
        if (action === 'revoke') {
          const existingAssignmentId = grantMap.get(environmentId)?.get(columnKey);
          if (existingAssignmentId) await removeAssignment(existingAssignmentId);
        } else {
          await createAssignment(member.id, {
            projectId: selectedProjectId,
            environmentId,
            projectComponentId: columnKey === ALL_COMPONENTS_KEY ? undefined : columnKey,
          });
        }
      }

      // Checking every individual component by hand should mean the same
      // thing as checking "All" — not just visually, but for real: a
      // component added to the project later is only covered by an actual
      // "All" grant, not by a pile of per-component ones that happened to
      // add up to the current full set. So once a row ends up with every
      // component granted, replace those grants with a single wildcard one.
      const afterRawApply = await refreshAssignments();
      const componentIds = (selectedProject?.components ?? []).map((component) => component.id);
      let consolidatedAny = false;
      for (const environmentId of touchedEnvironmentIds) {
        const rowAssignments = afterRawApply.filter(
          (assignment) => assignment.projectId === selectedProjectId && assignment.environmentId === environmentId,
        );
        const alreadyAll = rowAssignments.some((assignment) => assignment.projectComponentId === null);
        const grantedComponentIds = new Set(
          rowAssignments
            .filter((assignment) => assignment.projectComponentId !== null)
            .map((assignment) => assignment.projectComponentId!),
        );
        const everyComponentGranted =
          componentIds.length > 0 && componentIds.every((componentId) => grantedComponentIds.has(componentId));
        if (!alreadyAll && everyComponentGranted) {
          await createAssignment(member.id, { projectId: selectedProjectId, environmentId, projectComponentId: undefined });
          await Promise.all(
            rowAssignments
              .filter((assignment) => assignment.projectComponentId !== null)
              .map((assignment) => removeAssignment(assignment.id)),
          );
          consolidatedAny = true;
        }
      }

      const changeCount = pendingChanges.size;
      setPendingChanges(new Map());
      await refreshAssignments();
      showToast(
        consolidatedAny
          ? `${changeCount} change(s) saved — some rows consolidated into "All".`
          : `${changeCount} change(s) saved.`,
      );
      return true;
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save those changes.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="access-drawer-backdrop" onClick={() => guardUnsavedChanges(onClose)} />
      <div className="access-drawer" role="dialog" aria-modal="true" aria-label={`Manage access for ${member.email}`}>
        <div className="access-drawer-header">
          <div>
            <span className="access-drawer-eyebrow">
              {lockedProjectId && selectedProject ? `Access · ${selectedProject.name}` : 'Access'}
            </span>
            <h2>{member.email}</h2>
          </div>
          <button className="access-drawer-close" aria-label="Close" onClick={() => guardUnsavedChanges(onClose)}>
            <CloseIcon />
          </button>
        </div>

        <div className="access-drawer-body">
          {loading ? (
            <p className="access-drawer-empty">Loading…</p>
          ) : (
            <>
              {!lockedProjectId && (
                <section className="access-drawer-section">
                  <h3>Current access</h3>
                  {accessSummary.length === 0 ? (
                    <p className="access-drawer-empty">Not assigned to any project yet.</p>
                  ) : (
                    <ul className="access-summary-list">
                      {accessSummary.map((group) => (
                        <li key={group.projectId}>
                          <button
                            className={
                              group.projectId === selectedProjectId
                                ? 'access-summary-item access-summary-item--active'
                                : 'access-summary-item'
                            }
                            onClick={() => guardUnsavedChanges(() => setSelectedProjectId(group.projectId))}
                          >
                            <span className="access-summary-project">{group.projectName}</span>
                            <span className="access-summary-detail">{group.environmentSummaries.join(' · ')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section className="access-drawer-section">
                <h3>Edit access</h3>
                {!lockedProjectId && (
                  <label className="access-project-select">
                    Project
                    <Select
                      value={selectedProjectId}
                      onChange={(value) => guardUnsavedChanges(() => setSelectedProjectId(value))}
                      options={projects.map((project) => ({ value: project.id, label: project.name }))}
                      placeholder="Select a project"
                      searchable
                    />
                  </label>
                )}

                {!selectedProjectId ? (
                  <p className="access-drawer-empty">Pick a project to manage its access.</p>
                ) : environments.length === 0 ? (
                  <p className="access-drawer-empty">This project has no environments yet.</p>
                ) : (
                  <div className="access-matrix-wrap">
                    <table className="access-matrix">
                      <thead>
                        <tr>
                          <th />
                          <th>All</th>
                          {selectedProject?.components.map((component) => <th key={component.id}>{component.name}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {environments.map((environment) => {
                          const allCommittedGranted = grantMap.get(environment.id)?.has(ALL_COMPONENTS_KEY) ?? false;
                          const allPending = pendingChanges.get(`${environment.id}:${ALL_COMPONENTS_KEY}`);
                          return (
                            <tr key={environment.id}>
                              <th scope="row">{environment.name}</th>
                              <MatrixCell
                                checked={allCommittedGranted}
                                pending={allPending}
                                onToggle={() => stageCell(environment.id, ALL_COMPONENTS_KEY)}
                              />
                              {(selectedProject?.components ?? []).map((component) => {
                                const directlyGranted = grantMap.get(environment.id)?.has(component.id) ?? false;
                                return (
                                  <MatrixCell
                                    key={component.id}
                                    checked={directlyGranted}
                                    // Covered by the row's committed "All" grant — shown as
                                    // implicitly on rather than empty, since it reads as
                                    // "not granted" otherwise even though it is. Computed off
                                    // the committed state only: it doesn't shift around while
                                    // a change to "All" is merely staged, only once saved.
                                    implied={allCommittedGranted && !directlyGranted}
                                    pending={pendingChanges.get(`${environment.id}:${component.id}`)}
                                    onToggle={() => stageCell(environment.id, component.id)}
                                  />
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {selectedProjectId && environments.length > 0 && (
                  <>
                    <p className="access-matrix-hint">
                      Click a cell to stage a change, then save. <strong>All</strong> covers every component,
                      including ones added later.
                    </p>
                    {pendingChanges.size > 0 && (
                      <div className="access-save-bar">
                        <span>
                          {pendingChanges.size} unsaved change{pendingChanges.size === 1 ? '' : 's'}
                        </span>
                        <button onClick={discardPendingChanges} disabled={saving}>
                          Discard
                        </button>
                        <button className="access-save-btn" onClick={() => void saveChanges()} disabled={saving}>
                          {saving ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Unsaved changes"
          message={`You have ${pendingChanges.size} unsaved access change${pendingChanges.size === 1 ? '' : 's'}. Save ${pendingChanges.size === 1 ? 'it' : 'them'} before leaving, or discard ${pendingChanges.size === 1 ? 'it' : 'them'}?`}
          confirmLabel="Discard"
          primaryLabel="Save changes"
          onConfirm={() => {
            const action = confirmDiscard;
            setConfirmDiscard(null);
            discardPendingChanges();
            action?.();
          }}
          onPrimary={() => {
            const action = confirmDiscard;
            setConfirmDiscard(null);
            void saveChanges().then((saved) => {
              if (saved) action?.();
            });
          }}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </>
  );
}

function MatrixCell({
  checked,
  implied = false,
  pending,
  onToggle,
}: {
  checked: boolean;
  // Granted only because the row's "All" column covers it, not by its own
  // assignment — shown on but not independently toggleable.
  implied?: boolean;
  // A staged-but-not-yet-saved change to this cell — 'grant' shows on even
  // though it isn't yet, 'revoke' keeps showing on (it still is, for now)
  // but marked as about to go away. Either way nothing has actually been
  // written until "Save changes" is clicked.
  pending?: CellAction;
  onToggle: () => void;
}) {
  const on = pending === 'grant' || (pending !== 'revoke' && (checked || implied));
  const classes = ['access-matrix-cell'];
  if (pending === 'grant') classes.push('access-matrix-cell--pending-grant');
  else if (pending === 'revoke') classes.push('access-matrix-cell--pending-revoke');
  else if (checked) classes.push('access-matrix-cell--granted');
  else if (implied) classes.push('access-matrix-cell--implied');

  const label = implied
    ? 'Covered by All — revoke All to change this'
    : pending === 'grant'
      ? 'Cancel staged grant'
      : pending === 'revoke'
        ? 'Cancel staged revoke'
        : checked
          ? 'Stage revoke'
          : 'Stage grant';

  return (
    <td className={classes.join(' ')}>
      <button
        className="access-matrix-toggle"
        aria-pressed={on}
        aria-label={label}
        title={implied ? 'Covered by "All" — revoke "All" to change this individually' : undefined}
        disabled={implied}
        onClick={onToggle}
      >
        {on && <CheckIcon />}
      </button>
    </td>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 12.75l6 6 9-13.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
