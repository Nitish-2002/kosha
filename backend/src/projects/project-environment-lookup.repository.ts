import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Environment } from '../environments/environment.entity';

// Registered locally (rather than importing EnvironmentsModule) — that
// module already imports ProjectsModule for its own project/component
// lookups, so importing it back here would be a cycle. Same pattern as
// project-assignments/lookups.repository.ts. One query for every project on
// the page (names for the Projects list chips, and the count), instead of N
// per-project /environments calls.
@Injectable()
export class ProjectEnvironmentLookupRepository {
  constructor(
    @InjectRepository(Environment)
    private readonly repo: Repository<Environment>,
  ) {}

  findByProjectIds(projectIds: string[]): Promise<Environment[]> {
    if (projectIds.length === 0) return Promise.resolve([]);
    return this.repo.find({
      where: { projectId: In(projectIds) },
      order: { createdAt: 'ASC' },
    });
  }
}
