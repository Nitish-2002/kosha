import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import { parseGithubRepoUrl } from '../lib/githubUrl';
import { addComponent, getProject, removeComponent, updateProject, type ProjectSummary } from '../api/projects';
import { createCredential, listCredentials, type CredentialSummary, type CredentialType } from '../api/credentials';
import {
  addComponentConfig,
  createEnvironment,
  deleteEnvironment,
  listComponentConfigs,
  listEnvironments,
  previewGithubBulk,
  removeComponentConfig,
  testConnection,
  updateComponentConfig,
  type ComponentConfigSourceType,
  type ComponentConfigSummary,
  type EnvironmentSummary,
  type GithubBulkPreviewRow,
  type TestConnectionInput,
} from '../api/environments';
import {
  commitImport,
  createVariable,
  deleteVariable,
  getVariableHistory,
  listVariables,
  previewImport,
  revealVariable,
  rollbackVariable,
  updateSecretFlag,
  updateVariable,
  type ImportPlan,
  type VariableHistoryEntry,
  type VariableSummary,
} from '../api/variables';
import { listProjectAssignments, type AssignmentSummary } from '../api/project-assignments';
import { listUsers, type UserSummary } from '../api/users';
import { AccessDrawer } from '../components/AccessDrawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Select } from '../components/Select';
import { SECRET_REVEAL_DURATION_MS, VARIABLES_PAGE_SIZE } from '../constants';
import { fetchMyPendingKeys, pendingKey } from '../lib/pendingRequests';
import './ProjectDetailPage.scss';

interface MergedVariableRow extends VariableSummary {
  configId: string;
  projectComponentId: string;
  componentName: string;
  sourceType: ComponentConfigSourceType;
}

type ConnectionTestState = { status: 'idle' } | { status: 'testing' } | { status: 'success' } | { status: 'error'; message: string };

// Shared by AddConfigForm and EditConfigForm — a read-only check, never
// blocks Connect/Save (an untested or failed test doesn't stop submission;
// it's a heads-up, not a gate you can't get past if you're confident).
function useConnectionTest() {
  const [state, setState] = useState<ConnectionTestState>({ status: 'idle' });

  async function run(input: TestConnectionInput): Promise<void> {
    setState({ status: 'testing' });
    try {
      await testConnection(input);
      setState({ status: 'success' });
    } catch (err) {
      setState({ status: 'error', message: err instanceof ApiError ? err.message : 'Could not test that connection.' });
    }
  }

  function reset(): void {
    setState({ status: 'idle' });
  }

  return { state, run, reset };
}

function TestConnectionButton({ state, onTest, disabled }: { state: ConnectionTestState; onTest: () => void; disabled: boolean }) {
  return (
    <div className="test-connection-row">
      <button type="button" onClick={onTest} disabled={disabled || state.status === 'testing'}>
        {state.status === 'testing' ? 'Testing…' : 'Test Connection'}
      </button>
      {state.status === 'success' && <span className="test-connection-result test-connection-result--success">✓ Connected</span>}
      {state.status === 'error' && <span className="test-connection-result test-connection-result--error">{state.message}</span>}
    </div>
  );
}

// Lets a credential be created without leaving the wiring form — the new
// credential is reported back via onCreated so the caller can both add it to
// the shared credentials list (no full refetch needed) and auto-select it.
function InlineCredentialForm({
  type,
  onCancel,
  onCreated,
}: {
  type: CredentialType;
  onCancel: () => void;
  onCreated: (credential: CredentialSummary) => void;
}) {
  const [label, setLabel] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [username, setUsername] = useState('');
  const [pat, setPat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const credential = await createCredential({
        type,
        label,
        accessKeyId: type === 'aws' ? accessKeyId : undefined,
        secretAccessKey: type === 'aws' ? secretAccessKey : undefined,
        username: type === 'github' ? username : undefined,
        pat: type === 'github' ? pat : undefined,
      });
      onCreated(credential);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  // A plain <div>, not a <form> — this always renders nested inside the
  // wiring form's own <form> (AddConfigForm/EditConfigForm), and HTML
  // doesn't allow nested forms (the browser silently reparents the inner
  // one, breaking React's DOM). Enter still submits it via onKeyDown below,
  // stopped from also bubbling up to the outer form's own submit.
  return (
    <div
      className="inline-credential-form"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void handleSubmit();
        }
      }}
    >
      <label>
        Label
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Client X prod" required />
      </label>
      {type === 'aws' ? (
        <>
          <label>
            Access key ID
            <input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} required />
          </label>
          <label>
            Secret access key
            <input type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} required />
          </label>
        </>
      ) : (
        <>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. octocat" required />
          </label>
          <label>
            Personal access token
            <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} required />
          </label>
        </>
      )}
      {error && <p className="project-detail-error">{error}</p>}
      <div className="project-detail-header-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className="project-detail-add-btn" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? 'Saving…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

export function ProjectDetailPage() {
  const { projectId, environmentId: routedEnvironmentId } = useParams<{ projectId: string; environmentId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { showToast } = useToast();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [configs, setConfigs] = useState<ComponentConfigSummary[]>([]);
  const [variables, setVariables] = useState<MergedVariableRow[]>([]);
  const [loadingProject, setLoadingProject] = useState(true);
  const [loadingEnv, setLoadingEnv] = useState(true);
  const [creatingEnv, setCreatingEnv] = useState(false);
  const [activeTab, setActiveTab] = useState<ProjectTab>('variables');
  // The Member's own requests still awaiting review, so the item shows
  // "…requested" instead of inviting a duplicate. Admins act directly and
  // never file requests, so they skip the call.
  const [myPendingKeys, setMyPendingKeys] = useState<Set<string>>(new Set());

  function refreshProject(): void {
    if (!projectId) return;
    if (!isAdmin) fetchMyPendingKeys().then(setMyPendingKeys).catch(() => undefined);
    Promise.all([getProject(projectId), listEnvironments(projectId)])
      .then(([projectData, environmentsData]) => {
        setProject(projectData);
        setEnvironments(environmentsData);
      })
      .catch(() => showToast('Could not load this project.', 'error'))
      .finally(() => setLoadingProject(false));

    // Credentials are Admin-only (403 for a Member) and only used here for
    // the Admin "wire up a component" picker — fetched separately so a
    // Member's 403 on this call can never take down the project/environments
    // load above via a shared Promise.all.
    if (isAdmin) {
      listCredentials()
        .then(setCredentials)
        .catch(() => undefined);
    }
  }

  useEffect(refreshProject, [projectId, showToast, isAdmin]);

  // No environment in the URL yet — land on the first one, same as the
  // reference project's behavior, rather than showing an empty shell.
  useEffect(() => {
    if (!loadingProject && !routedEnvironmentId && environments.length > 0) {
      navigate(`/projects/${projectId}/environments/${environments[0].id}`, { replace: true });
    }
  }, [loadingProject, routedEnvironmentId, environments, projectId, navigate]);

  const activeEnvironmentId = routedEnvironmentId ?? (environments.length > 0 ? environments[0].id : undefined);

  function refreshEnvironment(): void {
    // No active environment means environments.length === 0, which already
    // short-circuits to its own empty state below — this loading flag is
    // never rendered in that case, so there's nothing to synchronize here.
    if (!activeEnvironmentId) return;
    if (!isAdmin) fetchMyPendingKeys().then(setMyPendingKeys).catch(() => undefined);
    // loadingEnv is a one-time "first load" flag, same convention as every
    // other page's `loading` state in this codebase — a later tab switch
    // just replaces configs/variables in place once its fetch resolves,
    // rather than re-arming a spinner (which would mean calling setState
    // synchronously at the top of this effect on every re-run).
    listComponentConfigs(activeEnvironmentId)
      .then(async (configsData) => {
        setConfigs(configsData);
        // allSettled, not all — one broken component (e.g. a GitHub path
        // that doesn't parse as plain YAML) shouldn't blank out every other
        // component's variables too; its specific error still surfaces below.
        const results = await Promise.allSettled(
          configsData.map((config) => listVariables(activeEnvironmentId, config.id)),
        );
        const firstFailure = results.find((r) => r.status === 'rejected') as
          | PromiseRejectedResult
          | undefined;
        if (firstFailure) {
          showToast(
            firstFailure.reason instanceof ApiError
              ? firstFailure.reason.message
              : 'Could not load one of this environment\'s components.',
            'error',
          );
        }
        setVariables(
          configsData.flatMap((config, index) => {
            const result = results[index];
            if (result.status !== 'fulfilled') return [];
            return result.value.map((variable) => ({
              ...variable,
              configId: config.id,
              projectComponentId: config.projectComponentId,
              componentName: config.componentName,
              sourceType: config.sourceType,
            }));
          }),
        );
      })
      .catch(() => showToast('Could not load this environment.', 'error'))
      .finally(() => setLoadingEnv(false));
  }

  useEffect(refreshEnvironment, [activeEnvironmentId, showToast, isAdmin]);

  async function deleteEnvironmentNow(target: EnvironmentSummary): Promise<void> {
    try {
      const result = await deleteEnvironment(target.id);
      if (result.status === 'requested') {
        showToast(`Delete request for "${target.name}" submitted for Admin approval.`);
      } else {
        showToast(`"${target.name}" deleted.`);
        if (target.id === activeEnvironmentId) {
          navigate(`/projects/${projectId}`, { replace: true });
        }
      }
      refreshProject();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not delete that environment.', 'error');
    }
  }

  if (loadingProject) {
    return (
      <div className="project-detail-page">
        <p className="project-detail-empty">Loading…</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="project-detail-page">
        <p className="project-detail-empty">Project not found.</p>
      </div>
    );
  }

  const activeEnvironment = environments.find((environment) => environment.id === activeEnvironmentId) ?? null;
  const noEnvironmentMessage = (
    <p className="project-detail-empty">
      {isAdmin ? 'No environments yet — add one with + next to the environment picker.' : 'No environments yet.'}
    </p>
  );

  return (
    <div className="project-detail-page">
      <div className="project-hero">
        <div className="project-hero-text">
          <nav className="project-breadcrumb" aria-label="Breadcrumb">
            <Link to="/projects">All projects</Link>
            <span aria-hidden="true">/</span>
            <span>{project.name}</span>
          </nav>
          <div className="project-title-row">
            <h1>{project.name}</h1>
            {project.description && <span>{project.description}</span>}
          </div>
        </div>

        <div className="project-hero-actions">
          <span className="env-switch-label">Environment</span>
          <div className="env-switch" role="group" aria-label="Environment">
            {environments.map((environment) => (
              <Link
                key={environment.id}
                to={`/projects/${projectId}/environments/${environment.id}`}
                aria-current={environment.id === activeEnvironmentId ? 'page' : undefined}
                className={`env-switch-option${environment.id === activeEnvironmentId ? ' env-switch-option--active' : ''}`}
              >
                <span className="env-switch-dot" aria-hidden="true" />
                {environment.name}
              </Link>
            ))}
            {isAdmin && (
              <button
                className="env-switch-add"
                aria-label={creatingEnv ? 'Close new environment form' : 'New environment'}
                title="New environment"
                onClick={() => setCreatingEnv((open) => !open)}
              >
                <PlusIcon />
              </button>
            )}
          </div>
          {environments.length >= 2 && (
            <Link to={`/projects/${projectId}/compare`} className="outline-btn">
              <CompareIcon /> Compare
            </Link>
          )}
        </div>
      </div>

      {isAdmin && creatingEnv && (
        <EnvironmentForm
          projectId={project.id}
          onCancel={() => setCreatingEnv(false)}
          onSaved={(message) => {
            showToast(message);
            setCreatingEnv(false);
            refreshProject();
          }}
        />
      )}

      <nav className="project-tabs" aria-label="Project sections">
        {PROJECT_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`project-tab${activeTab === tab.id ? ' project-tab--active' : ''}`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'variables' && activeEnvironment && <span className="project-tab-count">{variables.length}</span>}
            {tab.id === 'sources' && activeEnvironment && <span className="project-tab-count">{configs.length}</span>}
          </button>
        ))}
      </nav>

      {activeTab === 'variables' &&
        (!activeEnvironment ? (
          noEnvironmentMessage
        ) : loadingEnv ? (
          <p className="project-detail-empty">Loading variables…</p>
        ) : (
          <VariablesSection
            environment={activeEnvironment}
            configs={configs}
            variables={variables}
            isAdmin={isAdmin}
            pendingKeys={myPendingKeys}
            onChange={refreshEnvironment}
          />
        ))}

      {activeTab === 'sources' &&
        (!activeEnvironment ? (
          noEnvironmentMessage
        ) : (
          <ConnectionsSummary
            environment={activeEnvironment}
            project={project}
            configs={configs}
            credentials={credentials}
            isAdmin={isAdmin}
            pendingKeys={myPendingKeys}
            onChange={refreshEnvironment}
            onCredentialCreated={(credential) => setCredentials((prev) => [...prev, credential])}
          />
        ))}

      {activeTab === 'settings' && (
        <div className="settings-list">
          <SettingsRow title="General" description="Project name and description shown across Kosha.">
            <ProjectGeneralForm project={project} isAdmin={isAdmin} onChange={refreshProject} />
          </SettingsRow>

          <SettingsRow title="Components" description="Services in this project. Each environment connects them to a source.">
            <ComponentsEditor project={project} isAdmin={isAdmin} onChange={refreshProject} />
          </SettingsRow>

          {isAdmin && (
            <SettingsRow title="Access" description="Which members can see each environment and component.">
              <ProjectMembers projectId={project.id} />
            </SettingsRow>
          )}

          <SettingsRow title="Environments" description="Switch to an environment to see its variables and sources.">
            {environments.length === 0 ? (
              noEnvironmentMessage
            ) : (
              <ul className="settings-environment-list">
                {environments.map((environment) => (
                  <li key={environment.id}>
                    <Link
                      to={`/projects/${projectId}/environments/${environment.id}`}
                      className="settings-environment-row"
                    >
                      <span className="env-switch-dot" aria-hidden="true" />
                      <span className="settings-environment-name">{environment.name}</span>
                      {environment.id === activeEnvironmentId && <span className="chip">Viewing</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SettingsRow>

          {activeEnvironment && (
            <SettingsRow
              title="Danger zone"
              description={isAdmin ? 'Irreversible actions.' : 'Deletion needs Admin approval.'}
              danger
            >
              <EnvironmentDangerZone
                key={activeEnvironment.id}
                environment={activeEnvironment}
                isAdmin={isAdmin}
                deletionRequested={myPendingKeys.has(pendingKey.environment(activeEnvironment.id))}
                onDelete={() => deleteEnvironmentNow(activeEnvironment)}
              />
            </SettingsRow>
          )}
        </div>
      )}
    </div>
  );
}

type ProjectTab = 'variables' | 'sources' | 'settings';

const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'variables', label: 'Variables' },
  { id: 'sources', label: 'Sources' },
  { id: 'settings', label: 'Settings' },
];

// One Settings block: label column on the left, content on the right
// (stacks to a single column on narrow screens).
function SettingsRow({
  title,
  description,
  danger = false,
  children,
}: {
  title: string;
  description: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`settings-row${danger ? ' settings-row--danger' : ''}`}>
      <div className="settings-row-label">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="settings-row-content">{children}</div>
    </section>
  );
}

// Typing the environment's name arms the button, so a stray click can't
// delete (or request deleting) the wrong environment.
function EnvironmentDangerZone({
  environment,
  isAdmin,
  deletionRequested,
  onDelete,
}: {
  environment: EnvironmentSummary;
  isAdmin: boolean;
  deletionRequested: boolean;
  onDelete: () => Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const armed = confirmText.trim() === environment.name;

  async function handleDelete(): Promise<void> {
    setBusy(true);
    await onDelete();
    setBusy(false);
    setConfirmText('');
  }

  return (
    <div className="danger-zone">
      <h3>{isAdmin ? `Delete the ${environment.name} environment` : `Request deletion of ${environment.name}`}</h3>
      <p>
        {isAdmin
          ? `Removes ${environment.name} and all its component connections from Kosha. Variables stored in S3 and GitHub are not touched.`
          : `Sends a delete request for ${environment.name} to an Admin. Nothing changes until they approve.`}
      </p>
      {deletionRequested ? (
        <span className="pending-badge">Deletion requested</span>
      ) : (
        <>
          <label htmlFor="danger-zone-confirm">
            Type <code>{environment.name}</code> to confirm
          </label>
          <div className="danger-zone-confirm">
            <input
              id="danger-zone-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={environment.name}
              autoComplete="off"
            />
            <button className="danger-zone-btn" disabled={!armed || busy} onClick={() => void handleDelete()}>
              {isAdmin ? `Delete ${environment.name}` : 'Request deletion'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProjectGeneralForm({
  project,
  isAdmin,
  onChange,
}: {
  project: ProjectSummary;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [busy, setBusy] = useState(false);
  const unchanged = name === project.name && description === (project.description ?? '');

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      await updateProject(project.id, { name, description });
      showToast(`"${name}" updated.`);
      onChange();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update that project.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <dl className="settings-readonly">
        <dt>Project name</dt>
        <dd>{project.name}</dd>
        <dt>Description</dt>
        <dd>{project.description || '—'}</dd>
      </dl>
    );
  }

  return (
    <form className="settings-form" onSubmit={(e) => void handleSubmit(e)}>
      <label>
        Project name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </label>
      <div>
        <button type="submit" className="project-detail-add-btn" disabled={busy || unchanged || !name.trim()}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function ComponentsEditor({
  project,
  isAdmin,
  onChange,
}: {
  project: ProjectSummary;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const { showToast } = useToast();
  const [newComponent, setNewComponent] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = newComponent.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await addComponent(project.id, trimmed);
      setNewComponent('');
      onChange();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not add that component.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(componentId: string): Promise<void> {
    setBusy(true);
    try {
      await removeComponent(project.id, componentId);
      onChange();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not remove that component.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="components-editor">
      {project.components.length === 0 ? (
        <span className="project-detail-empty">No components yet.</span>
      ) : (
        <ul className="project-component-list">
          {project.components.map((component) => (
            <li key={component.id} className="project-component-chip">
              {component.name}
              {isAdmin && (
                <button
                  className="project-component-remove"
                  onClick={() => void handleRemove(component.id)}
                  disabled={busy}
                  aria-label={`Remove ${component.name}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <form className="project-add-component" onSubmit={(e) => void handleAdd(e)}>
          <input
            value={newComponent}
            onChange={(e) => setNewComponent(e.target.value)}
            placeholder="Add a component, e.g. frontend"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !newComponent.trim()}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}

// Admin-only: who holds assignments in this project, and where. Admins aren't
// listed per row — they see every project, so there's no assignment to show.
function ProjectMembers({ projectId }: { projectId: string }) {
  const { showToast } = useToast();
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [managingMember, setManagingMember] = useState<{ id: string; email: string } | null>(null);

  function refreshMembers(): void {
    Promise.all([listProjectAssignments(projectId), listUsers()])
      .then(([assignmentsData, usersData]) => {
        setAssignments(assignmentsData);
        setUsers(usersData);
      })
      .catch(() => showToast('Could not load project members.', 'error'));
  }

  useEffect(refreshMembers, [projectId, showToast]);

  // userId -> { email, "env (All)" / "env (frontend, api)" labels }
  const memberRows = useMemo(() => {
    const byMember = new Map<string, { email: string; scopesByEnvironment: Map<string, string[]> }>();
    for (const assignment of assignments) {
      const memberEntry = byMember.get(assignment.userId) ?? { email: assignment.userEmail, scopesByEnvironment: new Map() };
      const scopes = memberEntry.scopesByEnvironment.get(assignment.environmentName) ?? [];
      memberEntry.scopesByEnvironment.set(assignment.environmentName, [...scopes, assignment.componentName ?? 'All']);
      byMember.set(assignment.userId, memberEntry);
    }
    return [...byMember.entries()].map(([userId, { email, scopesByEnvironment }]) => ({
      userId,
      email,
      accessLabels: [...scopesByEnvironment.entries()].map(
        ([environmentName, scopes]) => `${environmentName} (${scopes.includes('All') ? 'All' : scopes.join(', ')})`,
      ),
    }));
  }, [assignments]);

  const adminCount = users.filter((user) => user.role === 'admin' && user.status === 'active').length;
  const assignableMembers = users.filter(
    (user) =>
      user.role === 'member' &&
      user.status === 'active' &&
      !memberRows.some((memberRow) => memberRow.userId === user.id),
  );

  return (
    <div className="project-members">
      {memberRows.length === 0 ? (
        <p className="project-detail-empty">No members assigned to this project yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="variables-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {memberRows.map((memberRow) => (
                <tr key={memberRow.userId}>
                  <td>{memberRow.email}</td>
                  <td>{memberRow.accessLabels.join(' · ')}</td>
                  <td>
                    <button
                      className="outline-btn"
                      onClick={() => setManagingMember({ id: memberRow.userId, email: memberRow.email })}
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="project-members-footer">
        {assignableMembers.length > 0 && (
          <Select
            value=""
            onChange={(userId) => {
              const picked = assignableMembers.find((user) => user.id === userId);
              if (picked) setManagingMember({ id: picked.id, email: picked.email });
            }}
            options={assignableMembers.map((user) => ({ value: user.id, label: user.email }))}
            placeholder="+ Add member"
            searchable
          />
        )}
        {adminCount > 0 && (
          <span className="project-detail-empty">
            Admins ({adminCount}) have full access to every project.
          </span>
        )}
      </div>

      {managingMember && (
        <AccessDrawer
          member={managingMember}
          lockedProjectId={projectId}
          onClose={() => {
            setManagingMember(null);
            refreshMembers();
          }}
        />
      )}
    </div>
  );
}

function EnvironmentForm({
  projectId,
  onCancel,
  onSaved,
}: {
  projectId: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createEnvironment(projectId, name);
      onSaved(`"${name}" created.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="environments-form" onSubmit={(e) => void handleSubmit(e)}>
      <h3>New environment</h3>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. staging" required />
      </label>
      {error && <p className="project-detail-error">{error}</p>}
      <div className="project-detail-header-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="project-detail-add-btn" disabled={submitting}>
          {submitting ? 'Saving…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function ConnectionsSummary({
  environment,
  project,
  configs,
  credentials,
  isAdmin,
  pendingKeys,
  onChange,
  onCredentialCreated,
}: {
  environment: EnvironmentSummary;
  project: ProjectSummary;
  configs: ComponentConfigSummary[];
  credentials: CredentialSummary[];
  isAdmin: boolean;
  pendingKeys: Set<string>;
  onChange: () => void;
  onCredentialCreated: (credential: CredentialSummary) => void;
}) {
  const { showToast } = useToast();
  const [addingConfig, setAddingConfig] = useState<'single' | 'github-bulk' | null>(null);
  const [preselectedComponentId, setPreselectedComponentId] = useState<string | undefined>(undefined);
  const [pendingDeleteConfig, setPendingDeleteConfig] = useState<ComponentConfigSummary | null>(null);
  const unconfigured = project.components.filter(
    (component) => !configs.some((config) => config.projectComponentId === component.id),
  );

  async function confirmDelete(): Promise<void> {
    if (!pendingDeleteConfig) return;
    const target = pendingDeleteConfig;
    try {
      const result = await removeComponentConfig(environment.id, target.id);
      showToast(
        result.status === 'requested'
          ? `Request to remove "${target.componentName}" submitted for Admin approval.`
          : `"${target.componentName}" connection removed.`,
      );
      onChange();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not remove that connection.', 'error');
    } finally {
      setPendingDeleteConfig(null);
    }
  }

  function closeForm(): void {
    setAddingConfig(null);
    setPreselectedComponentId(undefined);
  }

  // Unconnected rows are Admin-only: a Member's config list is already
  // narrowed to their assignments, so "not connected" would be wrong for them.
  const showMissingRows = isAdmin && !addingConfig;

  return (
    <div className="connections-summary">
      <div className="section-heading">
        <div>
          <h2 className="tab-heading">Connected sources</h2>
          <p className="tab-subheading">
            Where each component reads its {environment.name} variables from.
            {isAdmin && ` ${configs.length} of ${project.components.length} components connected.`}
          </p>
        </div>
        {isAdmin && unconfigured.length > 0 && !addingConfig && (
          <div className="section-heading-actions">
            <button className="outline-btn" onClick={() => setAddingConfig('github-bulk')}>
              Connect all from GitHub
            </button>
            <button className="project-detail-add-btn" onClick={() => setAddingConfig('single')}>
              + Connect source
            </button>
          </div>
        )}
      </div>

      {addingConfig === 'single' && (
        <AddConfigForm
          environmentId={environment.id}
          components={unconfigured}
          initialComponentId={preselectedComponentId}
          credentials={credentials}
          onCancel={closeForm}
          onSaved={() => {
            closeForm();
            onChange();
          }}
          onCredentialCreated={onCredentialCreated}
        />
      )}
      {addingConfig === 'github-bulk' && (
        <GithubBulkConfigForm
          environmentId={environment.id}
          credentials={credentials}
          onCancel={closeForm}
          onSaved={() => {
            closeForm();
            onChange();
          }}
        />
      )}

      {project.components.length === 0 ? (
        <p className="project-detail-empty">
          {isAdmin ? 'This project has no components yet — add one above.' : 'No components connected yet.'}
        </p>
      ) : configs.length === 0 && !showMissingRows ? (
        <p className="project-detail-empty">No components connected yet.</p>
      ) : (
        <ul className="environment-config-list">
          {configs.map((config) => (
            <ConfigRow
              key={config.id}
              environmentId={environment.id}
              config={config}
              credentials={credentials}
              isAdmin={isAdmin}
              removalPending={pendingKeys.has(pendingKey.component(environment.id, config.projectComponentId))}
              onChange={onChange}
              onRequestDelete={() => setPendingDeleteConfig(config)}
              onCredentialCreated={onCredentialCreated}
            />
          ))}
          {showMissingRows &&
            unconfigured.map((component) => (
              <li key={component.id} className="environment-config-row environment-config-row--missing">
                <WarningIcon />
                <span className="config-component-name">{component.name}</span>
                <span className="config-detail">Not connected in {environment.name}</span>
                <button
                  className="config-connect-btn"
                  onClick={() => {
                    setPreselectedComponentId(component.id);
                    setAddingConfig('single');
                  }}
                >
                  Connect
                </button>
              </li>
            ))}
        </ul>
      )}

      {pendingDeleteConfig && (
        <ConfirmDialog
          title="Remove this connection?"
          message={
            isAdmin
              ? `"${pendingDeleteConfig.componentName}" will no longer be connected to a source in "${environment.name}" — its variables stay in S3/GitHub untouched, but Kosha won't show them here anymore. This can't be undone.`
              : `This will send a request to remove the "${pendingDeleteConfig.componentName}" connection to an Admin for approval — nothing changes yet.`
          }
          confirmLabel={isAdmin ? 'Remove' : 'Request removal'}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDeleteConfig(null)}
        />
      )}
    </div>
  );
}

// Where a component's variables live, e.g. "s3://bucket/key (region)" or
// "org/repo@branch · path.yaml" — shown on Sources rows and variable groups.
function configLocation(config: ComponentConfigSummary): string {
  if (config.sourceType === 's3') {
    return `s3://${config.s3Bucket}/${config.s3KeyOverride ?? ''} (${config.s3Region})`;
  }
  return [
    `${config.githubRepo}@${config.githubBranch}`,
    // One path when ConfigMap and Secret share a file; both otherwise.
    ...new Set([config.githubConfigmapPath, config.githubSecretPath].filter(Boolean)),
  ].join(' · ');
}

function ConfigRow({
  environmentId,
  config,
  credentials,
  isAdmin,
  removalPending,
  onChange,
  onRequestDelete,
  onCredentialCreated,
}: {
  environmentId: string;
  config: ComponentConfigSummary;
  credentials: CredentialSummary[];
  isAdmin: boolean;
  removalPending: boolean;
  onChange: () => void;
  onRequestDelete: () => void;
  onCredentialCreated: (credential: CredentialSummary) => void;
}) {
  const [editing, setEditing] = useState(false);
  const detail = configLocation(config);

  if (editing) {
    return (
      <li className="environment-config-row environment-config-row--editing">
        <EditConfigForm
          environmentId={environmentId}
          config={config}
          credentials={credentials}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
          onCredentialCreated={onCredentialCreated}
        />
      </li>
    );
  }

  return (
    <li className="environment-config-row">
      <span className={`config-source-badge config-source-badge--${config.sourceType}`}>{config.sourceType}</span>
      <span className="config-component-name">{config.componentName}</span>
      <span className="config-detail">{detail}</span>
      {isAdmin && (
        <button className="icon-btn" aria-label="Edit connection" title="Edit connection" onClick={() => setEditing(true)}>
          <PencilIcon />
        </button>
      )}
      {removalPending ? (
        <span className="pending-badge">Removal requested</span>
      ) : (
        <button
          className="icon-btn danger"
          aria-label={isAdmin ? 'Remove connection' : 'Request removal'}
          title={isAdmin ? 'Remove connection' : 'Request removal'}
          onClick={onRequestDelete}
        >
          <TrashIcon />
        </button>
      )}
    </li>
  );
}

function EditConfigForm({
  environmentId,
  config,
  credentials,
  onCancel,
  onSaved,
  onCredentialCreated,
}: {
  environmentId: string;
  config: ComponentConfigSummary;
  credentials: CredentialSummary[];
  onCancel: () => void;
  onSaved: () => void;
  onCredentialCreated: (credential: CredentialSummary) => void;
}) {
  const [s3Uri, setS3Uri] = useState('');
  const [s3Bucket, setS3Bucket] = useState(config.s3Bucket ?? '');
  const [s3Region, setS3Region] = useState(config.s3Region ?? '');
  const [s3CredentialId, setS3CredentialId] = useState(config.s3CredentialId ?? '');
  const [s3KeyOverride, setS3KeyOverride] = useState(config.s3KeyOverride ?? '');
  const [githubUrlInput, setGithubUrlInput] = useState('');
  const [githubRepo, setGithubRepo] = useState(config.githubRepo ?? '');
  const [githubBranch, setGithubBranch] = useState(config.githubBranch ?? '');
  const [githubConfigmapPath, setGithubConfigmapPath] = useState(config.githubConfigmapPath ?? '');
  const [githubSecretPath, setGithubSecretPath] = useState(config.githubSecretPath ?? '');
  const [githubCredentialId, setGithubCredentialId] = useState(config.githubCredentialId ?? '');
  const [addingCredential, setAddingCredential] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionTest = useConnectionTest();

  const awsCredentials = credentials.filter((c) => c.type === 'aws');
  const githubCredentials = credentials.filter((c) => c.type === 'github');
  const canTest =
    config.sourceType === 's3'
      ? !!(s3Bucket && s3Region && s3CredentialId)
      : !!(githubRepo && githubBranch && githubCredentialId);

  function handleS3UriChange(value: string): void {
    setS3Uri(value);
    connectionTest.reset();
    const match = /^s3:\/\/([^/]+)\/?(.*)$/.exec(value.trim());
    if (!match) return;
    setS3Bucket(match[1]);
    setS3KeyOverride(match[2]);
  }

  // Same idea as the S3 URI box above — paste the repo URL instead of typing
  // "org/repo" yourself. Branch is always its own manual field below, same
  // as Region is for S3; ConfigMap/Secret are plain manual paths too.
  function handleGithubUrlChange(value: string): void {
    setGithubUrlInput(value);
    connectionTest.reset();
    const parsed = parseGithubRepoUrl(value);
    if (!parsed) return;
    setGithubRepo(parsed.repo);
  }

  function handleTest(): void {
    void connectionTest.run(
      config.sourceType === 's3'
        ? { sourceType: 's3', s3Bucket, s3Region, s3CredentialId, s3KeyOverride: s3KeyOverride || undefined }
        : {
            sourceType: 'github',
            githubRepo,
            githubBranch,
            githubCredentialId,
            githubConfigmapPath: githubConfigmapPath || undefined,
            githubSecretPath: githubSecretPath || undefined,
          },
    );
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (config.sourceType === 's3') {
        await updateComponentConfig(environmentId, config.id, {
          s3Bucket,
          s3Region,
          s3CredentialId,
          s3KeyOverride: s3KeyOverride || undefined,
        });
      } else {
        await updateComponentConfig(environmentId, config.id, {
          githubRepo,
          githubBranch,
          githubCredentialId,
          githubConfigmapPath: githubConfigmapPath || undefined,
          githubSecretPath: githubSecretPath || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="add-config-form edit-config-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="edit-config-form-header">
        <span className={`config-source-badge config-source-badge--${config.sourceType}`}>{config.sourceType}</span>
        <span className="config-component-name">{config.componentName}</span>
      </div>

      {config.sourceType === 's3' ? (
        <>
          <label>
            S3 URI (paste to update bucket + key together)
            <input
              value={s3Uri}
              onChange={(e) => handleS3UriChange(e.target.value)}
              placeholder="s3://allenvvariables/ai-enterprise-brain-v1/frontend-v1.env"
            />
          </label>
          <label>
            Bucket name
            <input value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} required />
          </label>
          <label>
            Key override
            <input value={s3KeyOverride} onChange={(e) => setS3KeyOverride(e.target.value)} />
          </label>
          <label>
            Region
            <input value={s3Region} onChange={(e) => setS3Region(e.target.value)} required />
          </label>
          <label>
            Credential
            {addingCredential ? (
              <InlineCredentialForm
                type="aws"
                onCancel={() => setAddingCredential(false)}
                onCreated={(credential) => {
                  onCredentialCreated(credential);
                  setS3CredentialId(credential.id);
                  setAddingCredential(false);
                }}
              />
            ) : (
              <>
                {awsCredentials.length > 0 && (
                  <Select
                    value={s3CredentialId}
                    onChange={setS3CredentialId}
                    options={awsCredentials.map((c) => ({ value: c.id, label: c.label }))}
                    placeholder="Select credential"
                  />
                )}
                <button type="button" className="add-config-toggle" onClick={() => setAddingCredential(true)}>
                  + Add new credential
                </button>
              </>
            )}
          </label>
        </>
      ) : (
        <>
          <label>
            GitHub URL (paste to update repo)
            <input
              value={githubUrlInput}
              onChange={(e) => handleGithubUrlChange(e.target.value)}
              placeholder="e.g. https://github.com/org/repo"
            />
          </label>
          <label>
            Repo
            <input value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="e.g. org/repo" required />
          </label>
          <label>
            Branch
            <input value={githubBranch} onChange={(e) => setGithubBranch(e.target.value)} placeholder="e.g. main" required />
          </label>
          <label>
            ConfigMap file (path)
            <input
              value={githubConfigmapPath}
              onChange={(e) => setGithubConfigmapPath(e.target.value)}
              placeholder="templates/configmap.yaml"
            />
          </label>
          <label>
            Secret file (path)
            <input
              value={githubSecretPath}
              onChange={(e) => setGithubSecretPath(e.target.value)}
              placeholder="templates/secret.yaml"
            />
          </label>
          <label>
            Credential
            {addingCredential ? (
              <InlineCredentialForm
                type="github"
                onCancel={() => setAddingCredential(false)}
                onCreated={(credential) => {
                  onCredentialCreated(credential);
                  setGithubCredentialId(credential.id);
                  setAddingCredential(false);
                }}
              />
            ) : (
              <>
                {githubCredentials.length > 0 && (
                  <Select
                    value={githubCredentialId}
                    onChange={setGithubCredentialId}
                    options={githubCredentials.map((c) => ({ value: c.id, label: c.label }))}
                    placeholder="Select credential"
                  />
                )}
                <button type="button" className="add-config-toggle" onClick={() => setAddingCredential(true)}>
                  + Add new credential
                </button>
              </>
            )}
          </label>
        </>
      )}

      <TestConnectionButton state={connectionTest.state} onTest={handleTest} disabled={!canTest} />

      {error && <p className="project-detail-error">{error}</p>}
      <div className="project-detail-header-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="project-detail-add-btn" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function AddConfigForm({
  environmentId,
  components,
  initialComponentId,
  credentials,
  onCancel,
  onSaved,
  onCredentialCreated,
}: {
  environmentId: string;
  components: { id: string; name: string }[];
  initialComponentId?: string;
  credentials: CredentialSummary[];
  onCancel: () => void;
  onSaved: () => void;
  onCredentialCreated: (credential: CredentialSummary) => void;
}) {
  const [projectComponentId, setProjectComponentId] = useState(initialComponentId ?? '');
  const [sourceType, setSourceType] = useState<ComponentConfigSourceType>('s3');
  const [s3Uri, setS3Uri] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3CredentialId, setS3CredentialId] = useState('');
  const [s3KeyOverride, setS3KeyOverride] = useState('');
  const [manualEntry, setManualEntry] = useState(false);
  const [githubManualEntry, setGithubManualEntry] = useState(false);
  const [githubUrlInput, setGithubUrlInput] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubBranch, setGithubBranch] = useState('');
  const [githubConfigmapPath, setGithubConfigmapPath] = useState('');
  const [githubSecretPath, setGithubSecretPath] = useState('');
  const [githubCredentialId, setGithubCredentialId] = useState('');
  const [addingCredential, setAddingCredential] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionTest = useConnectionTest();

  const awsCredentials = credentials.filter((c) => c.type === 'aws');
  const githubCredentials = credentials.filter((c) => c.type === 'github');
  const canTest =
    sourceType === 's3' ? !!(s3Bucket && s3Region && s3CredentialId) : !!(githubRepo && githubBranch && githubCredentialId);

  function handleS3UriChange(value: string): void {
    setS3Uri(value);
    connectionTest.reset();
    const match = /^s3:\/\/([^/]+)\/?(.*)$/.exec(value.trim());
    if (!match) return;
    setS3Bucket(match[1]);
    setS3KeyOverride(match[2]);
  }

  // Same idea as the S3 URI box — paste the repo URL instead of typing
  // "org/repo" yourself. Branch is always its own manual field below, same
  // as Region is for S3; ConfigMap/Secret are plain manual paths too.
  function handleGithubUrlChange(value: string): void {
    setGithubUrlInput(value);
    connectionTest.reset();
    const parsed = parseGithubRepoUrl(value);
    if (!parsed) return;
    setGithubRepo(parsed.repo);
  }

  function handleTest(): void {
    void connectionTest.run(
      sourceType === 's3'
        ? { sourceType, s3Bucket, s3Region, s3CredentialId, s3KeyOverride: s3KeyOverride || undefined }
        : {
            sourceType,
            githubRepo,
            githubBranch,
            githubCredentialId,
            githubConfigmapPath: githubConfigmapPath || undefined,
            githubSecretPath: githubSecretPath || undefined,
          },
    );
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (sourceType === 's3' && !s3Bucket.trim()) {
      setError('Paste an S3 URI above, or click "Enter manually" to type the bucket name.');
      return;
    }
    if (sourceType === 'github' && !githubManualEntry && !githubRepo.trim()) {
      setError('Paste a GitHub repo URL above, or click "Manual" to type the repo directly.');
      return;
    }
    setSubmitting(true);
    try {
      if (sourceType === 's3') {
        await addComponentConfig(environmentId, {
          projectComponentId,
          sourceType: 's3',
          s3Bucket,
          s3Region,
          s3CredentialId,
          s3KeyOverride: s3KeyOverride || undefined,
        });
      } else {
        await addComponentConfig(environmentId, {
          projectComponentId,
          sourceType: 'github',
          githubRepo,
          githubBranch,
          githubCredentialId,
          githubConfigmapPath: githubConfigmapPath || undefined,
          githubSecretPath: githubSecretPath || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="add-config-form" onSubmit={(e) => void handleSubmit(e)}>
      <label>
        Component *
        <Select
          value={projectComponentId}
          onChange={setProjectComponentId}
          options={components.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Select component"
        />
      </label>
      <label>
        Source *
        <Select
          value={sourceType}
          onChange={(v) => setSourceType(v as ComponentConfigSourceType)}
          options={[
            { value: 's3', label: 'S3' },
            { value: 'github', label: 'GitHub (read-only)' },
          ]}
        />
      </label>

      {sourceType === 's3' ? (
        <>
          <div className="entry-mode-switch" role="tablist" aria-label="How to specify the S3 location">
            <button
              type="button"
              role="tab"
              aria-selected={!manualEntry}
              className={!manualEntry ? 'entry-mode-tab entry-mode-tab--active' : 'entry-mode-tab'}
              onClick={() => setManualEntry(false)}
            >
              URI
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={manualEntry}
              className={manualEntry ? 'entry-mode-tab entry-mode-tab--active' : 'entry-mode-tab'}
              onClick={() => setManualEntry(true)}
            >
              Manual
            </button>
          </div>
          {!manualEntry ? (
            <label>
              S3 URI *
              <input
                value={s3Uri}
                onChange={(e) => handleS3UriChange(e.target.value)}
                placeholder="e.g. s3://allenvvariables/ai-enterprise-brain-v1/frontend-v1.env"
                required
              />
            </label>
          ) : (
            <>
              <label>
                Bucket name *
                <input
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                  placeholder="e.g. allenvvariables"
                  required
                />
              </label>
              <label>
                Key override (optional)
                <input
                  value={s3KeyOverride}
                  onChange={(e) => setS3KeyOverride(e.target.value)}
                  placeholder="e.g. ai-enterprise-brain-v1/frontend-v1.env"
                />
              </label>
            </>
          )}
          <label>
            Region *
            <input value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="e.g. ap-south-1" required />
          </label>
          <label>
            Credential *
            {addingCredential ? (
              <InlineCredentialForm
                type="aws"
                onCancel={() => setAddingCredential(false)}
                onCreated={(credential) => {
                  onCredentialCreated(credential);
                  setS3CredentialId(credential.id);
                  setAddingCredential(false);
                }}
              />
            ) : (
              <>
                {awsCredentials.length > 0 && (
                  <Select
                    value={s3CredentialId}
                    onChange={setS3CredentialId}
                    options={awsCredentials.map((c) => ({ value: c.id, label: c.label }))}
                    placeholder="Select credential"
                  />
                )}
                <button type="button" className="add-config-toggle" onClick={() => setAddingCredential(true)}>
                  + Add new credential
                </button>
              </>
            )}
          </label>
        </>
      ) : (
        <>
          <div className="entry-mode-switch" role="tablist" aria-label="How to specify the GitHub repo">
            <button
              type="button"
              role="tab"
              aria-selected={!githubManualEntry}
              className={!githubManualEntry ? 'entry-mode-tab entry-mode-tab--active' : 'entry-mode-tab'}
              onClick={() => setGithubManualEntry(false)}
            >
              URI
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={githubManualEntry}
              className={githubManualEntry ? 'entry-mode-tab entry-mode-tab--active' : 'entry-mode-tab'}
              onClick={() => setGithubManualEntry(true)}
            >
              Manual
            </button>
          </div>
          {!githubManualEntry ? (
            <label>
              GitHub URL *
              <input
                value={githubUrlInput}
                onChange={(e) => handleGithubUrlChange(e.target.value)}
                placeholder="e.g. https://github.com/org/repo"
                required
              />
            </label>
          ) : (
            <label>
              Repo *
              <input value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="e.g. org/repo" required />
            </label>
          )}
          <label>
            Branch *
            <input value={githubBranch} onChange={(e) => setGithubBranch(e.target.value)} placeholder="e.g. main" required />
          </label>
          <label>
            ConfigMap file (path)
            <input
              value={githubConfigmapPath}
              onChange={(e) => setGithubConfigmapPath(e.target.value)}
              placeholder="templates/configmap.yaml"
            />
          </label>
          <label>
            Secret file (path)
            <input
              value={githubSecretPath}
              onChange={(e) => setGithubSecretPath(e.target.value)}
              placeholder="templates/secret.yaml"
            />
          </label>
          <label>
            Credential *
            {addingCredential ? (
              <InlineCredentialForm
                type="github"
                onCancel={() => setAddingCredential(false)}
                onCreated={(credential) => {
                  onCredentialCreated(credential);
                  setGithubCredentialId(credential.id);
                  setAddingCredential(false);
                }}
              />
            ) : (
              <>
                {githubCredentials.length > 0 && (
                  <Select
                    value={githubCredentialId}
                    onChange={setGithubCredentialId}
                    options={githubCredentials.map((c) => ({ value: c.id, label: c.label }))}
                    placeholder="Select credential"
                  />
                )}
                <button type="button" className="add-config-toggle" onClick={() => setAddingCredential(true)}>
                  + Add new credential
                </button>
              </>
            )}
          </label>
        </>
      )}

      <TestConnectionButton state={connectionTest.state} onTest={handleTest} disabled={!canTest} />

      {error && <p className="project-detail-error">{error}</p>}
      <div className="project-detail-header-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          type="submit"
          className="project-detail-add-btn"
          disabled={
            submitting ||
            !projectComponentId ||
            (sourceType === 's3' ? !s3CredentialId : !githubCredentialId)
          }
        >
          {submitting ? 'Saving…' : 'Connect'}
        </button>
      </div>
    </form>
  );
}

// One repo/branch/credential + a "{component}" path template for every
// component at once — Helm repos keep one <component>.yaml per service with
// ConfigMap and Secret in the same file, and only the branch changes between
// environments. Preview checks each file; Connect then calls the ordinary
// per-component endpoint for each ticked row, so nothing new on the write path.
function GithubBulkConfigForm({
  environmentId,
  credentials,
  onCancel,
  onSaved,
}: {
  environmentId: string;
  credentials: CredentialSummary[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [githubUrlInput, setGithubUrlInput] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubBranch, setGithubBranch] = useState('');
  const [githubCredentialId, setGithubCredentialId] = useState('');
  const [pathTemplate, setPathTemplate] = useState('{component}.yaml');
  const [previewRows, setPreviewRows] = useState<GithubBulkPreviewRow[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const githubCredentials = credentials.filter((c) => c.type === 'github');

  // Any input change invalidates the preview — it's only trustworthy for the exact values it checked.
  function edit(setter: (value: string) => void, value: string): void {
    setter(value);
    setPreviewRows(null);
  }

  async function handlePreview(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const rows = await previewGithubBulk(environmentId, { githubRepo, githubBranch, githubCredentialId, pathTemplate });
      setPreviewRows(rows);
      setSelectedIds(new Set(rows.filter((r) => r.status === 'found').map((r) => r.projectComponentId)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect(): Promise<void> {
    const rowsToConnect = (previewRows ?? []).filter((r) => selectedIds.has(r.projectComponentId));
    setBusy(true);
    const failedNames: string[] = [];
    // ponytail: sequential, one request per component — fine for tens of components.
    for (const row of rowsToConnect) {
      try {
        await addComponentConfig(environmentId, {
          projectComponentId: row.projectComponentId,
          sourceType: 'github',
          githubRepo,
          githubBranch,
          githubCredentialId,
          githubConfigmapPath: row.path,
          githubSecretPath: row.path,
        });
      } catch {
        failedNames.push(row.componentName);
      }
    }
    setBusy(false);
    const connectedCount = rowsToConnect.length - failedNames.length;
    showToast(
      failedNames.length
        ? `Connected ${connectedCount}; failed: ${failedNames.join(', ')}.`
        : `Connected ${connectedCount} component${connectedCount === 1 ? '' : 's'}.`,
      failedNames.length ? 'error' : undefined,
    );
    onSaved();
  }

  function toggle(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const statusLabel: Record<GithubBulkPreviewRow['status'], string> = {
    found: '✓ Found',
    'not-found': 'File not found',
    'already-connected': 'Already connected',
  };

  return (
    <div className="add-config-form">
      <label>
        GitHub URL *
        <input
          value={githubUrlInput}
          onChange={(e) => {
            edit(setGithubUrlInput, e.target.value);
            setGithubRepo(parseGithubRepoUrl(e.target.value)?.repo ?? '');
          }}
          placeholder="e.g. https://github.com/org/helm-charts"
        />
      </label>
      <label>
        Branch *
        <input value={githubBranch} onChange={(e) => edit(setGithubBranch, e.target.value)} placeholder="e.g. dev" />
      </label>
      <label>
        File path (ConfigMap + Secret) *
        <input value={pathTemplate} onChange={(e) => edit(setPathTemplate, e.target.value)} placeholder="{component}.yaml" />
      </label>
      <label>
        Credential *
        {githubCredentials.length > 0 ? (
          <Select
            value={githubCredentialId}
            onChange={(v) => edit(setGithubCredentialId, v)}
            options={githubCredentials.map((c) => ({ value: c.id, label: c.label }))}
            placeholder="Select credential"
          />
        ) : (
          <span className="project-detail-empty">No GitHub credential yet — add one via "Connect a component" or Credentials.</span>
        )}
      </label>

      {previewRows && (
        <div className="table-scroll">
          <table className="variables-table">
            <thead>
              <tr>
                <th />
                <th>Component</th>
                <th>Path</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.projectComponentId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.projectComponentId)}
                      disabled={row.status === 'already-connected'}
                      onChange={() => toggle(row.projectComponentId)}
                      aria-label={`Connect ${row.componentName}`}
                    />
                  </td>
                  <td>{row.componentName}</td>
                  <td>{row.path}</td>
                  <td>{statusLabel[row.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="project-detail-error">{error}</p>}
      <div className="project-detail-header-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {!previewRows ? (
          <button
            type="button"
            className="project-detail-add-btn"
            onClick={() => void handlePreview()}
            disabled={busy || !githubRepo || !githubBranch || !githubCredentialId || !pathTemplate.includes('{component}')}
          >
            {busy ? 'Checking…' : 'Preview'}
          </button>
        ) : (
          <button
            type="button"
            className="project-detail-add-btn"
            onClick={() => void handleConnect()}
            disabled={busy || selectedIds.size === 0}
          >
            {busy ? 'Connecting…' : `Connect ${selectedIds.size}`}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Merged variables table (all wired components of the active environment) ----

function VariablesSection({
  environment,
  configs,
  variables,
  isAdmin,
  pendingKeys,
  onChange,
}: {
  environment: EnvironmentSummary;
  configs: ComponentConfigSummary[];
  variables: MergedVariableRow[];
  isAdmin: boolean;
  pendingKeys: Set<string>;
  onChange: () => void;
}) {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [componentFilter, setComponentFilter] = useState<string | null>(null);
  const [collapsedConfigIds, setCollapsedConfigIds] = useState<Set<string>>(new Set());
  // Groups showing every row instead of the first VARIABLES_PAGE_SIZE.
  const [expandedConfigIds, setExpandedConfigIds] = useState<Set<string>>(new Set());
  const [addingVariable, setAddingVariable] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ configId: string; key: string } | null>(null);

  const writableConfigs = configs.filter((config) => config.sourceType === 's3');

  const visibleVariables = useMemo(() => {
    const query = search.trim().toLowerCase();
    return variables
      .filter((variable) => componentFilter === null || variable.configId === componentFilter)
      .filter((variable) => {
        if (!query) return true;
        if (variable.key.toLowerCase().includes(query)) return true;
        return !variable.isSecret && (variable.value ?? '').toLowerCase().includes(query);
      });
  }, [variables, search, componentFilter]);

  // One group per component that has matching rows. Each group is capped
  // separately — a single cross-component page would fill up with the first
  // component's rows and push every other component off to page 2+.
  const variableGroups = useMemo(
    () =>
      configs
        .map((config) => ({
          config,
          rows: visibleVariables.filter((variable) => variable.configId === config.id),
        }))
        .filter((group) => group.rows.length > 0),
    [configs, visibleVariables],
  );

  function showAllRows(configId: string): void {
    setExpandedConfigIds((current) => new Set(current).add(configId));
  }

  function toggleGroup(configId: string): void {
    setCollapsedConfigIds((current) => {
      const next = new Set(current);
      if (next.has(configId)) next.delete(configId);
      else next.add(configId);
      return next;
    });
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    const { configId, key } = pendingDelete;
    try {
      const result = await deleteVariable(environment.id, configId, key);
      showToast(
        result.status === 'requested'
          ? `Delete request for "${key}" submitted for Admin approval.`
          : `"${key}" deleted.`,
      );
      onChange();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not delete that variable.', 'error');
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className="variables-section">
      {addingVariable && writableConfigs.length > 0 && (
        <AddVariableForm
          environmentId={environment.id}
          configs={writableConfigs}
          defaultConfigId={componentFilter ?? undefined}
          isAdmin={isAdmin}
          onCancel={() => setAddingVariable(false)}
          onSaved={(message) => {
            showToast(message);
            setAddingVariable(false);
            onChange();
          }}
        />
      )}

      {importing && writableConfigs.length > 0 && (
        <ImportSection
          environmentId={environment.id}
          configs={writableConfigs}
          defaultConfigId={componentFilter ?? undefined}
          onCancel={() => setImporting(false)}
          onCommitted={(message) => {
            showToast(message);
            setImporting(false);
            onChange();
          }}
        />
      )}

      {configs.length > 0 && (
        <div className="variables-toolbar">
          <div className="variables-toolbar-row">
            <label className="variables-search">
              <SearchIcon />
              <input
                aria-label="Search keys or values"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                placeholder="Search keys or values…"
              />
            </label>
            <div className="variables-toolbar-actions">
              <button className="outline-btn outline-btn--icon" aria-label="Refresh from sources" title="Refresh" onClick={onChange}>
                <RefreshIcon />
              </button>
              {writableConfigs.length > 0 && (
                <>
                  <button className="outline-btn" onClick={() => setImporting((open) => !open)}>
                    {importing ? 'Close import' : 'Import .env'}
                  </button>
                  <button className="project-detail-add-btn" onClick={() => setAddingVariable((open) => !open)}>
                    {addingVariable ? 'Close' : '+ Add variable'}
                  </button>
                </>
              )}
            </div>
          </div>
          {configs.length > 1 && (
            <div className="component-filter-chips" role="group" aria-label="Filter by component">
              <span className="component-filter-label">Component</span>
              <button
                type="button"
                className={`chip-filter${componentFilter === null ? ' chip-filter--active' : ''}`}
                onClick={() => setComponentFilter(null)}
              >
                All
              </button>
              {configs.map((config) => (
                <button
                  key={config.id}
                  type="button"
                  className={`chip-filter${componentFilter === config.id ? ' chip-filter--active' : ''}`}
                  onClick={() => setComponentFilter(config.id)}
                >
                  {config.componentName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {visibleVariables.length === 0 ? (
        <p className="variables-empty">
          {variables.length > 0 ? 'No matching variables.' : 'No variables yet. Connect a component and add one.'}
        </p>
      ) : (
        <>
          {/* On a narrow viewport the table scrolls sideways to reach Value
              and the action icons (CLAUDE.md — every screen must work down
              to phone width) — without this, that just looks like the
              columns are missing rather than one swipe away. */}
          <p className="variables-scroll-hint">Swipe to see values →</p>
          <div className="table-scroll">
            <table className="variables-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              {variableGroups.map(({ config, rows }) => {
                const groupOpen = !collapsedConfigIds.has(config.id);
                const shownRows = expandedConfigIds.has(config.id) ? rows : rows.slice(0, VARIABLES_PAGE_SIZE);
                return (
                  <tbody key={config.id}>
                    <tr className="variable-group-row">
                      <td colSpan={3}>
                        <button
                          className="variable-group-toggle"
                          aria-expanded={groupOpen}
                          onClick={() => toggleGroup(config.id)}
                        >
                          <ChevronIcon open={groupOpen} />
                          <span className="variable-group-name">{config.componentName}</span>
                          <span className={`config-source-badge config-source-badge--${config.sourceType}`}>
                            {config.sourceType}
                          </span>
                          <span className="variable-group-location" title={configLocation(config)}>
                            {configLocation(config)}
                          </span>
                          <span className="variable-group-count">{rows.length}</span>
                        </button>
                      </td>
                    </tr>
                    {groupOpen &&
                      shownRows.map((variable) =>
                        variable.sourceType === 'github' ? (
                          <GithubVariableRow key={`${variable.configId}:${variable.key}`} variable={variable} />
                        ) : (
                          <VariableRow
                            key={`${variable.configId}:${variable.key}`}
                            environmentId={environment.id}
                            variable={variable}
                            isAdmin={isAdmin}
                            deletePending={pendingKeys.has(
                              pendingKey.variable(environment.id, variable.projectComponentId, variable.key),
                            )}
                            rollbackPending={pendingKeys.has(
                              pendingKey.rollback(environment.id, variable.projectComponentId, variable.key),
                            )}
                            onChange={onChange}
                            onRequestDelete={() => setPendingDelete({ configId: variable.configId, key: variable.key })}
                          />
                        ),
                      )}
                    {groupOpen && shownRows.length < rows.length && (
                      <tr className="variable-show-all-row">
                        <td colSpan={3}>
                          <button className="outline-btn" onClick={() => showAllRows(config.id)}>
                            Show all {rows.length} {config.componentName} variables
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        </>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete variable?"
          message={
            isAdmin
              ? `"${pendingDelete.key}" will be permanently removed from this environment. This can't be undone.`
              : `This will send a delete request for "${pendingDelete.key}" to an Admin for approval — nothing is deleted yet.`
          }
          confirmLabel={isAdmin ? 'Delete' : 'Request delete'}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function AddVariableForm({
  environmentId,
  configs,
  defaultConfigId,
  isAdmin,
  onCancel,
  onSaved,
}: {
  environmentId: string;
  configs: ComponentConfigSummary[];
  defaultConfigId?: string;
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  // Only pre-select when there's exactly one choice, or the component filter
  // chip already narrowed it explicitly — with more than one option and no
  // prior selection, defaulting silently risks adding to the wrong component.
  const [configId, setConfigId] = useState(() => {
    if (defaultConfigId && configs.some((c) => c.id === defaultConfigId)) return defaultConfigId;
    return configs.length === 1 ? configs[0].id : '';
  });
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [isSecret, setIsSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createVariable(environmentId, configId, key, value, isSecret);
      onSaved(`"${key}" added.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="variables-form" onSubmit={(e) => void handleSubmit(e)}>
      {configs.length > 1 && (
        <label>
          Component *
          <Select
            value={configId}
            onChange={setConfigId}
            options={configs.map((c) => ({ value: c.id, label: c.componentName }))}
            placeholder="Select component"
          />
        </label>
      )}
      <label>
        Key *
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. API_KEY" required />
      </label>
      <label>
        Value
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {isAdmin && (
        <label className="variables-checkbox">
          <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
          Secret
        </label>
      )}
      {error && <p className="variables-error">{error}</p>}
      <div className="variables-form-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="variables-add-btn" disabled={submitting || !configId}>
          {submitting ? 'Saving…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

function ImportSection({
  environmentId,
  configs,
  defaultConfigId,
  onCancel,
  onCommitted,
}: {
  environmentId: string;
  configs: ComponentConfigSummary[];
  defaultConfigId?: string;
  onCancel: () => void;
  onCommitted: (message: string) => void;
}) {
  const [configId, setConfigId] = useState(() => {
    if (defaultConfigId && configs.some((c) => c.id === defaultConfigId)) return defaultConfigId;
    return configs.length === 1 ? configs[0].id : '';
  });
  const [envText, setEnvText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setPlan(await previewImport(environmentId, configId, envText));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await commitImport(environmentId, configId, envText);
      onCommitted(
        `Imported: ${result.creates.length} created, ${result.updates.length} updated, ${result.skipped.length} skipped.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="variables-form import-form">
      {configs.length > 1 && (
        <label>
          Component *
          <Select
            value={configId}
            onChange={(v) => {
              setConfigId(v);
              setPlan(null);
            }}
            options={configs.map((c) => ({ value: c.id, label: c.componentName }))}
            placeholder="Select component"
          />
        </label>
      )}
      <label>
        Paste .env content
        <textarea
          value={envText}
          onChange={(e) => {
            setEnvText(e.target.value);
            setPlan(null);
          }}
          rows={6}
          placeholder={'API_KEY=value\nDB_URL=value'}
        />
      </label>
      {error && <p className="variables-error">{error}</p>}
      {plan && (
        <div className="import-plan">
          <p>
            <strong>{plan.creates.length}</strong> new, <strong>{plan.updates.length}</strong> updated,{' '}
            <strong>{plan.skipped.length}</strong> skipped
          </p>
          {plan.creates.length > 0 && <p className="import-plan-list">+ {plan.creates.map((c) => c.key).join(', ')}</p>}
          {plan.updates.length > 0 && <p className="import-plan-list">~ {plan.updates.map((u) => u.key).join(', ')}</p>}
          {plan.skipped.length > 0 && (
            <p className="import-plan-list import-plan-list--skipped">
              skipped: {plan.skipped.map((s) => `${s.key} (${s.reason})`).join(', ')}
            </p>
          )}
        </div>
      )}
      <div className="variables-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {!plan ? (
          <button type="button" className="variables-add-btn" onClick={() => void handlePreview()} disabled={busy || !envText.trim() || !configId}>
            {busy ? 'Checking…' : 'Preview'}
          </button>
        ) : (
          <button
            type="button"
            className="variables-add-btn"
            onClick={() => void handleCommit()}
            disabled={busy || (plan.creates.length === 0 && plan.updates.length === 0)}
          >
            {busy ? 'Importing…' : 'Commit'}
          </button>
        )}
      </div>
    </div>
  );
}

function useCopyFeedback() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { showToast } = useToast();

  async function copy(text: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      showToast('Could not copy to clipboard.', 'error');
    }
  }

  return { copiedId, copy };
}

// GitHub sources are read-only — no edit/delete/history, just copy. A GitHub
// Secret's value is never fetched (CLAUDE.md #1), so only its key is copyable.
function GithubVariableRow({ variable }: { variable: MergedVariableRow }) {
  const { copiedId, copy } = useCopyFeedback();
  const keyCopyId = `${variable.configId}:${variable.key}:key`;
  const valueCopyId = `${variable.configId}:${variable.key}:value`;

  return (
    <tr>
      <td className="variable-key">
        <span className="variable-cell">
          <span className="variable-cell-text">{variable.key}</span>
          <button
            className={`icon-btn copy-btn${copiedId === keyCopyId ? ' copied' : ''}`}
            aria-label="Copy key"
            title="Copy key"
            onClick={() => void copy(variable.key, keyCopyId)}
          >
            {copiedId === keyCopyId ? <CheckIcon /> : <CopyIcon />}
          </button>
        </span>
      </td>
      <td className="variable-value">
        {variable.isSecret ? (
          <em className="variable-secret-note">key only — GitHub Secret</em>
        ) : (
          <span className="variable-cell">
            <span className="variable-cell-text">{variable.value}</span>
            {variable.value !== null && (
              <button
                className={`icon-btn copy-btn${copiedId === valueCopyId ? ' copied' : ''}`}
                aria-label="Copy value"
                title="Copy value"
                onClick={() => void copy(variable.value ?? '', valueCopyId)}
              >
                {copiedId === valueCopyId ? <CheckIcon /> : <CopyIcon />}
              </button>
            )}
          </span>
        )}
      </td>
      <td />
    </tr>
  );
}

function VariableRow({
  environmentId,
  variable,
  isAdmin,
  deletePending,
  rollbackPending,
  onChange,
  onRequestDelete,
}: {
  environmentId: string;
  variable: MergedVariableRow;
  isAdmin: boolean;
  deletePending: boolean;
  rollbackPending: boolean;
  onChange: () => void;
  onRequestDelete: () => void;
}) {
  const { showToast } = useToast();
  const { copiedId, copy } = useCopyFeedback();
  const { configId } = variable;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(variable.isSecret ? '' : (variable.value ?? ''));
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<VariableHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(revealTimer.current), []);

  async function handleReveal(): Promise<void> {
    if (revealedValue) {
      setRevealedValue(null);
      clearTimeout(revealTimer.current);
      return;
    }
    setBusy(true);
    try {
      const { value } = await revealVariable(environmentId, configId, variable.key);
      setRevealedValue(value);
      clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setRevealedValue(null), SECRET_REVEAL_DURATION_MS);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not reveal that value.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(): Promise<void> {
    setBusy(true);
    try {
      await updateVariable(environmentId, configId, variable.key, editValue);
      showToast(`"${variable.key}" updated.`);
      setEditing(false);
      onChange();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update that variable.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleSecret(): Promise<void> {
    setBusy(true);
    try {
      await updateSecretFlag(environmentId, configId, variable.key, !variable.isSecret);
      onChange();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change that flag.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleHistory(): Promise<void> {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setBusy(true);
    try {
      setHistory(await getVariableHistory(environmentId, configId, variable.key));
      setShowHistory(true);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load history.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRollback(versionId: string): Promise<void> {
    setBusy(true);
    try {
      const result = await rollbackVariable(environmentId, configId, variable.key, versionId);
      showToast(
        result.status === 'requested'
          ? `Rollback request for "${variable.key}" submitted for Admin approval.`
          : `"${variable.key}" rolled back.`,
      );
      setShowHistory(false);
      onChange();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not roll back that variable.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // The initial list fetch already carries the real value even for a
  // Secret key (Admins always get the real value per LLD) — but the UI
  // still masks by default and only shows it via the audited /reveal call,
  // which is the point of CLAUDE.md #13/#14, not a server-side guarantee.
  const displayValue = variable.isSecret ? (revealedValue ?? '••••••••') : variable.value;
  const rowId = `${configId}:${variable.key}`;
  const keyCopyId = `${rowId}:key`;
  const valueCopyId = `${rowId}:value`;

  return (
    <>
      <tr>
        <td className="variable-key">
          <span className="variable-cell">
            <span className="variable-cell-text">{variable.key}</span>
            <button
              className={`icon-btn copy-btn${copiedId === keyCopyId ? ' copied' : ''}`}
              aria-label="Copy key"
              title="Copy key"
              onClick={() => void copy(variable.key, keyCopyId)}
            >
              {copiedId === keyCopyId ? <CheckIcon /> : <CopyIcon />}
            </button>
          </span>
        </td>
        <td className="variable-value">
          {editing ? (
            <input value={editValue} onChange={(e) => setEditValue(e.target.value)} disabled={busy} />
          ) : variable.isSecret && !revealedValue ? (
            <span className="variable-cell">
              <span className="variable-cell-text">••••••••</span>
              {isAdmin && (
                <button className="icon-btn" aria-label="Reveal" title="Reveal" onClick={() => void handleReveal()} disabled={busy}>
                  <EyeIcon />
                </button>
              )}
            </span>
          ) : (
            <span className="variable-cell">
              <span className="variable-cell-text">{displayValue}</span>
              {displayValue !== null && (
                <button
                  className={`icon-btn copy-btn${copiedId === valueCopyId ? ' copied' : ''}`}
                  aria-label="Copy value"
                  title="Copy value"
                  onClick={() => void copy(displayValue, valueCopyId)}
                >
                  {copiedId === valueCopyId ? <CheckIcon /> : <CopyIcon />}
                </button>
              )}
            </span>
          )}
        </td>
        <td className="variable-actions">
          <div className="variable-actions-inner">
            {editing ? (
              <>
                <button className="icon-btn" aria-label="Save" title="Save" onClick={() => void handleSaveEdit()} disabled={busy}>
                  <CheckIcon />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Cancel"
                  title="Cancel"
                  onClick={() => {
                    setEditing(false);
                    setEditValue(variable.isSecret ? '' : (variable.value ?? ''));
                  }}
                  disabled={busy}
                >
                  <CancelIcon />
                </button>
              </>
            ) : (
              <>
                {isAdmin && (
                  <button
                    className="icon-btn"
                    aria-label={variable.isSecret ? 'Unflag Secret' : 'Flag as Secret'}
                    title={variable.isSecret ? 'Unflag Secret' : 'Flag as Secret'}
                    onClick={() => void handleToggleSecret()}
                    disabled={busy}
                  >
                    <LockIcon open={!variable.isSecret} />
                  </button>
                )}
                {/* A Member can edit a non-Secret value (PRD Feature 2) but
                    never a Secret's, so the button doesn't even appear —
                    the backend enforces the same rule independently. */}
                {(isAdmin || !variable.isSecret) && (
                  <button className="icon-btn" aria-label="Edit" title="Edit" onClick={() => setEditing(true)} disabled={busy}>
                    <PencilIcon />
                  </button>
                )}
                <button
                  className="icon-btn"
                  aria-label="History"
                  title="History"
                  onClick={() => void handleToggleHistory()}
                  disabled={busy}
                >
                  <ClockIcon />
                </button>
                {rollbackPending && <span className="pending-badge">Rollback requested</span>}
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
                    <TrashIcon />
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
      {showHistory && (
        <tr className="variable-history-row">
          <td colSpan={3}>
            <div className="variable-history">
              {history.length === 0 ? (
                <p className="variables-empty">No history yet.</p>
              ) : (
                <ul>
                  {history.map((entry) => (
                    <li key={entry.versionId}>
                      <span className="history-value">
                        {variable.isSecret ? '••••••••' : (entry.value ?? '(not set)')}
                      </span>
                      <span className="history-date">
                        {entry.lastModified ? new Date(entry.lastModified).toLocaleString() : ''}
                      </span>
                      {entry.isCurrent ? (
                        <span className="history-current">current</span>
                      ) : (
                        // A Member's rollback goes through a RollbackRequest for
                        // Admin approval (PRD Feature 5/6) — same button either
                        // way, the role check happens server-side.
                        <button onClick={() => void handleRollback(entry.versionId)} disabled={busy || rollbackPending}>
                          {isAdmin ? 'Restore' : rollbackPending ? 'Rollback requested' : 'Request rollback'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 3v12M4 7l4-4 4 4M16 21V9M12 17l4 4 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 12.75l6 6 9-13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 2 21h20Z" />
      <path d="M12 10v5" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.74 9 14.394 18M9.606 18 9.26 9M19.228 5.79 18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.11 48.11 0 0 0-3.478-.397m-11.978.397a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 6.75V12l3.75 2.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {open ? (
        <path
          d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
