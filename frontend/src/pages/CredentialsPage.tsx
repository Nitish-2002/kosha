import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useToast } from '../context/useToast';
import { ApiError } from '../api/client';
import {
  createCredential,
  deleteCredential,
  listCredentials,
  updateCredential,
  type CredentialSummary,
  type CredentialType,
} from '../api/credentials';
import { Select } from '../components/Select';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CREDENTIAL_TYPE_OPTIONS } from '../constants';
import { formatTimestamp } from '../lib/formatDate';
import './CredentialsPage.scss';

type FormState = { mode: 'create' } | { mode: 'rotate'; credential: CredentialSummary } | null;

export function CredentialsPage() {
  const { showToast } = useToast();
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<CredentialSummary | null>(null);

  function refresh(): void {
    listCredentials()
      .then(setCredentials)
      .catch(() => setError('Could not load credentials.'))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  const visibleCredentials = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return credentials;
    return credentials.filter(
      (credential) => credential.label.toLowerCase().includes(query) || credential.type.includes(query),
    );
  }, [credentials, search]);

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    try {
      await deleteCredential(pendingDelete.id);
      showToast(`"${pendingDelete.label}" deleted.`);
      setPendingDelete(null);
      refresh();
    } catch {
      showToast('Could not delete that credential.', 'error');
      setPendingDelete(null);
    }
  }

  return (
    <div className="credentials-page">
      <div className="credentials-header">
        <div>
          <h1>Credentials</h1>
          <p>AWS access keys and GitHub PATs used by environment connections. Only Admins can see this page.</p>
        </div>
        <button className="credentials-add-btn" onClick={() => setForm(form ? null : { mode: 'create' })}>
          {form?.mode === 'create' ? 'Close' : '+ Add credential'}
        </button>
      </div>

      {error && <p className="credentials-error">{error}</p>}

      {form && (
        <CredentialForm
          key={form.mode === 'rotate' ? form.credential.id : 'create'}
          state={form}
          onCancel={() => setForm(null)}
          onSaved={(message) => {
            showToast(message);
            refresh();
            // Rotating closes (nothing more to do); adding stays open so
            // several credentials can be entered back-to-back.
            if (form.mode === 'rotate') {
              setForm(null);
            }
          }}
        />
      )}

      {credentials.length > 0 && (
        <input
          className="credentials-search"
          placeholder="Search by label or type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      <div className="credentials-table-wrap">
        {loading ? (
          <p className="credentials-empty">Loading…</p>
        ) : visibleCredentials.length === 0 ? (
          <p className="credentials-empty">
            {credentials.length === 0 ? 'No credentials yet. Add one to get started.' : 'No credentials match your search.'}
          </p>
        ) : (
          <table className="credentials-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleCredentials.map((credential) => (
                <tr key={credential.id}>
                  <td>{credential.label}</td>
                  <td>
                    <span className={`credentials-badge credentials-badge--${credential.type}`}>{credential.type}</span>
                  </td>
                  <td>{formatTimestamp(credential.updatedAt)}</td>
                  <td className="credentials-actions">
                    <button onClick={() => setForm({ mode: 'rotate', credential })}>Rotate</button>
                    <button className="credentials-delete-btn" onClick={() => setPendingDelete(credential)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete credential?"
          message={`"${pendingDelete.label}" will be permanently deleted. This can't be undone.`}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function CredentialForm({
  state,
  onCancel,
  onSaved,
}: {
  state: { mode: 'create' } | { mode: 'rotate'; credential: CredentialSummary };
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const isRotate = state.mode === 'rotate';
  const [type, setType] = useState<CredentialType>(isRotate ? state.credential.type : 'aws');
  const [label, setLabel] = useState(isRotate ? state.credential.label : '');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [username, setUsername] = useState('');
  const [pat, setPat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function resetSecretFields(): void {
    setAccessKeyId('');
    setSecretAccessKey('');
    setUsername('');
    setPat('');
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      if (isRotate) {
        await updateCredential(state.credential.id, {
          label: label !== state.credential.label ? label : undefined,
          accessKeyId: accessKeyId || undefined,
          secretAccessKey: secretAccessKey || undefined,
          username: username || undefined,
          pat: pat || undefined,
        });
        onSaved(`"${label}" updated.`);
      } else {
        await createCredential({
          type,
          label,
          accessKeyId: type === 'aws' ? accessKeyId : undefined,
          secretAccessKey: type === 'aws' ? secretAccessKey : undefined,
          username: type === 'github' ? username : undefined,
          pat: type === 'github' ? pat : undefined,
        });
        onSaved(`"${label}" added.`);
        setLabel('');
        resetSecretFields();
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="credentials-form" onSubmit={(e) => void handleSubmit(e)}>
      <h2>{isRotate ? `Rotate "${state.credential.label}"` : 'Add credential'}</h2>

      {!isRotate && (
        <label>
          Type
          <Select
            value={type}
            options={CREDENTIAL_TYPE_OPTIONS}
            onChange={(value) => {
              setType(value as CredentialType);
              resetSecretFields();
            }}
          />
        </label>
      )}

      <label>
        Label
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Client X prod" required />
      </label>

      {type === 'aws' ? (
        <>
          <label>
            Access key ID
            <input
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              placeholder={isRotate ? 'Leave blank to keep current' : ''}
              required={!isRotate}
            />
          </label>
          <label>
            Secret access key
            <input
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              placeholder={isRotate ? 'Leave blank to keep current' : ''}
              required={!isRotate}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isRotate ? 'Leave blank to keep current' : 'e.g. octocat'}
              required={!isRotate}
            />
          </label>
          <label>
            Personal access token
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder={isRotate ? 'Leave blank to keep current' : ''}
              required={!isRotate}
            />
          </label>
        </>
      )}

      {formError && <p className="credentials-error">{formError}</p>}

      <div className="credentials-form-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="credentials-add-btn" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
