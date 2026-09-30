import { useState } from 'react';
import { ApiError } from '../api/client';
import type { CredentialSummary } from '../api/credentials';
import {
  bulkEditGithub,
  checkGithubBulkEdit,
  type ComponentConfigSummary,
  type GithubBulkEditCheckRow,
  type GithubBulkEditInput,
} from '../api/environments';
import { Select } from '../components/Select';
import { useToast } from '../context/useToast';
import { parseGithubRepoUrl } from '../lib/githubUrl';
import { useRevealOnOpen } from '../lib/useRevealOnOpen';

const STATUS_LABEL: Record<GithubBulkEditCheckRow['status'], string> = {
  found: '✓ Found',
  'not-found': 'File not found',
  unreachable: 'Repo/branch unreachable',
};

// Admin: change repo / branch / credential on several GitHub connections of
// one environment at once — e.g. every component moving develop → release.
// Each connection keeps its own file paths; only the fields filled in change.
export function GithubBulkEditForm({
  environmentId,
  configs,
  credentials,
  onCancel,
  onSaved,
}: {
  environmentId: string;
  configs: ComponentConfigSummary[];
  credentials: CredentialSummary[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const githubConfigs = configs.filter((config) => config.sourceType === 'github');
  const githubCredentials = credentials.filter((credential) => credential.type === 'github');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(githubConfigs.map((config) => config.id)));
  const [repoInput, setRepoInput] = useState('');
  const [branch, setBranch] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [checkRows, setCheckRows] = useState<GithubBulkEditCheckRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRevealOnOpen<HTMLDivElement>();

  // "org/repo" typed, or a pasted github.com URL.
  const repo = parseGithubRepoUrl(repoInput)?.repo ?? repoInput.trim();
  const input: GithubBulkEditInput = {
    configIds: [...selectedIds],
    ...(repo && { githubRepo: repo }),
    ...(branch.trim() && { githubBranch: branch.trim() }),
    ...(credentialId && { githubCredentialId: credentialId }),
  };
  const somethingToChange = !!(input.githubRepo || input.githubBranch || input.githubCredentialId);
  const credentialLabel = (id: string | null) =>
    githubCredentials.find((credential) => credential.id === id)?.label ?? 'Unknown credential';

  // Any change invalidates the check — it's only true for the exact values it ran with.
  function edit<T>(setter: (value: T) => void, value: T): void {
    setter(value);
    setCheckRows(null);
    setError(null);
  }

  function toggle(configId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(configId)) next.delete(configId);
      else next.add(configId);
      return next;
    });
    setCheckRows(null);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const problemCount = checkRows?.filter((row) => row.status !== 'found').length ?? 0;

  return (
    <div ref={formRef} className="add-config-form github-bulk-edit">
      <div>
        <h3>Edit GitHub connections</h3>
        <p className="add-config-hint">
          Change the repo, branch or credential for several components at once. Leave a field empty to keep what each
          one has. Each component keeps its own file path.
        </p>
      </div>

      <fieldset className="github-bulk-edit-targets">
        <legend>Components to change ({selectedIds.size} of {githubConfigs.length})</legend>
        {githubConfigs.map((config) => (
          <label key={config.id} className="variables-checkbox">
            <input type="checkbox" checked={selectedIds.has(config.id)} onChange={() => toggle(config.id)} />
            <span className="github-bulk-edit-name">{config.componentName}</span>
            <span className="github-bulk-edit-current">
              {config.githubRepo} @ {config.githubBranch} · {credentialLabel(config.githubCredentialId)}
            </span>
          </label>
        ))}
      </fieldset>

      <label>
        New repo
        <input
          value={repoInput}
          onChange={(event) => edit(setRepoInput, event.target.value)}
          placeholder="Keep current — or org/repo, or a github.com URL"
        />
      </label>
      <label>
        New branch
        <input value={branch} onChange={(event) => edit(setBranch, event.target.value)} placeholder="Keep current — e.g. release/2.4" />
      </label>
      <label>
        New credential
        <Select
          value={credentialId}
          onChange={(value) => edit(setCredentialId, value)}
          options={[
            { value: '', label: 'Keep current' },
            ...githubCredentials.map((credential) => ({ value: credential.id, label: credential.label })),
          ]}
        />
      </label>

      {checkRows && (
        <div className="table-scroll table-card">
          <table className="variables-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Will read from</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {checkRows.map((row) => (
                <tr key={row.configId}>
                  <td>{row.componentName}</td>
                  <td>
                    {row.githubRepo} @ {row.githubBranch}
                    <br />
                    <span className="github-bulk-edit-current">{row.paths.join(', ') || 'no file path set'}</span>
                  </td>
                  <td className={row.status === 'found' ? undefined : 'project-detail-error'}>
                    {STATUS_LABEL[row.status]}
                    {row.message && <span className="github-bulk-edit-current"> — {row.message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {checkRows && problemCount > 0 && (
        <p className="project-detail-error">
          {problemCount} component{problemCount === 1 ? '' : 's'} won't find {problemCount === 1 ? 'its' : 'their'} file
          with these values. You can still save, but untick {problemCount === 1 ? 'it' : 'them'} unless that's expected.
        </p>
      )}

      {error && <p className="project-detail-error">{error}</p>}
      <div className="project-detail-header-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {!checkRows ? (
          <button
            type="button"
            className="project-detail-add-btn"
            disabled={busy || selectedIds.size === 0 || !somethingToChange}
            onClick={() => void run(async () => setCheckRows(await checkGithubBulkEdit(environmentId, input)))}
          >
            {busy ? 'Checking…' : 'Check'}
          </button>
        ) : (
          <button
            type="button"
            className="project-detail-add-btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const saved = await bulkEditGithub(environmentId, input);
                showToast(`Updated ${saved.length} GitHub connection${saved.length === 1 ? '' : 's'}.`);
                onSaved();
              })
            }
          >
            {busy ? 'Saving…' : `Save ${selectedIds.size}`}
          </button>
        )}
      </div>
    </div>
  );
}
