import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { loadAll as loadYamlAll, YAMLException } from 'js-yaml';
import { CryptoService } from '../credentials/crypto.service';
import { Credential } from '../credentials/credential.entity';
import { EnvironmentComponentConfig } from '../environments/environment-component-config.entity';

export interface GithubVariableEntry {
  key: string;
  value: string | null;
  isSecret: boolean;
}

// One file can hold several kinds mixed together (a combined per-service
// Helm template: ServiceAccount + SecretProviderClass + ConfigMap +
// Deployment + ...), so a manifest is read as a list of documents, not one
// object — the ConfigMap/Secret path may point at the very same file the
// other one does, and only the relevant kind(s) are picked out of it.
interface ManifestDoc {
  kind?: string;
  data?: Record<string, string>;
  stringData?: Record<string, string>;
  spec?: {
    // AWS Secrets Store CSI driver's SecretProviderClass — this project's
    // stand-in for a plain K8s Secret. objectName is the closest thing it
    // has to a stable key name; the real container-facing env var name is
    // only decided in the Deployment's own env[].secretKeyRef, which this
    // service doesn't parse (that's Helm-rendering territory, out of scope).
    secretObjects?: Array<{ data?: Array<{ objectName?: string }> }>;
  };
}

// Makes a Helm chart template parseable as YAML: a line that's nothing but
// template expressions (control flow, `$var := ...` assignments, comments,
// include/toYaml injections) carries no literal key Kosha could read, so
// it's dropped entirely; a remaining inline
// value substitution (e.g. "name: {{ $appvalue.foo }}") is swapped for a
// harmless placeholder so the surrounding line still parses. The goal is
// reading key *names*, not resolving what the template would render to —
// Secret values are never fetched regardless (see class comment below).
// Known limitation: a "{{ }}" that spans multiple lines isn't handled.
export function stripHelmTemplating(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\{\{.*\}\}$/.test(line.trim()) ? '' : line))
    .join('\n')
    .replace(/\{\{-?[\s\S]*?-?\}\}/g, '__HELM_VALUE__');
}

// GitHub is read-only by design (PRD Feature 8): this service only ever
// issues GET requests, and a Secret manifest's values are never fetched at
// all — only its key names, structurally, not by a flag anyone can toggle.
@Injectable()
export class GithubManifestService {
  constructor(private readonly crypto: CryptoService) {}

  async listVariables(
    config: EnvironmentComponentConfig,
    credential: Credential,
  ): Promise<GithubVariableEntry[]> {
    const pat = this.patOf(credential);
    const [configMapDocs, secretDocs] = await Promise.all([
      this.fetchManifestDocs(
        config.githubRepo!,
        config.githubBranch!,
        config.githubConfigmapPath,
        pat,
      ),
      this.fetchManifestDocs(
        config.githubRepo!,
        config.githubBranch!,
        config.githubSecretPath,
        pat,
      ),
    ]);

    // Map, so a key repeated across ConfigMap docs keeps the last value.
    const configMapValues = new Map<string, string>();
    for (const doc of configMapDocs) {
      if (doc.kind !== 'ConfigMap') continue;
      for (const [key, value] of Object.entries({
        ...(doc.data ?? {}),
        ...(doc.stringData ?? {}),
      })) {
        configMapValues.set(key, value);
      }
    }
    const configMapEntries: GithubVariableEntry[] = [...configMapValues].map(
      ([key, value]) => ({ key, value, isSecret: false }),
    );

    // Values are never read off a Secret-bearing document — only key names
    // are ever collected, never doc.data's/stringData's values themselves.
    const secretKeys = new Set<string>();
    for (const doc of secretDocs) {
      if (doc.kind === 'Secret') {
        for (const key of [
          ...Object.keys(doc.data ?? {}),
          ...Object.keys(doc.stringData ?? {}),
        ]) {
          secretKeys.add(key);
        }
      } else if (doc.kind === 'SecretProviderClass') {
        for (const secretObject of doc.spec?.secretObjects ?? []) {
          for (const item of secretObject.data ?? []) {
            if (item.objectName) secretKeys.add(item.objectName);
          }
        }
      }
    }
    const secretEntries: GithubVariableEntry[] = [...secretKeys].map((key) => ({
      key,
      value: null,
      isSecret: true,
    }));

    return [...configMapEntries, ...secretEntries];
  }

  private async fetchManifestDocs(
    repo: string,
    branch: string,
    path: string | null,
    pat: string,
  ): Promise<ManifestDoc[]> {
    if (!path) return [];
    const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github.raw+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch {
      throw new BadGatewayException('Could not reach GitHub.');
    }
    if (response.status === 404) {
      throw new NotFoundException(`${path} not found in ${repo}@${branch}.`);
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `GitHub returned ${response.status} for ${path}.`,
      );
    }
    const text = await response.text();
    try {
      const docs: ManifestDoc[] = [];
      // json: duplicate keys resolve to the last one instead of throwing —
      // stripping {{ if }}/{{ else }} leaves both branches' copies of a key.
      loadYamlAll(
        stripHelmTemplating(text),
        (doc) => {
          if (doc && typeof doc === 'object') docs.push(doc);
        },
        { json: true },
      );
      return docs;
    } catch (error) {
      // Reason + line only — never js-yaml's full message, which quotes the
      // surrounding file text and could put a Secret value in front of a Member.
      const detail =
        error instanceof YAMLException
          ? ` (${error.reason}${error.mark ? ` near line ${error.mark.line + 1}` : ''})`
          : '';
      throw new BadRequestException(
        `Could not parse "${path}" in ${repo}@${branch} as YAML, even after stripping Helm "{{ }}" templating${detail}. This chart's structure isn't supported yet.`,
      );
    }
  }

  private patOf(credential: Credential): string {
    const secret = JSON.parse(
      this.crypto.decrypt(credential.encryptedSecret),
    ) as {
      pat: string;
    };
    return secret.pat;
  }
}
