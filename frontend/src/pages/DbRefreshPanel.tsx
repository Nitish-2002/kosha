import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  previewDbRefresh,
  recordDbRefresh,
  type DbScriptEnvironment,
  type DbScriptStatus,
  type RefreshPlanRow,
  type RefreshRule,
} from '../api/db-scripts';
import { DatePicker } from '../components/DatePicker';
import { Select } from '../components/Select';
import { useRevealOnOpen } from '../lib/useRevealOnOpen';

const STATUS_LABEL: Record<DbScriptStatus, string> = {
  applied: 'Applied',
  pending: 'Pending',
  not_applicable: 'N/A',
};

const RULE_LABEL: Record<RefreshRule, string> = {
  in_source: 'Stays applied — the dump has it',
  not_in_source: 'Run it — the dump doesn’t have it',
  rerun_after_restore: 'Run it — re-runs after every restore',
  not_applicable: 'N/A here',
};

function todayIsoDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// Admin-only "Record DB refresh" (PRD Feature 12): an environment's database
// was restored from another environment's dump. Shows what happens to every
// script before anything is saved.
export function DbRefreshPanel({
  projectId,
  environments,
  onCancel,
  onRecorded,
}: {
  projectId: string;
  environments: DbScriptEnvironment[];
  onCancel: () => void;
  onRecorded: (targetEnvironmentId: string, plan: RefreshPlanRow[]) => void;
}) {
  const [sourceEnvironmentId, setSourceEnvironmentId] = useState('');
  const [targetEnvironmentId, setTargetEnvironmentId] = useState('');
  const [dumpTakenOn, setDumpTakenOn] = useState(todayIsoDate());
  const [plan, setPlan] = useState<RefreshPlanRow[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRevealOnOpen<HTMLFormElement>();
  const [error, setError] = useState<string | null>(null);

  const bothPicked = sourceEnvironmentId !== '' && targetEnvironmentId !== '';
  const sameEnvironment = bothPicked && sourceEnvironmentId === targetEnvironmentId;
  const sourceName = environments.find((environment) => environment.id === sourceEnvironmentId)?.name ?? '';
  const targetName = environments.find((environment) => environment.id === targetEnvironmentId)?.name ?? '';

  useEffect(() => {
    if (!bothPicked || sameEnvironment) return;
    let current = true;
    previewDbRefresh(projectId, sourceEnvironmentId, targetEnvironmentId)
      .then((previewRows) => current && setPlan(previewRows))
      .catch((err) => current && setError(err instanceof ApiError ? err.message : 'Could not preview that refresh.'));
    return () => {
      current = false;
    };
  }, [projectId, sourceEnvironmentId, targetEnvironmentId, bothPicked, sameEnvironment]);

  function pickEnvironment(setter: (value: string) => void, value: string): void {
    setter(value);
    setPlan(null);
    setError(null);
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onRecorded(targetEnvironmentId, await recordDbRefresh(projectId, { sourceEnvironmentId, targetEnvironmentId, dumpTakenOn }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that refresh.');
      setSubmitting(false);
    }
  }

  const environmentOptions = environments.map((environment) => ({ value: environment.id, label: environment.name }));
  const toRunCount = plan?.filter((row) => row.resultStatus === 'pending').length ?? 0;
  const changedCount = plan?.filter((row) => row.resultStatus !== row.currentStatus).length ?? 0;

  return (
    <form ref={formRef} className="variables-form db-refresh-panel" onSubmit={(event) => void handleSubmit(event)}>
      <div className="db-refresh-panel-heading">
        <h3>Record DB refresh</h3>
        <p>
          Use this after restoring an environment's database from another environment's dump. Kosha sets its script
          states to match the dump, and tells you which scripts to run.
        </p>
      </div>

      <div className="db-refresh-fields">
        <label>
          Dump taken from
          <Select
            value={sourceEnvironmentId}
            options={environmentOptions}
            placeholder="Pick environment"
            onChange={(value) => pickEnvironment(setSourceEnvironmentId, value)}
          />
        </label>
        <label>
          Restored into
          <Select
            value={targetEnvironmentId}
            options={environmentOptions}
            placeholder="Pick environment"
            onChange={(value) => pickEnvironment(setTargetEnvironmentId, value)}
          />
        </label>
        <label>
          Dump taken on
          <DatePicker value={dumpTakenOn} onChange={setDumpTakenOn} maxDate={todayIsoDate()} />
        </label>
      </div>

      {sameEnvironment && <p className="variables-error">Pick two different environments.</p>}

      {plan && (
        <>
          {plan.length === 0 ? (
            <p className="db-script-form-hint">This project has no DB scripts yet, so nothing changes.</p>
          ) : (
            <div className="table-card">
              <div className="table-scroll">
                <table className="db-refresh-table">
                  <thead>
                    <tr>
                      <th scope="col">Script</th>
                      <th scope="col">{targetName} now</th>
                      <th scope="col">{sourceName} (dump)</th>
                      <th scope="col">{targetName} after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((row) => (
                      <tr key={row.scriptId}>
                        <th scope="row" className="db-scripts-name">
                          {row.label}
                        </th>
                        <td>{STATUS_LABEL[row.currentStatus]}</td>
                        <td>{STATUS_LABEL[row.sourceStatus]}</td>
                        <td className={row.resultStatus === 'pending' ? 'db-refresh-to-run' : undefined}>
                          {RULE_LABEL[row.rule]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="db-refresh-summary">
            {toRunCount === 0
              ? `Nothing to run on ${targetName} afterwards.`
              : `${toRunCount} script${toRunCount === 1 ? '' : 's'} to run on ${targetName} afterwards.`}{' '}
            {changedCount} state{changedCount === 1 ? '' : 's'} change. This is recorded in the audit log.
          </p>
        </>
      )}

      {error && <p className="variables-error">{error}</p>}
      <div className="variables-form-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="project-detail-add-btn" disabled={submitting || !plan || !dumpTakenOn}>
          {submitting ? 'Recording…' : 'Record refresh'}
        </button>
      </div>
    </form>
  );
}
