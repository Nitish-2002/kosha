import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Environment } from './environment.entity';

// Environments always list in their Admin-set order; createdAt only breaks
// ties (every row starts at position 0 until the migration backfill).
const ENVIRONMENT_ORDER = { position: 'ASC', createdAt: 'ASC' } as const;

@Injectable()
export class EnvironmentsRepository {
  constructor(
    @InjectRepository(Environment)
    private readonly repo: Repository<Environment>,
  ) {}

  findByProject(projectId: string): Promise<Environment[]> {
    return this.repo.find({
      where: { projectId },
      order: ENVIRONMENT_ORDER,
    });
  }

  findByIdsInOrder(ids: string[]): Promise<Environment[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repo.find({
      where: { id: In(ids) },
      order: ENVIRONMENT_ORDER,
    });
  }

  findById(id: string): Promise<Environment | null> {
    return this.repo.findOneBy({ id });
  }

  async nextPosition(projectId: string): Promise<number> {
    const highest = await this.repo.maximum('position', { projectId });
    return highest === null ? 0 : highest + 1;
  }

  create(fields: {
    projectId: string;
    name: string;
    position: number;
  }): Environment {
    return this.repo.create(fields);
  }

  save(environment: Environment): Promise<Environment> {
    return this.repo.save(environment);
  }

  // One transaction, so a failure part-way can't leave two environments
  // sharing a position.
  async savePositions(orderedIds: string[]): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      for (const [position, id] of orderedIds.entries()) {
        await manager.update(Environment, { id }, { position });
      }
    });
  }

  remove(environment: Environment): Promise<Environment> {
    return this.repo.remove(environment);
  }
}
