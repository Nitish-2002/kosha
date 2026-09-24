import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import { getProject, type ProjectSummary } from '../api/projects';
import { listEnvironments, listComponentConfigs, type EnvironmentSummary, type ComponentConfigSummary } from '../api/environments';
import { addToEnvironment, getDiff, type DiffResult } from '../api/diff';
import { Select } from '../components/Select';
import './ComparePage.scss';

interface ComponentDiff {
  projectComponentId: string;
  componentName: string;
  configAId: string;
  configBId: string;
  result: DiffResult;
}

// Comparison only ever makes sense within one project — two unrelated
// projects' env vars have nothing meaningful to say about each other — so
// this is reached from the project page (ProjectDetailPage's "Compare
// environments" link), not a standalone picker where you choose a project
// from scratch.
export function ComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { showToast } = useToast();

  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [envAId, setEnvAId] = useState('');
  const [envBId, setEnvBId] = useState('');
  const [configsA, setConfigsA] = useState<ComponentConfigSummary[]>([]);
  const [configsB, setConfigsB] = useState<ComponentConfigSummary[]>([]);
  const [diffs, setDiffs] = useState<ComponentDiff[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RowStatus | 'all'>('all');
  const [componentFilter, setComponentFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then(setProject)
      .catch(() => showToast('Could not load this project.', 'error'));
    listEnvironments(projectId)
      .then((envs) => {
        setEnvironments(envs);
        if (envs.length >= 2) {
          setEnvAId(envs[0].id);
          setEnvBId(envs[1].id);
        }
      })
      .catch(() => showToast('Could not load environments.', 'error'));
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!envAId) return;
    listComponentConfigs(envAId)
      .then(setConfigsA)
      .catch(() => setConfigsA([]));
  }, [envAId]);

  useEffect(() => {
    if (!envBId) return;
    listComponentConfigs(envBId)
      .then(setConfigsB)
      .catch(() => setConfigsB([]));
  }, [envBId]);

  function runCompare(): void {
    const shared = configsA
      .map((a) => {
        const b = configsB.find((c) => c.projectComponentId === a.projectComponentId);
        return b ? { a, b } : null;
      })
      .filter((pair): pair is { a: ComponentConfigSummary; b: ComponentConfigSummary } => pair !== null);

    if (shared.length === 0) {
      setDiffs([]);
      return;
    }
    setLoading(true);
    Promise.all(
      shared.map(({ a, b }) =>
        getDiff(a.id, b.id).then((result) => ({
          projectComponentId: a.projectComponentId,
          componentName: a.componentName,
          configAId: a.id,
          configBId: b.id,
          result,
        })),
      ),
    )
      .then(setDiffs)
      .catch(() => showToast('Could not compare environments.', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (envAId && envBId && configsA.length > 0 && configsB.length > 0) runCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envAId, envBId, configsA, configsB]);

  async function handleAdd(
    componentDiff: ComponentDiff,
    direction: 'a-to-b' | 'b-to-a',
    key: string,
  ): Promise<void> {
    const busyId = `${componentDiff.projectComponentId}:${key}`;
    setBusyKey(busyId);
    try {
      if (direction === 'a-to-b') {
        await addToEnvironment(componentDiff.configAId, componentDiff.configBId, key);
      } else {
        await addToEnvironment(componentDiff.configBId, componentDiff.configAId, key);
      }
      showToast(`"${key}" added.`);
      runCompare();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not add that key.', 'error');
    } finally {
      setBusyKey(null);
    }
  }

  const envAName = environments.find((e) => e.id === envAId)?.name ?? 'A';
  const envBName = environments.find((e) => e.id === envBId)?.name ?? 'B';

  // Falls back to all when the picked component isn't shared by the newly chosen environment pair.
  const activeComponentFilter = diffs?.some((d) => d.projectComponentId === componentFilter) ? componentFilter : null;

  const onlyInA = configsA.filter((a) => !configsB.some((b) => b.projectComponentId === a.projectComponentId));
  const onlyInB = configsB.filter((b) => !configsA.some((a) => a.projectComponentId === b.projectComponentId));

  if (!project) return <p className="compare-empty">Loading…</p>;

  return (
    <div className="compare-page">
      <Link className="compare-back-link" to={`/projects/${project.id}`}>
        ← {project.name}
      </Link>
      <div className="compare-header">
        <h1>Compare environments</h1>
        <p>See what's missing or set differently between two of this project's environments.</p>
      </div>

      {environments.length < 2 ? (
        <p className="compare-empty">This project needs at least two environments to compare.</p>
      ) : (
        <div className="compare-pickers">
          <label>
            Environment A
            <Select
              value={envAId}
              options={environments.map((e) => ({ value: e.id, label: e.name }))}
              onChange={setEnvAId}
            />
          </label>
          <label>
            Environment B
            <Select
              value={envBId}
              options={environments.map((e) => ({ value: e.id, label: e.name }))}
              onChange={setEnvBId}
            />
          </label>
        </div>
      )}

      {loading ? (
        <p className="compare-empty">Comparing…</p>
      ) : diffs ? (
        <>
          {onlyInA.length > 0 && (
            <p className="compare-note">
              Only connected in {envAName}: {onlyInA.map((c) => c.componentName).join(', ')}
            </p>
          )}
          {onlyInB.length > 0 && (
            <p className="compare-note">
              Only connected in {envBName}: {onlyInB.map((c) => c.componentName).join(', ')}
            </p>
          )}

          {diffs.length === 0 ? (
            <p className="compare-empty">No components are connected in both environments.</p>
          ) : (
            <>
              <div className="compare-toolbar">
                <input
                  className="compare-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search keys…"
                />
                <div className="compare-filter-chips">
                  {(
                    [
                      { value: 'all', label: 'All' },
                      { value: 'matching', label: 'Match' },
                      { value: 'changed', label: 'Changed' },
                      { value: 'removed', label: `Only in ${envAName}` },
                      { value: 'added', label: `Only in ${envBName}` },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`compare-chip-filter${statusFilter === option.value ? ' compare-chip-filter--active' : ''}`}
                      onClick={() => setStatusFilter(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {diffs.length > 1 && (
                  <div className="compare-filter-chips">
                    {[{ projectComponentId: null, componentName: 'All components' }, ...diffs].map((option) => (
                      <button
                        key={option.projectComponentId ?? 'all'}
                        type="button"
                        className={`compare-chip-filter${activeComponentFilter === option.projectComponentId ? ' compare-chip-filter--active' : ''}`}
                        onClick={() => setComponentFilter(option.projectComponentId)}
                      >
                        {option.componentName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {diffs
                .filter((d) => activeComponentFilter === null || d.projectComponentId === activeComponentFilter)
                .map((componentDiff) => (
                <ComponentPanel
                  key={componentDiff.projectComponentId}
                  componentDiff={componentDiff}
                  envAName={envAName}
                  envBName={envBName}
                  busyKey={busyKey}
                  onAdd={handleAdd}
                  search={search}
                  statusFilter={statusFilter}
                />
              ))}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

type RowStatus = 'removed' | 'added' | 'changed' | 'matching';

interface UnifiedRow {
  key: string;
  status: RowStatus;
  valueA: string | null;
  valueB: string | null;
  isSecret: boolean;
}

// One table per component (Key/Status/EnvA/EnvB/Action) instead of four
// separate lists — matches the reference implementation's layout, and is
// genuinely easier to scan: every key's full picture is one row, not
// something pieced together across sections. Includes matching keys too —
// this is the full compare view, not only the discrepancies.
function toUnifiedRows({ onlyInFrom, onlyInTo, differing, matching }: DiffResult): UnifiedRow[] {
  return [
    ...onlyInFrom.map((e) => ({ key: e.key, status: 'removed' as const, valueA: e.value, valueB: null, isSecret: e.isSecret })),
    ...onlyInTo.map((e) => ({ key: e.key, status: 'added' as const, valueA: null, valueB: e.value, isSecret: e.isSecret })),
    ...differing.map((e) => ({
      key: e.key,
      status: 'changed' as const,
      valueA: e.fromValue,
      valueB: e.toValue,
      isSecret: e.isSecret,
    })),
    ...matching.map((e) => ({
      key: e.key,
      status: 'matching' as const,
      valueA: e.value,
      valueB: e.value,
      isSecret: e.isSecret,
    })),
  ].sort((a, b) => a.key.localeCompare(b.key));
}

function ComponentPanel({
  componentDiff,
  envAName,
  envBName,
  busyKey,
  onAdd,
  search,
  statusFilter,
}: {
  componentDiff: ComponentDiff;
  envAName: string;
  envBName: string;
  busyKey: string | null;
  onAdd: (componentDiff: ComponentDiff, direction: 'a-to-b' | 'b-to-a', key: string) => void;
  search: string;
  statusFilter: RowStatus | 'all';
}) {
  const allRows = toUnifiedRows(componentDiff.result);
  const query = search.trim().toLowerCase();
  const rows = allRows.filter(
    (row) =>
      (statusFilter === 'all' || row.status === statusFilter) &&
      (!query || row.key.toLowerCase().includes(query)),
  );
  const isBusy = (key: string) => busyKey === `${componentDiff.projectComponentId}:${key}`;

  if (allRows.length === 0) {
    return (
      <div className="compare-panel">
        <h2>{componentDiff.componentName}</h2>
        <p className="compare-empty">No variables in either environment for this component.</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="compare-panel">
        <h2>{componentDiff.componentName}</h2>
        <p className="compare-empty">No keys match your search/filter.</p>
      </div>
    );
  }

  return (
    <div className="compare-panel">
      <h2>{componentDiff.componentName}</h2>
      <div className="table-scroll">
        {/* Status colors (green=added, red=removed/changed) are the one
            scoped exception to the app's red/black palette — see
            CLAUDE.md — Conventions, matching the reference implementation. */}
        <table className="compare-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Status</th>
              <th>{envAName}</th>
              <th>{envBName}</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={`compare-row--${row.status}`}>
                <td className="compare-key">{row.key}</td>
                <td>
                  <span className="compare-status-chip">
                    {row.status === 'removed'
                      ? `Only in ${envAName}`
                      : row.status === 'added'
                        ? `Only in ${envBName}`
                        : row.status === 'changed'
                          ? 'Changed'
                          : 'Match'}
                  </span>
                </td>
                <td>
                  <DiffValueText value={row.valueA} isSecret={row.isSecret} />
                </td>
                <td>
                  <DiffValueText value={row.valueB} isSecret={row.isSecret} />
                </td>
                <td>
                  {row.status === 'removed' && (
                    <button disabled={isBusy(row.key)} onClick={() => onAdd(componentDiff, 'a-to-b', row.key)}>
                      Add to {envBName} →
                    </button>
                  )}
                  {row.status === 'added' && (
                    <button disabled={isBusy(row.key)} onClick={() => onAdd(componentDiff, 'b-to-a', row.key)}>
                      ← Add to {envAName}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffValueText({ value, isSecret }: { value: string | null; isSecret: boolean }) {
  if (isSecret) return <em className="compare-secret">key only — Secret</em>;
  return <span className="compare-value">{value ?? '—'}</span>;
}
