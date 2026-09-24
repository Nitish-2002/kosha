import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { ProjectComponent } from '../projects/project-component.entity';
import { Environment } from '../environments/environment.entity';
import { EnvironmentComponentConfig } from '../environments/environment-component-config.entity';

// Registered locally (rather than importing Users/Projects/Environments
// modules) purely to hydrate display names on a request row — Projects,
// Environments and Variables modules all need to import *this* module to
// create a request from their controllers, so importing them back here would
// be a cycle. Same pattern as project-assignments/lookups.repository.ts.
@Injectable()
export class UserLookupRepository {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findByIds(ids: string[]): Promise<User[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }
}

@Injectable()
export class ProjectLookupRepository {
  constructor(
    @InjectRepository(Project) private readonly repo: Repository<Project>,
  ) {}

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

  findByIds(ids: string[]): Promise<Environment[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }

  findById(id: string): Promise<Environment | null> {
    return this.repo.findOneBy({ id });
  }
}

@Injectable()
export class EnvironmentComponentConfigLookupRepository {
  constructor(
    @InjectRepository(EnvironmentComponentConfig)
    private readonly repo: Repository<EnvironmentComponentConfig>,
  ) {}

  findByIds(ids: string[]): Promise<EnvironmentComponentConfig[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }

  findById(id: string): Promise<EnvironmentComponentConfig | null> {
    return this.repo.findOneBy({ id });
  }
}
