import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { ProjectComponent } from '../projects/project-component.entity';
import { Environment } from '../environments/environment.entity';

// Read-only, single-purpose lookups for validating and hydrating assignment
// rows. Deliberately local to this module (not imports of UsersModule /
// ProjectsModule / EnvironmentsModule) — those modules depend on
// ProjectAssignmentsService for scoping, so importing them back here would
// be a circular module dependency. A few thin, duplicated lookup methods are
// the trade-off for a clean one-directional module graph.

@Injectable()
export class UserLookupRepository {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  findByIds(ids: string[]): Promise<User[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }
}

@Injectable()
export class ProjectLookupRepository {
  constructor(
    @InjectRepository(Project) private readonly repo: Repository<Project>,
  ) {}

  findById(id: string): Promise<Project | null> {
    return this.repo.findOneBy({ id });
  }

  findByIds(ids: string[]): Promise<Project[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }
}

@Injectable()
export class ProjectComponentLookupRepository {
  constructor(
    @InjectRepository(ProjectComponent)
    private readonly repo: Repository<ProjectComponent>,
  ) {}

  findById(id: string): Promise<ProjectComponent | null> {
    return this.repo.findOneBy({ id });
  }

  findByIds(ids: string[]): Promise<ProjectComponent[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }
}

@Injectable()
export class EnvironmentLookupRepository {
  constructor(
    @InjectRepository(Environment)
    private readonly repo: Repository<Environment>,
  ) {}

  findById(id: string): Promise<Environment | null> {
    return this.repo.findOneBy({ id });
  }

  findByIds(ids: string[]): Promise<Environment[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }
}
