import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Environment } from '../environments/environment.entity';

// Registered locally (rather than importing EnvironmentsModule) — that
// module already imports ProjectsModule for its own project/component
// lookups, so importing it back here would be a cycle. Same pattern as
// project-assignments/lookups.repository.ts. One grouped COUNT query for
// every project on the page, instead of the N per-project /environments
// calls ProjectsPage used to make just to show this number.
@Injectable()
export class EnvironmentCountLookupRepository {
  constructor(
    @InjectRepository(Environment)
    private readonly repo: Repository<Environment>,
  ) {}

  async countByProjectIds(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows: { projectId: string; count: string }[] = await this.repo
      .createQueryBuilder('environment')
      .select('environment.projectId', 'projectId')
      .addSelect('COUNT(*)', 'count')
      .where('environment.projectId IN (:...projectIds)', { projectIds })
      .groupBy('environment.projectId')
      .getRawMany();
    return new Map(rows.map((row) => [row.projectId, Number(row.count)]));
  }
}
