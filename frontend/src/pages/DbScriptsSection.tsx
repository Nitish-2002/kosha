import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  createDbScript,
  dbScriptLabel,
  downloadSqlBundle,
  listDbScripts,
  markDbScriptApplied,
  unapplyDbScript,
  updateDbScript,
  type DbScript,
  type DbScriptBoard,
} from '../api/db-scripts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Select } from '../components/Select';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { environmentColor } from '../lib/environmentColor';
import { formatCalendarDate, formatTimestamp } from '../lib/formatDate';
import { useRevealOnOpen } from '../lib/useRevealOnOpen';
import { DbRefreshPanel } from './DbRefreshPanel';
import './DbScriptsSection.scss';

// Same cap as the backend's MAX_SQL_LENGTH (create-db-script.dto.ts).
const MAX_SQL_LENGTH = 1_000_000;

// "missing" = still pending here, but already applied in a higher
// environment — the "ran in qa, forgot dev" case (PRD Feature 12).
type CellKind = 'applied' | 'pending' | 'missing' | 'not_applicable';

const KIND_LABEL: Record<CellKind, string> = {
  applied: 'Applied',
  pending: 'Pending',
  missing: 'Missing — already applied in a higher environment',
  not_applicable: 'Not applicable',
};

function cellKinds(script: DbScript): CellKind[] {
  return script.states.map((state, index) => {
    if (state.status !== 'pending') return state.status;
    const appliedHigher = script.states.slice(index + 1).some((higher) => higher.status === 'applied');
    return appliedHigher ? 'missing' : 'pending';
  });
}

// One status per script (row), for the filter cards: missing anywhere →
// 'missing'; else still pending anywhere → 'pending'; else 'done'.
type ScriptStatus = 'missing' | 'pending' | 'done';
type StatusFilter = ScriptStatus | 'all';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All scripts' },
  { value: 'missing', label: 'Missing' },
  { value: 'pending', label: 'Pending' },
  { value: 'done', label: 'Up to date' },
];

function scriptStatus(kinds: CellKind[]): ScriptStatus {
  if (kinds.includes('missing')) return 'missing';
  return kinds.includes('pending') ? 'pending' : 'done';
}

// openedAt: a fresh value on every click, used as the form's key so it
// always remounts, scrolls into view and takes focus — even when clicking
// Edit again on the script already open.
type FormState = { openedAt: number } & ({ mode: 'add' } | { mode: 'edit'; script: DbScript });

interface DriftConfirm {
  script: DbScript;
  environmentId: string;
  environmentName: string;
  lowerPendingNames: string[];
}

interface UndoConfirm {
  script: DbScript;
  environmentId: string;
  environmentName: string;
}

export function DbScriptsSection({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { showToast } = useToast();
  const [board, setBoard] = useState<DbScriptBoard | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [driftConfirm, setDriftConfirm] = useState<DriftConfirm | null>(null);
  const [undoConfirm, setUndoConfirm] = useState<UndoConfirm | null>(null);
  const [refreshOpen, setRefreshOpen] = useState(false);
  // Filters, same idea as the Compare page: status cards, search, and
  // "still to run in <environment>" ('' = every environment).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [environmentFilterId, setEnvironmentFilterId] = useState('');

  function loadBoard(): void {
    listDbScripts(projectId)
      .then((loadedBoard) => {
        setBoard(loadedBoard);
        setSelectedScriptId((current) => current ?? loadedBoard.scripts[0]?.id ?? null);
      })
      .catch(() => showToast('Could not load DB scripts.', 'error'));
  }

  useEffect(loadBoard, [projectId, showToast]);

  if (!board) {
    return <p className="project-detail-empty">Loading DB scripts…</p>;
  }

  const loadedBoard = board;
  if (loadedBoard.environments.length === 0) {
    return <p className="project-detail-empty">No environments yet — DB scripts are tracked per environment.</p>;
  }

  function replaceScript(updated: DbScript): void {
    setBoard((current) => {
      if (!current) return current;
      const exists = current.scripts.some((script) => script.id === updated.id);
      return {
        ...current,
        scripts: exists
          ? current.scripts.map((script) => (script.id === updated.id ? updated : script))
          : [...current.scripts, updated],
      };
    });
  }

  async function markApplied(script: DbScript, environmentId: string): Promise<void> {
    try {
      replaceScript(await markDbScriptApplied(projectId, script.id, environmentId));
      showToast(`${dbScriptLabel(script)} marked applied.`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not mark that script applied.', 'error');
    }
  }

  // Undo a wrong "Mark applied": an Admin's goes through right away, a
  // Member's becomes a request for an Admin (reason required). Resolves
  // true on success so the Member's reason form can close.
  async function undoMark(script: DbScript, environmentId: string, reason?: string): Promise<boolean> {
    const environmentName = loadedBoard.environments.find((environment) => environment.id === environmentId)?.name;
    try {
      const outcome = await unapplyDbScript(projectId, script.id, environmentId, reason);
      if (outcome.status === 'reverted') {
        replaceScript(outcome.script);
        showToast(`${dbScriptLabel(script)} is pending again in ${environmentName}.`);
      } else {
        replaceScript({
          ...script,
          states: script.states.map((state) =>
            state.environmentId === environmentId ? { ...state, undoRequested: true } : state,
          ),
        });
        showToast('Undo request sent for Admin approval.');
      }
      return true;
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not undo that mark.', 'error');
      return false;
    }
  }

  // Warn before marking a higher environment while a lower one still
  // hasn't run the script — the moment the mistake is usually made.
  function requestMarkApplied(script: DbScript, environmentIndex: number): void {
    const environment = loadedBoard.environments[environmentIndex];
    const lowerPendingNames = loadedBoard.environments
      .slice(0, environmentIndex)
      .filter((_lower, lowerIndex) => script.states[lowerIndex].status === 'pending')
      .map((lower) => lower.name);
    if (lowerPendingNames.length === 0) {
      void markApplied(script, environment.id);
      return;
    }
    setDriftConfirm({ script, environmentId: environment.id, environmentName: environment.name, lowerPendingNames });
  }

  const scriptsWithKinds = loadedBoard.scripts.map((script) => {
    const kinds = cellKinds(script);
    return { script, kinds, status: scriptStatus(kinds) };
  });
  const statusCounts: Record<StatusFilter, number> = {
    all: scriptsWithKinds.length,
    missing: scriptsWithKinds.filter((entry) => entry.status === 'missing').length,
    pending: scriptsWithKinds.filter((entry) => entry.status === 'pending').length,
    done: scriptsWithKinds.filter((entry) => entry.status === 'done').length,
  };
  // Scripts still to run in each environment (pending or missing), in order.
  const toRunByEnvironment = loadedBoard.environments.map((_environment, environmentIndex) =>
    scriptsWithKinds
      .filter(({ kinds }) => kinds[environmentIndex] === 'pending' || kinds[environmentIndex] === 'missing')
      .map(({ script }) => script),
  );
  const environmentFilterIndex = loadedBoard.environments.findIndex((environment) => environment.id === environmentFilterId);
  const searchText = search.trim().toLowerCase();
  const visibleRows = scriptsWithKinds.filter(({ script, kinds, status }) => {
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (environmentFilterIndex !== -1 && kinds[environmentFilterIndex] !== 'pending' && kinds[environmentFilterIndex] !== 'missing') {
      return false;
    }
    return !searchText || dbScriptLabel(script).toLowerCase().includes(searchText);
  });
  const filtering = statusFilter !== 'all' || searchText !== '' || environmentFilterIndex !== -1;
  const selected = scriptsWithKinds.find((entry) => entry.script.id === selectedScriptId) ?? null;

  function clearFilters(): void {
    setStatusFilter('all');
    setSearch('');
    setEnvironmentFilterId('');
  }

  return (
    <div className="db-scripts-section">
      <div className="db-scripts-toolbar">
        <div className="db-scripts-toolbar-actions">
          {isAdmin && loadedBoard.environments.length >= 2 && (
            <button type="button" className="outline-btn" onClick={() => setRefreshOpen(true)}>
              Record DB refresh
            </button>
          )}
          <button type="button" className="variables-add-btn" onClick={() => setForm({ mode: 'add', openedAt: Date.now() })}>
            Add script
          </button>
        </div>
      </div>

      {form && (
        <DbScriptForm
          key={form.openedAt}
          projectId={projectId}
          environments={loadedBoard.environments}
          editing={form.mode === 'edit' ? form.script : null}
          onCancel={() => setForm(null)}
          onSaved={(saved) => {
            replaceScript(saved);
            setSelectedScriptId(saved.id);
            setForm(null);
            showToast(form.mode === 'edit' ? `${dbScriptLabel(saved)} saved.` : `${dbScriptLabel(saved)} added.`);
          }}
        />
      )}

      {refreshOpen && (
        <DbRefreshPanel
          projectId={projectId}
          environments={loadedBoard.environments}
          onCancel={() => setRefreshOpen(false)}
          onRecorded={(targetEnvironmentId) => {
            setRefreshOpen(false);
            // Answer "what do I run now?" straight away: show just that
            // environment's scripts to run.
            setStatusFilter('all');
            setSearch('');
            setEnvironmentFilterId(targetEnvironmentId);
            showToast('DB refresh recorded.');
            loadBoard();
          }}
        />
      )}

      {loadedBoard.scripts.length > 0 && (
        <div className="db-scripts-filters">
          <div className="db-scripts-stats" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`db-scripts-stat db-scripts-stat--${filter.value}${statusFilter === filter.value ? ' db-scripts-stat--active' : ''}`}
                aria-pressed={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                <span className="db-scripts-stat-label">{filter.label}</span>
                <span className="db-scripts-stat-count">{statusCounts[filter.value]}</span>
              </button>
            ))}
          </div>

          <div className="db-scripts-filter-row">
            <label className="variables-search db-scripts-search">
              <SearchIcon />
              <input
                aria-label="Search scripts"
                placeholder="Search by name or number"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="db-scripts-environment-filter">
              <Select
                value={environmentFilterId}
                onChange={setEnvironmentFilterId}
                options={[
                  { value: '', label: 'All environments' },
                  ...loadedBoard.environments.map((environment, environmentIndex) => ({
                    value: environment.id,
                    label: `Still to run in ${environment.name} (${toRunByEnvironment[environmentIndex].length})`,
                  })),
                ]}
              />
            </div>
            {filtering && (
              <button type="button" className="outline-btn outline-btn--small" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>

          {environmentFilterIndex !== -1 && (
            <div className="db-run-list">
              <span>
                {toRunByEnvironment[environmentFilterIndex].length === 0
                  ? `Nothing left to run in ${loadedBoard.environments[environmentFilterIndex].name}.`
                  : `Run these ${toRunByEnvironment[environmentFilterIndex].length} in ${loadedBoard.environments[environmentFilterIndex].name}, top to bottom, then mark each one applied.`}
              </span>
              {toRunByEnvironment[environmentFilterIndex].length > 0 && (
                <button
                  type="button"
                  className="variables-add-btn"
                  onClick={() =>
                    downloadSqlBundle(
                      toRunByEnvironment[environmentFilterIndex],
                      loadedBoard.environments[environmentFilterIndex].name,
                    )
                  }
                >
                  Download these as one .sql
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {loadedBoard.scripts.length === 0 ? (
        <p className="variables-empty">No DB scripts yet. Add one to start tracking where it has run.</p>
      ) : (
        <div className="db-scripts-layout">
          <div className="db-scripts-main">
            <div className="table-card">
              <div className="table-scroll">
                <table className="db-scripts-table">
                  <thead>
                    <tr>
                      <th scope="col">Script</th>
                      {loadedBoard.environments.map((environment, environmentIndex) => (
                        <th scope="col" key={environment.id}>
                          <span className="db-scripts-env-heading">
                            <span
                              className="env-switch-dot"
                              style={{ background: environmentColor(environmentIndex) }}
                              aria-hidden="true"
                            />
                            {environment.name}
                            {toRunByEnvironment[environmentIndex].length > 0 && (
                              <button
                                type="button"
                                className="icon-btn"
                                title={`Show the ${toRunByEnvironment[environmentIndex].length} still to run`}
                                aria-label={`Show the ${toRunByEnvironment[environmentIndex].length} scripts still to run in ${environment.name}`}
                                onClick={() => setEnvironmentFilterId(environment.id)}
                              >
                                <DownloadIcon />
                              </button>
                            )}
                          </span>
                          {environment.lastRefresh && (
                            <span className="db-scripts-env-refresh">
                              Restored from {environment.lastRefresh.sourceEnvironmentName} ·{' '}
                              {formatCalendarDate(environment.lastRefresh.dumpTakenOn)}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(({ script, kinds }) => (
                      <tr
                        key={script.id}
                        className={script.id === selectedScriptId ? 'db-scripts-row--selected' : undefined}
                      >
                        <th scope="row">
                          <button
                            type="button"
                            className="db-scripts-name-btn"
                            aria-current={script.id === selectedScriptId ? 'true' : undefined}
                            onClick={() => setSelectedScriptId(script.id)}
                          >
                            <span className="db-scripts-name">{dbScriptLabel(script)}</span>
                            <span className="db-scripts-tags">
                              {script.rerunAfterRestore && <span className="chip">Re-run after restore</span>}
                              {script.locked && <span className="chip">Locked</span>}
                            </span>
                          </button>
                        </th>
                        {kinds.map((kind, environmentIndex) => (
                          <td
                            key={loadedBoard.environments[environmentIndex].id}
                            className={`db-scripts-cell db-scripts-cell--${kind}`}
                            title={KIND_LABEL[kind]}
                          >
                            <CellContent kind={kind} appliedAt={script.states[environmentIndex].appliedAt} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {visibleRows.length === 0 && (
              <p className="variables-empty">
                No scripts match these filters.{' '}
                <button type="button" className="db-run-list-link" onClick={clearFilters}>
                  Clear filters
                </button>
              </p>
            )}
            <p className="db-scripts-legend">
              Environments run lower → higher, left to right. <strong>Missing</strong> means the script already ran in a
              higher environment but not here. N/A means the author said this environment doesn't need it.
            </p>
          </div>

          {selected && (
            <ScriptDetail
              script={selected.script}
              kinds={selected.kinds}
              environments={loadedBoard.environments}
              currentUserEmail={user?.email ?? null}
              isAdmin={isAdmin}
              onEdit={() => setForm({ mode: 'edit', script: selected.script, openedAt: Date.now() })}
              onMarkApplied={(environmentIndex) => requestMarkApplied(selected.script, environmentIndex)}
              onSetPending={(environmentIndex) => {
                const environment = loadedBoard.environments[environmentIndex];
                setUndoConfirm({ script: selected.script, environmentId: environment.id, environmentName: environment.name });
              }}
              onRequestUndo={(environmentIndex, reason) =>
                undoMark(selected.script, loadedBoard.environments[environmentIndex].id, reason)
              }
            />
          )}
        </div>
      )}

      {driftConfirm && (
        <ConfirmDialog
          title={`${driftConfirm.lowerPendingNames.join(', ')} hasn't run this yet`}
          message={`You are marking ${dbScriptLabel(driftConfirm.script)} applied in ${driftConfirm.environmentName}, but it is still pending in ${driftConfirm.lowerPendingNames.join(', ')}. If you continue, ${driftConfirm.lowerPendingNames.join(', ')} will show as Missing until someone runs it there.`}
          confirmLabel="Mark anyway"
          onCancel={() => setDriftConfirm(null)}
          onConfirm={() => {
            void markApplied(driftConfirm.script, driftConfirm.environmentId);
            setDriftConfirm(null);
          }}
        />
      )}

      {undoConfirm && (
        <ConfirmDialog
          title={`Set back to pending in ${undoConfirm.environmentName}?`}
          message={`Only do this if ${dbScriptLabel(undoConfirm.script)} never actually ran in ${undoConfirm.environmentName}. The mark is cleared and the change is recorded in the audit log.`}
          confirmLabel="Set to pending"
          onCancel={() => setUndoConfirm(null)}
          onConfirm={() => {
            void undoMark(undoConfirm.script, undoConfirm.environmentId);
            setUndoConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function CellContent({ kind, appliedAt }: { kind: CellKind; appliedAt: string | null }) {
  if (kind === 'applied') {
    return (
      <>
        <CheckIcon />
        <span>Applied</span>
        {appliedAt && <span className="db-scripts-cell-date">{formatTimestamp(appliedAt).slice(0, 5)}</span>}
      </>
    );
  }
  if (kind === 'missing') {
    return (
      <>
        <WarningIcon />
        <span>Missing</span>
      </>
    );
  }
  return <span>{kind === 'pending' ? 'Pending' : 'N/A'}</span>;
}

function ScriptDetail({
  script,
  kinds,
  environments,
  currentUserEmail,
  isAdmin,
  onEdit,
  onMarkApplied,
  onSetPending,
  onRequestUndo,
}: {
  script: DbScript;
  kinds: CellKind[];
  environments: DbScriptBoard['environments'];
  currentUserEmail: string | null;
  isAdmin: boolean;
  onEdit: () => void;
  onMarkApplied: (environmentIndex: number) => void;
  onSetPending: (environmentIndex: number) => void;
  onRequestUndo: (environmentIndex: number, reason: string) => Promise<boolean>;
}) {
  const { showToast } = useToast();
  // The Member's "Request undo" reason form, open for one environment at a time.
  const [undoEnvironmentId, setUndoEnvironmentId] = useState<string | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const [sendingUndo, setSendingUndo] = useState(false);

  async function sendUndoRequest(event: FormEvent, environmentIndex: number): Promise<void> {
    event.preventDefault();
    setSendingUndo(true);
    const sent = await onRequestUndo(environmentIndex, undoReason);
    setSendingUndo(false);
    if (sent) {
      setUndoEnvironmentId(null);
      setUndoReason('');
    }
  }
  const appliedIn = environments.filter((_environment, index) => kinds[index] === 'applied').map((environment) => environment.name);

  function copySql(): void {
    navigator.clipboard
      .writeText(script.sql)
      .then(() => showToast('SQL copied.'))
      .catch(() => showToast('Could not copy — select the SQL and copy it manually.', 'error'));
  }

  function downloadSql(): void {
    const fileUrl = URL.createObjectURL(new Blob([script.sql], { type: 'application/sql' }));
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = `${dbScriptLabel(script).replace(/[^\w.-]+/g, '_')}.sql`;
    link.click();
    URL.revokeObjectURL(fileUrl);
  }

  return (
    <aside className="db-script-detail" aria-label="Script detail">
      <div className="db-script-detail-header">
        <h2>{dbScriptLabel(script)}</h2>
        <span>
          Added by {script.createdByEmail === currentUserEmail ? 'you' : script.createdByEmail} ·{' '}
          {formatTimestamp(script.createdAt)}
        </span>
      </div>

      <div className="db-script-detail-actions">
        <button type="button" className="outline-btn outline-btn--small" onClick={copySql}>
          <CopyIcon /> Copy SQL
        </button>
        <button type="button" className="outline-btn outline-btn--small" onClick={downloadSql}>
          <DownloadIcon /> Download .sql
        </button>
        <button type="button" className="outline-btn outline-btn--small" onClick={onEdit}>
          <PencilIcon /> Edit
        </button>
      </div>

      {script.locked && (
        <p className="db-script-detail-note">
          Name and SQL are locked: this has already run
          {appliedIn.length > 0 ? ` in ${appliedIn.join(', ')}` : ' in an environment'}, and changing them would make
          those databases differ from the script. To fix the SQL, add a new script. You can still change Applies to and
          Re-run after every restore.
        </p>
      )}

      <pre className="db-script-sql">{script.sql}</pre>

      <ul className="db-script-env-list" aria-label="Environments">
        {environments.map((environment, environmentIndex) => {
          const state = script.states[environmentIndex];
          const kind = kinds[environmentIndex];
          const canMark = kind === 'pending' || kind === 'missing';
          return (
            <li key={environment.id}>
              <span className="env-switch-dot" style={{ background: environmentColor(environmentIndex) }} aria-hidden="true" />
              <div className="db-script-env-text">
                <span className="db-script-env-name">{environment.name}</span>
                <span className={`db-script-env-status${kind === 'missing' ? ' db-script-env-status--missing' : ''}`}>
                  {KIND_LABEL[kind]}
                </span>
                {state.fromDump ? (
                  <span className="db-script-env-meta">
                    Came with the {state.fromDump.sourceEnvironmentName} dump of{' '}
                    {formatCalendarDate(state.fromDump.dumpTakenOn)}
                  </span>
                ) : (
                  state.appliedAt && (
                    <span className="db-script-env-meta">
                      {state.appliedByEmail === currentUserEmail ? 'You' : state.appliedByEmail} ·{' '}
                      {formatTimestamp(state.appliedAt)}
                    </span>
                  )
                )}
              </div>
              {canMark && (
                <button
                  type="button"
                  className={kind === 'missing' ? 'variables-add-btn' : 'outline-btn outline-btn--small'}
                  onClick={() => onMarkApplied(environmentIndex)}
                >
                  Mark applied
                </button>
              )}
              {kind === 'applied' && isAdmin && (
                <button type="button" className="outline-btn outline-btn--small" onClick={() => onSetPending(environmentIndex)}>
                  Set to pending
                </button>
              )}
              {kind === 'applied' && !isAdmin && state.undoRequested && <span className="pending-badge">Undo requested</span>}
              {kind === 'applied' && !isAdmin && !state.undoRequested && undoEnvironmentId !== environment.id && (
                <button
                  type="button"
                  className="outline-btn outline-btn--small"
                  onClick={() => {
                    setUndoEnvironmentId(environment.id);
                    setUndoReason('');
                  }}
                >
                  Request undo
                </button>
              )}
              {undoEnvironmentId === environment.id && (
                <form className="db-script-undo-form" onSubmit={(event) => void sendUndoRequest(event, environmentIndex)}>
                  <label>
                    Why should this be undone? An Admin will review it.
                    <input
                      value={undoReason}
                      onChange={(event) => setUndoReason(event.target.value)}
                      placeholder="e.g. Marked the wrong script — never ran it here"
                      maxLength={500}
                      required
                      autoFocus
                    />
                  </label>
                  <div className="db-script-undo-actions">
                    <button
                      type="button"
                      className="outline-btn outline-btn--small"
                      onClick={() => setUndoEnvironmentId(null)}
                      disabled={sendingUndo}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="variables-add-btn" disabled={sendingUndo || !undoReason.trim()}>
                      {sendingUndo ? 'Sending…' : 'Send request'}
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function DbScriptForm({
  projectId,
  environments,
  editing,
  onCancel,
  onSaved,
}: {
  projectId: string;
  environments: DbScriptBoard['environments'];
  editing: DbScript | null;
  onCancel: () => void;
  onSaved: (saved: DbScript) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [sql, setSql] = useState(editing?.sql ?? '');
  const [rerunAfterRestore, setRerunAfterRestore] = useState(editing?.rerunAfterRestore ?? false);
  const [notApplicableIds, setNotApplicableIds] = useState<Set<string>>(
    new Set(editing?.states.filter((state) => state.status === 'not_applicable').map((state) => state.environmentId)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRevealOnOpen<HTMLFormElement>();
  // Name and SQL are fixed once it has run anywhere; the rest stays editable.
  const locked = editing?.locked ?? false;
  const appliedEnvironmentIds = new Set(
    editing?.states.filter((state) => state.status === 'applied').map((state) => state.environmentId),
  );

  async function loadFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = ''; // picking the same file again still fires onChange
    if (!file) return;
    const fileText = await file.text();
    if (fileText.length > MAX_SQL_LENGTH) {
      setError(`That file is too large — the limit is ${MAX_SQL_LENGTH.toLocaleString('en-IN')} characters.`);
      return;
    }
    setSql(fileText);
    if (!name) setName(file.name.replace(/\.sql$/i, ''));
    setError(null);
  }

  function toggleApplies(environmentId: string, applies: boolean): void {
    setNotApplicableIds((current) => {
      const next = new Set(current);
      if (applies) next.delete(environmentId);
      else next.add(environmentId);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const input = { name, sql, rerunAfterRestore, notApplicableEnvironmentIds: [...notApplicableIds] };
    try {
      onSaved(editing ? await updateDbScript(projectId, editing.id, input) : await createDbScript(projectId, input));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form ref={formRef} className="variables-form db-script-form" onSubmit={(event) => void handleSubmit(event)}>
      <h3>{editing ? `Edit ${dbScriptLabel(editing)}` : 'Add DB script'}</h3>

      {locked && (
        <p className="db-script-detail-note db-script-form-locked">
          <LockIcon />
          <span>
            Already ran in {environments.filter((environment) => appliedEnvironmentIds.has(environment.id)).map((environment) => environment.name).join(', ') || 'an environment'}
            , so the name and SQL are locked. You can still change where it applies and the re-run option.
          </span>
        </p>
      )}

      <label>
        Script name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. add_orders_discount_column"
          readOnly={locked}
          required
        />
      </label>

      <div className="db-script-form-sql">
        <div className="db-script-form-sql-header">
          <label htmlFor="db-script-sql">SQL</label>
          {!locked && (
            <label className="outline-btn outline-btn--small db-script-upload">
              Upload .sql file
              <input type="file" accept=".sql,text/plain" onChange={(event) => void loadFile(event)} />
            </label>
          )}
        </div>
        <textarea
          id="db-script-sql"
          // Locked SQL is just shown, so size it to its content (within limits).
          rows={locked ? Math.min(Math.max(sql.split('\n').length, 3), 16) : 10}
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          maxLength={MAX_SQL_LENGTH}
          readOnly={locked}
          required
        />
        {!locked && (
          <span className="db-script-form-hint">
            Visible to everyone on this project. Never put passwords or keys in a script.
          </span>
        )}
      </div>

      <fieldset className="db-script-form-applies">
        <legend>Applies to</legend>
        <div className="db-script-form-env-grid">
          {environments.map((environment, environmentIndex) => {
            const ranHere = appliedEnvironmentIds.has(environment.id);
            return (
              <label
                key={environment.id}
                className={`db-script-form-env${ranHere ? ' db-script-form-env--ran' : ''}`}
                title={ranHere ? 'Already ran here, so it can’t be marked N/A' : undefined}
              >
                <input
                  type="checkbox"
                  checked={!notApplicableIds.has(environment.id)}
                  disabled={ranHere}
                  onChange={(event) => toggleApplies(environment.id, event.target.checked)}
                />
                <span className="env-switch-dot" style={{ background: environmentColor(environmentIndex) }} aria-hidden="true" />
                <span className="db-script-form-env-name">{environment.name}</span>
                {ranHere && <span className="chip">Ran here</span>}
              </label>
            );
          })}
        </div>
        <span className="db-script-form-hint">Untick environments that don't need this script. They show as N/A.</span>
      </fieldset>

      <label className="db-script-form-option">
        <input type="checkbox" checked={rerunAfterRestore} onChange={(event) => setRerunAfterRestore(event.target.checked)} />
        <span className="db-script-form-option-text">
          <span className="db-script-form-option-title">Re-run after every restore</span>
          <span className="db-script-form-hint">
            Only for scripts like anonymisation that must run again on every restored database. When on, this script goes
            back to pending after every DB refresh, even if the dump already has it.
          </span>
        </span>
      </label>

      {!editing && (
        <span className="db-script-form-hint">You can edit the name and SQL until it runs in any environment. After that they're locked.</span>
      )}
      {error && <p className="variables-error">{error}</p>}
      <div className="variables-form-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="project-detail-add-btn" disabled={submitting}>
          {submitting ? 'Saving…' : editing ? 'Save' : 'Add script'}
        </button>
      </div>
    </form>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v12m-5-5 5 5 5-5M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
