import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import { getProject, type ProjectSummary } from '../api/projects';
import { listEnvironments, listComponentConfigs, type EnvironmentSummary, type ComponentConfigSummary } from '../api/environments';
import { addToEnvironment, getDiff, type DiffResult } from '../api/diff';
import { Select } from '../components/Select';
import './ComparePage.scss';

type RowStatus = 'changed' | 'onlyA' | 'onlyB' | 'match';
type StatusFilter = RowStatus | 'all';
type CompareView = 'components' | 'keys';

interface CompareRow {
  key: string;
  status: RowStatus;
  valueA: string | null;
  valueB: string | null;
  isSecret: boolean;
}

interface ComponentDiff {
  projectComponentId: string;
  componentName: string;
  configA: ComponentConfigSummary;
  configB: ComponentConfigSummary;
  rows: CompareRow[];
  counts: Record<RowStatus, number>;
}

const STATUSES: RowStatus[] = ['changed', 'onlyA', 'onlyB', 'match'];

function toRows({ onlyInFrom, onlyInTo, differing, matching }: DiffResult): CompareRow[] {
  return [
    ...onlyInFrom.map((entry) => ({ key: entry.key, status: 'onlyA' as const, valueA: entry.value, valueB: null, isSecret: entry.isSecret })),
    ...onlyInTo.map((entry) => ({ key: entry.key, status: 'onlyB' as const, valueA: null, valueB: entry.value, isSecret: entry.isSecret })),
    ...differing.map((entry) => ({
      key: entry.key,
      status: 'changed' as const,
      valueA: entry.fromValue,
      valueB: entry.toValue,
      isSecret: entry.isSecret,
    })),
    ...matching.map((entry) => ({ key: entry.key, status: 'match' as const, valueA: entry.value, valueB: entry.value, isSecret: entry.isSecret })),
  ].sort((first, second) => first.key.localeCompare(second.key));
}

function countByStatus(rows: CompareRow[]): Record<RowStatus, number> {
  const counts: Record<RowStatus, number> = { changed: 0, onlyA: 0, onlyB: 0, match: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function differenceCount(counts: Record<RowStatus, number>): number {
  return counts.changed + counts.onlyA + counts.onlyB;
}

const rowId = (componentDiff: ComponentDiff, row: CompareRow) => `${componentDiff.projectComponentId}:${row.key}`;

// A key missing on one side can be copied over — but only into an S3 source;
// GitHub sources are read-only in Kosha.
function addTarget(componentDiff: ComponentDiff, row: CompareRow): 'a-to-b' | 'b-to-a' | null {
  if (row.status === 'onlyA' && componentDiff.configB.sourceType === 's3') return 'a-to-b';
  if (row.status === 'onlyB' && componentDiff.configA.sourceType === 's3') return 'b-to-a';
  return null;
}

// Comparison only ever makes sense within one project, so this is reached
// from the project page's Compare button, not a standalone project picker.
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
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [hideMatches, setHideMatches] = useState(false);
  const [componentFilter, setComponentFilter] = useState<string | null>(null);
  const [view, setView] = useState<CompareView>('components');
  const [openComponentIds, setOpenComponentIds] = useState<Set<string>>(new Set());
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then(setProject)
      .catch(() => showToast('Could not load this project.', 'error'));
    listEnvironments(projectId)
      .then((environmentsData) => {
        setEnvironments(environmentsData);
        if (environmentsData.length >= 2) {
          setEnvAId(environmentsData[0].id);
          setEnvBId(environmentsData[1].id);
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
    const sharedPairs = configsA.flatMap((configA) => {
      const configB = configsB.find((candidate) => candidate.projectComponentId === configA.projectComponentId);
      return configB ? [{ configA, configB }] : [];
    });
    if (sharedPairs.length === 0) {
      setDiffs([]);
      return;
    }
    setLoading(true);
    Promise.all(
      sharedPairs.map(({ configA, configB }) =>
        getDiff(configA.id, configB.id).then((result) => {
          const rows = toRows(result);
          return {
            projectComponentId: configA.projectComponentId,
            componentName: configA.componentName,
            configA,
            configB,
            rows,
            counts: countByStatus(rows),
          };
        }),
      ),
    )
      .then((componentDiffs) => {
        // Most differences first — that's where attention goes.
        componentDiffs.sort(
          (first, second) =>
            differenceCount(second.counts) - differenceCount(first.counts) ||
            first.componentName.localeCompare(second.componentName),
        );
        setDiffs(componentDiffs);
        setSelectedRowIds(new Set());
        setOpenComponentIds((current) =>
          current.size > 0 || componentDiffs.length === 0 ? current : new Set([componentDiffs[0].projectComponentId]),
        );
        // A single component has no summary worth showing — go straight to keys.
        if (componentDiffs.length === 1) setView('keys');
      })
      .catch(() => showToast('Could not compare environments.', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (envAId && envBId && configsA.length > 0 && configsB.length > 0) runCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envAId, envBId, configsA, configsB]);

  const envAName = environments.find((environment) => environment.id === envAId)?.name ?? 'A';
  const envBName = environments.find((environment) => environment.id === envBId)?.name ?? 'B';
  const statusLabel: Record<RowStatus, string> = {
    changed: 'Changed',
    onlyA: `Only in ${envAName}`,
    onlyB: `Only in ${envBName}`,
    match: 'Match',
  };

  // Falls back to all when the picked component isn't shared by the new pair.
  const activeComponentFilter = diffs?.some((diff) => diff.projectComponentId === componentFilter) ? componentFilter : null;
  const scopedDiffs = (diffs ?? []).filter(
    (diff) => activeComponentFilter === null || diff.projectComponentId === activeComponentFilter,
  );
  const searching = search.trim() !== '';

  const totals = useMemo(() => countByStatus(scopedDiffs.flatMap((diff) => diff.rows)), [scopedDiffs]);
  const totalKeys = STATUSES.reduce((sum, status) => sum + totals[status], 0);

  function rowVisible(row: CompareRow): boolean {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (hideMatches && row.status === 'match') return false;
    return !searching || row.key.toLowerCase().includes(search.trim().toLowerCase());
  }

  const keyGroups = scopedDiffs
    .map((componentDiff) => ({ componentDiff, rows: componentDiff.rows.filter(rowVisible) }))
    .filter((group) => group.rows.length > 0);

  const selectedRows = keyGroups.flatMap(({ componentDiff, rows }) =>
    rows
      .filter((row) => selectedRowIds.has(rowId(componentDiff, row)))
      .map((row) => ({ componentDiff, row })),
  );

  function toggleSelected(id: string): void {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(projectComponentId: string): void {
    setOpenComponentIds((current) => {
      const next = new Set(current);
      if (next.has(projectComponentId)) next.delete(projectComponentId);
      else next.add(projectComponentId);
      return next;
    });
  }

  function openComponentKeys(projectComponentId: string): void {
    setComponentFilter(projectComponentId);
    setOpenComponentIds(new Set([projectComponentId]));
    setView('keys');
  }

  // Swap the loaded configs too, so the diff never runs on a half-swapped pair
  // while the (refetch-on-id-change) config loads are in flight.
  function swapEnvironments(): void {
    setEnvAId(envBId);
    setEnvBId(envAId);
    setConfigsA(configsB);
    setConfigsB(configsA);
  }

  async function addKeys(targets: { componentDiff: ComponentDiff; row: CompareRow }[]): Promise<void> {
    setBusy(true);
    const failedKeys: string[] = [];
    // ponytail: sequential, one request per key — fine for the tens of keys a diff usually has.
    for (const { componentDiff, row } of targets) {
      const direction = addTarget(componentDiff, row);
      if (!direction) continue;
      try {
        if (direction === 'a-to-b') await addToEnvironment(componentDiff.configA.id, componentDiff.configB.id, row.key);
        else await addToEnvironment(componentDiff.configB.id, componentDiff.configA.id, row.key);
      } catch (err) {
        failedKeys.push(err instanceof ApiError && targets.length === 1 ? err.message : row.key);
      }
    }
    setBusy(false);
    const addedCount = targets.length - failedKeys.length;
    if (failedKeys.length === 0) showToast(targets.length === 1 ? `"${targets[0].row.key}" added.` : `${addedCount} keys added.`);
    else if (targets.length === 1) showToast(failedKeys[0], 'error');
    else showToast(`Added ${addedCount}; failed: ${failedKeys.join(', ')}.`, 'error');
    runCompare();
  }

  // Client-side CSV of what's currently shown. Secret values are never in
  // the diff response for display anyway; exported as "(secret)".
  function exportDiff(): void {
    const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;
    const exportedValue = (row: CompareRow, value: string | null) => (row.isSecret ? '(secret)' : (value ?? ''));
    const lines = [
      ['Component', 'Key', 'Status', envAName, envBName].map(quote).join(','),
      ...keyGroups.flatMap(({ componentDiff, rows }) =>
        rows.map((row) =>
          [componentDiff.componentName, row.key, statusLabel[row.status], exportedValue(row, row.valueA), exportedValue(row, row.valueB)]
            .map(quote)
            .join(','),
        ),
      ),
    ];
    const downloadUrl = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = `${project?.name ?? 'project'}-${envAName}-vs-${envBName}.csv`;
    downloadLink.click();
    URL.revokeObjectURL(downloadUrl);
  }

  const onlyConnectedInA = configsA.filter((configA) => !configsB.some((configB) => configB.projectComponentId === configA.projectComponentId));
  const onlyConnectedInB = configsB.filter((configB) => !configsA.some((configA) => configA.projectComponentId === configB.projectComponentId));

  if (!project) return <p className="compare-empty">Loading…</p>;

  const statCards: { filter: StatusFilter; label: string; count: number }[] = [
    { filter: 'all', label: 'All keys', count: totalKeys },
    ...STATUSES.map((status) => ({ filter: status, label: statusLabel[status], count: totals[status] })),
  ];

  return (
    <div className="compare-page">
      <div className="compare-header">
        <nav className="compare-breadcrumb" aria-label="Breadcrumb">
          <Link to="/projects">All projects</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/projects/${project.id}`}>{project.name}</Link>
          <span aria-hidden="true">/</span>
          <span>Compare</span>
        </nav>
        <h1>Compare environments</h1>
        <p>See what's missing or set differently between two environments of this project.</p>
      </div>

      {environments.length < 2 ? (
        <p className="compare-empty">This project needs at least two environments to compare.</p>
      ) : (
        <div className="compare-pickers">
          <label>
            <span>Environment A</span>
            <Select
              value={envAId}
              options={environments.map((environment) => ({ value: environment.id, label: environment.name }))}
              onChange={setEnvAId}
            />
          </label>
          <button className="compare-swap" aria-label="Swap environments" title="Swap" onClick={swapEnvironments}>
            <SwapIcon />
          </button>
          <label>
            <span>Environment B</span>
            <Select
              value={envBId}
              options={environments.map((environment) => ({ value: environment.id, label: environment.name }))}
              onChange={setEnvBId}
            />
          </label>
        </div>
      )}

      {loading && !diffs ? (
        <p className="compare-empty">Comparing…</p>
      ) : diffs ? (
        <>
          {onlyConnectedInA.length > 0 && (
            <p className="compare-note">
              Only connected in {envAName}: {onlyConnectedInA.map((config) => config.componentName).join(', ')}
            </p>
          )}
          {onlyConnectedInB.length > 0 && (
            <p className="compare-note">
              Only connected in {envBName}: {onlyConnectedInB.map((config) => config.componentName).join(', ')}
            </p>
          )}

          {diffs.length === 0 ? (
            <p className="compare-empty">No components are connected in both environments.</p>
          ) : (
            <>
              <div className="compare-stats" role="group" aria-label="Filter by status">
                {statCards.map((card) => (
                  <button
                    key={card.filter}
                    className={`compare-stat compare-stat--${card.filter}${statusFilter === card.filter ? ' compare-stat--active' : ''}`}
                    aria-pressed={statusFilter === card.filter}
                    onClick={() => setStatusFilter(card.filter)}
                  >
                    <span className="compare-stat-label">
                      <span className="compare-dot" aria-hidden="true" />
                      {card.label}
                    </span>
                    <span className="compare-stat-count">{card.count}</span>
                  </button>
                ))}
              </div>

              <div className="compare-toolbar">
                <label className="compare-search">
                  <SearchIcon />
                  <input
                    aria-label="Search keys"
                    placeholder="Search keys"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <button
                  className="compare-toggle"
                  aria-pressed={hideMatches}
                  onClick={() => setHideMatches((hidden) => !hidden)}
                >
                  <span className="compare-switch" aria-hidden="true" />
                  Hide matching keys
                </button>
                <div className="compare-toolbar-actions">
                  {selectedRows.length > 0 && (
                    <>
                      <span className="compare-selection-count">{selectedRows.length} selected</span>
                      <button className="compare-primary-btn" disabled={busy} onClick={() => void addKeys(selectedRows)}>
                        {busy ? 'Adding…' : `Add ${selectedRows.length} selected`}
                      </button>
                    </>
                  )}
                  <button className="outline-btn" onClick={exportDiff} disabled={keyGroups.length === 0}>
                    <DownloadIcon /> Export diff
                  </button>
                </div>
              </div>

              <div className="compare-toolbar">
                {diffs.length > 1 && (
                  <div className="compare-component-select">
                    <Select
                      value={activeComponentFilter ?? ''}
                      onChange={(projectComponentId) => setComponentFilter(projectComponentId || null)}
                      options={[
                        { value: '', label: `All components (${diffs.length})` },
                        ...diffs.map((diff) => {
                          const differences = differenceCount(diff.counts);
                          return {
                            value: diff.projectComponentId,
                            label: `${diff.componentName} · ${differences ? `${differences} diff${differences === 1 ? '' : 's'}` : 'in sync'}`,
                          };
                        }),
                      ]}
                      searchable={diffs.length > 8}
                    />
                  </div>
                )}
                {diffs.length > 1 && (
                  <div className="compare-view-switch" role="group" aria-label="View">
                    <button aria-pressed={view === 'components'} onClick={() => setView('components')}>
                      By component
                    </button>
                    <button aria-pressed={view === 'keys'} onClick={() => setView('keys')}>
                      By key
                    </button>
                  </div>
                )}
              </div>

              {view === 'components' ? (
                <div className="compare-card">
                  <div className="compare-summary-row compare-summary-row--head">
                    <span>Component</span>
                    <span>Source</span>
                    <span>Changed</span>
                    <span>Only in {envAName}</span>
                    <span>Only in {envBName}</span>
                    <span>Match</span>
                    <span />
                  </div>
                  {scopedDiffs.map((diff) => (
                    <div key={diff.projectComponentId} className="compare-summary-row">
                      <span className="compare-summary-name">{diff.componentName}</span>
                      <span className="compare-muted">
                        {diff.configA.sourceType === diff.configB.sourceType
                          ? diff.configA.sourceType
                          : `${diff.configA.sourceType} / ${diff.configB.sourceType}`}
                      </span>
                      {STATUSES.map((status) => (
                        <span
                          key={status}
                          className={`compare-summary-count compare-summary-count--${status}${diff.counts[status] ? '' : ' compare-summary-count--zero'}`}
                          data-label={statusLabel[status]}
                        >
                          {diff.counts[status]}
                        </span>
                      ))}
                      <span className="compare-summary-action">
                        <button className="outline-btn outline-btn--small" onClick={() => openComponentKeys(diff.projectComponentId)}>
                          View keys <ChevronRightIcon />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : keyGroups.length === 0 ? (
                <p className="compare-empty">No keys match these filters.</p>
              ) : (
                <div className="compare-card">
                  <div className="compare-key-row compare-key-row--head">
                    <span />
                    <span>Key</span>
                    <span className="compare-status-column">Status</span>
                    <span>{envAName}</span>
                    <span>{envBName}</span>
                    <span className="compare-align-right">Action</span>
                  </div>
                  {keyGroups.map(({ componentDiff, rows }) => {
                    const groupOpen = searching || openComponentIds.has(componentDiff.projectComponentId);
                    const counts = countByStatus(rows);
                    return (
                      <div key={componentDiff.projectComponentId}>
                        <button
                          className="compare-group-toggle"
                          aria-expanded={groupOpen}
                          onClick={() => toggleGroup(componentDiff.projectComponentId)}
                        >
                          <ChevronIcon open={groupOpen} />
                          <span className="compare-group-name">{componentDiff.componentName}</span>
                          <span className="compare-group-summary">
                            {counts.changed} changed · {counts.onlyA + counts.onlyB} missing
                          </span>
                          <span className="compare-group-hint">{groupOpen ? 'Collapse' : 'Expand'}</span>
                        </button>
                        {groupOpen &&
                          rows.map((row) => {
                            const id = rowId(componentDiff, row);
                            const direction = addTarget(componentDiff, row);
                            const selected = selectedRowIds.has(id);
                            return (
                              <div
                                key={id}
                                className={`compare-key-row compare-key-row--${row.status}${selected ? ' compare-key-row--selected' : ''}`}
                              >
                                <span className="compare-check">
                                  {direction && (
                                    <input
                                      type="checkbox"
                                      aria-label={`Select ${row.key}`}
                                      checked={selected}
                                      onChange={() => toggleSelected(id)}
                                    />
                                  )}
                                </span>
                                <span className="compare-key">
                                  <span className="compare-key-name">
                                    {row.isSecret && (
                                      <span className="compare-lock" title="Secret">
                                        <LockIcon />
                                      </span>
                                    )}
                                    {row.key}
                                  </span>
                                  {/* Tablet/phone: status sits under the key instead of its own column. */}
                                  <StatusPill status={row.status} label={statusLabel[row.status]} inline />
                                </span>
                                <span className="compare-status-column">
                                  <StatusPill status={row.status} label={statusLabel[row.status]} />
                                </span>
                                <span className="compare-value-cell">
                                  <span className="compare-value-label">{envAName}</span>
                                  <CompareValue row={row} value={row.valueA} other={row.valueB} />
                                </span>
                                <span className="compare-value-cell">
                                  <span className="compare-value-label">{envBName}</span>
                                  <CompareValue row={row} value={row.valueB} other={row.valueA} />
                                </span>
                                <span className="compare-align-right">
                                  {direction && (
                                    <button
                                      className={`compare-add-btn compare-add-btn--${row.status}`}
                                      disabled={busy}
                                      onClick={() => void addKeys([{ componentDiff, row }])}
                                    >
                                      {direction === 'a-to-b' ? `Add to ${envBName} →` : `← Add to ${envAName}`}
                                    </button>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function StatusPill({ status, label, inline = false }: { status: RowStatus; label: string; inline?: boolean }) {
  return <span className={`compare-pill compare-pill--${status}${inline ? ' compare-pill--inline' : ''}`}>{label}</span>;
}

// Changed values highlight where they start to differ (after the shared
// prefix), so "gen-kap-uat-…" vs "gen-kap-preprod-…" reads at a glance.
function CompareValue({ row, value, other }: { row: CompareRow; value: string | null; other: string | null }) {
  if (row.isSecret) {
    return (
      <span className="compare-secret">
        •••• {row.status === 'match' ? 'Secret · same value' : row.status === 'changed' ? 'Secret · differs' : 'Secret'}
      </span>
    );
  }
  if (value === null) return <span className="compare-not-set">Not set</span>;
  if (value === '') return <span className="compare-not-set">empty</span>;
  if (row.status !== 'changed' || other === null) return <span className="compare-value">{value}</span>;
  let sharedLength = 0;
  while (sharedLength < value.length && sharedLength < other.length && value[sharedLength] === other[sharedLength]) {
    sharedLength += 1;
  }
  return (
    <span className="compare-value">
      {value.slice(0, sharedLength)}
      <mark className="compare-diff-mark">{value.slice(sharedLength)}</mark>
    </span>
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

function SwapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v12M7 11l5 5 5-5M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
