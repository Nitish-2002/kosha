import { Injectable, NotFoundException } from '@nestjs/common';
import { EnvironmentComponentConfigsRepository } from '../environments/environment-component-configs.repository';
import { EnvironmentComponentConfig } from '../environments/environment-component-config.entity';
import {
  VariablesService,
  type VariableSummary,
} from '../variables/variables.service';
import { RequestUser } from '../auth/jwt-payload.interface';

export interface DiffEntry {
  key: string;
  value: string | null;
  isSecret: boolean;
}

export interface DiffDifferingEntry {
  key: string;
  fromValue: string | null;
  toValue: string | null;
  isSecret: boolean;
}

export interface DiffResult {
  onlyInFrom: DiffEntry[];
  onlyInTo: DiffEntry[];
  differing: DiffDifferingEntry[];
  matching: DiffEntry[];
}

// Deliberately thin: VariablesService.list() already does everything a diff
// needs on each side — environment/component scoping (PRD "scoped (both
// sides)"), Secret masking per role, and GitHub vs S3 handling — so this
// just calls it twice and compares. Masked values compare equal to each
// other (both null), so a Member can't tell two Secrets differ; an Admin
// sees the real values and a real diff.
@Injectable()
export class DiffService {
  constructor(
    private readonly configsRepository: EnvironmentComponentConfigsRepository,
    private readonly variablesService: VariablesService,
  ) {}

  async diff(
    fromConfigId: string,
    toConfigId: string,
    requester: RequestUser,
  ): Promise<DiffResult> {
    const [fromEntries, toEntries] = await Promise.all([
      this.listFor(fromConfigId, requester),
      this.listFor(toConfigId, requester),
    ]);
    const toByKey = new Map(toEntries.map((e) => [e.key, e]));
    const fromByKey = new Map(fromEntries.map((e) => [e.key, e]));

    const onlyInFrom = fromEntries.filter((e) => !toByKey.has(e.key));
    const onlyInTo = toEntries.filter((e) => !fromByKey.has(e.key));
    const differing = fromEntries
      .filter((e) => {
        const other = toByKey.get(e.key);
        return other !== undefined && other.value !== e.value;
      })
      .map((e) => {
        const other = toByKey.get(e.key)!;
        return {
          key: e.key,
          fromValue: e.value,
          toValue: other.value,
          isSecret: e.isSecret || other.isSecret,
        };
      });
    // Present on both sides with the same value — the full compare view
    // shows these too (not just the discrepancies), so a key's whole story
    // ("do these two environments actually agree?") is visible in one place.
    const matching = fromEntries
      .filter((e) => {
        const other = toByKey.get(e.key);
        return other !== undefined && other.value === e.value;
      })
      .map((e) => ({
        key: e.key,
        value: e.value,
        isSecret: e.isSecret || toByKey.get(e.key)!.isSecret,
      }));

    return { onlyInFrom, onlyInTo, differing, matching };
  }

  // Copies one key from the "from" side to the "to" side. Reuses
  // VariablesService.create() wholesale — that already enforces the target
  // must be S3-sourced (403 read_only_source otherwise, same as every other
  // Variables write), scopes the write to the requester's assignments, and
  // forces isSecret=false unless the requester is an Admin (CLAUDE.md #8) —
  // a Member copying a Secret key here still can't grant it Secret status,
  // same as if they'd typed it in by hand.
  async addToEnvironment(
    fromConfigId: string,
    toConfigId: string,
    key: string,
    requester: RequestUser,
  ): Promise<void> {
    const fromEntries = await this.listFor(fromConfigId, requester);
    const entry = fromEntries.find((e) => e.key === key);
    if (!entry) {
      throw new NotFoundException(`"${key}" was not found on the source side.`);
    }
    const toConfig = await this.findConfigOrFail(toConfigId);
    await this.variablesService.create(
      toConfig.environmentId,
      toConfigId,
      // Secret values are never fetched for this — only the key name
      // crosses over, matching the PRD's "just the key name (Secret)".
      {
        key,
        value: entry.isSecret ? '' : (entry.value ?? ''),
        isSecret: entry.isSecret,
      },
      requester,
    );
  }

  private async listFor(
    configId: string,
    requester: RequestUser,
  ): Promise<VariableSummary[]> {
    const config = await this.findConfigOrFail(configId);
    return this.variablesService.list(
      config.environmentId,
      configId,
      requester,
    );
  }

  private async findConfigOrFail(
    configId: string,
  ): Promise<EnvironmentComponentConfig> {
    const config = await this.configsRepository.findById(configId);
    if (!config) {
      throw new NotFoundException();
    }
    return config;
  }
}
