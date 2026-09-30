import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { DbScript } from './db-script.entity';
import { DbScriptState, DbScriptStatus } from './db-script-state.entity';
import { DbRefresh } from './db-refresh.entity';

// User is registered locally for the email lookup, same pattern as
// audit/user-lookup.repository.ts (avoids importing UsersModule).
@Injectable()
export class DbScriptsRepository {
  constructor(
    @InjectRepository(DbScript)
    private readonly scripts: Repository<DbScript>,
    @InjectRepository(DbScriptState)
    private readonly states: Repository<DbScriptState>,
    @InjectRepository(DbRefresh)
    private readonly refreshes: Repository<DbRefresh>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findByProject(projectId: string): Promise<DbScript[]> {
    return this.scripts.find({
      where: { projectId },
      order: { sequence: 'ASC' },
    });
  }

  findById(id: string): Promise<DbScript | null> {
    return this.scripts.findOneBy({ id });
  }

  findInProject(id: string, projectId: string): Promise<DbScript | null> {
    return this.scripts.findOneBy({ id, projectId });
  }

  // excludeId: the script being edited doesn't clash with itself.
  findByName(
    projectId: string,
    name: string,
    excludeId?: string,
  ): Promise<DbScript | null> {
    return this.scripts.findOneBy({
      projectId,
      name,
      ...(excludeId && { id: Not(excludeId) }),
    });
  }

  findByFingerprint(
    projectId: string,
    sqlFingerprint: string,
    excludeId?: string,
  ): Promise<DbScript | null> {
    return this.scripts.findOneBy({
      projectId,
      sqlFingerprint,
      ...(excludeId && { id: Not(excludeId) }),
    });
  }

  async nextSequence(projectId: string): Promise<number> {
    const highest = await this.scripts.maximum('sequence', { projectId });
    return (highest ?? 0) + 1;
  }

  statesForScripts(scriptIds: string[]): Promise<DbScriptState[]> {
    if (scriptIds.length === 0) return Promise.resolve([]);
    return this.states.findBy({ scriptId: In(scriptIds) });
  }

  // Script + its per-environment rows in one transaction, so a script never
  // exists without the N/A choices its author made.
  async createWithStates(
    fields: Omit<DbScript, 'id' | 'createdAt' | 'updatedAt'>,
    initialStates: { environmentId: string; status: DbScriptStatus }[],
  ): Promise<DbScript> {
    return this.scripts.manager.transaction(async (manager) => {
      const saved = await manager.save(
        DbScript,
        manager.create(DbScript, fields),
      );
      if (initialStates.length > 0) {
        await manager.insert(
          DbScriptState,
          initialStates.map((state) => ({ ...state, scriptId: saved.id })),
        );
      }
      return saved;
    });
  }

  save(script: DbScript): Promise<DbScript> {
    return this.scripts.save(script);
  }

  // Sets pending/not_applicable (clearing who/when) — also how an applied
  // mark is undone. Marking applied goes through markApplied.
  async setApplicability(
    scriptId: string,
    changes: { environmentId: string; status: 'pending' | 'not_applicable' }[],
  ): Promise<void> {
    if (changes.length === 0) return;
    await this.states.upsert(
      changes.map((change) => ({
        scriptId,
        environmentId: change.environmentId,
        status: change.status,
        appliedBy: null,
        appliedAt: null,
        refreshId: null,
      })),
      ['scriptId', 'environmentId'],
    );
  }

  async markApplied(
    scriptId: string,
    environmentId: string,
    userId: string,
  ): Promise<void> {
    await this.states.upsert(
      {
        scriptId,
        environmentId,
        status: 'applied',
        appliedBy: userId,
        appliedAt: new Date(),
        refreshId: null,
      },
      ['scriptId', 'environmentId'],
    );
  }

  // The refresh row and the restored environment's new states in one
  // transaction, so a failure part-way never leaves half an environment
  // reset.
  async recordRefresh(
    fields: Omit<DbRefresh, 'id' | 'createdAt'>,
    newStates: Omit<DbScriptState, 'id' | 'refreshId' | 'environmentId'>[],
  ): Promise<DbRefresh> {
    return this.refreshes.manager.transaction(async (manager) => {
      const saved = await manager.save(
        DbRefresh,
        manager.create(DbRefresh, fields),
      );
      if (newStates.length > 0) {
        await manager.upsert(
          DbScriptState,
          newStates.map((state) => ({
            ...state,
            environmentId: fields.targetEnvironmentId,
            refreshId: state.status === 'applied' ? saved.id : null,
          })),
          ['scriptId', 'environmentId'],
        );
      }
      return saved;
    });
  }

  findRefreshesByIds(ids: string[]): Promise<DbRefresh[]> {
    return ids.length
      ? this.refreshes.findBy({ id: In(ids) })
      : Promise.resolve([]);
  }

  // Latest restore per environment, for the column header note.
  // ponytail: loads every refresh of these environments and keeps the
  // newest in memory; DISTINCT ON if refresh history ever gets long.
  async latestRefreshByEnvironment(
    environmentIds: string[],
  ): Promise<Map<string, DbRefresh>> {
    if (environmentIds.length === 0) return new Map();
    const rows = await this.refreshes.find({
      where: { targetEnvironmentId: In(environmentIds) },
      order: { createdAt: 'DESC' },
    });
    const latest = new Map<string, DbRefresh>();
    for (const row of rows) {
      if (!latest.has(row.targetEnvironmentId)) {
        latest.set(row.targetEnvironmentId, row);
      }
    }
    return latest;
  }

  findUsersByIds(ids: string[]): Promise<User[]> {
    return ids.length
      ? this.users.findBy({ id: In(ids) })
      : Promise.resolve([]);
  }
}
