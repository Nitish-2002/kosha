import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnvironmentComponentConfig } from './environment-component-config.entity';

@Injectable()
export class EnvironmentComponentConfigsRepository {
  constructor(
    @InjectRepository(EnvironmentComponentConfig)
    private readonly repo: Repository<EnvironmentComponentConfig>,
  ) {}

  findByEnvironment(
    environmentId: string,
  ): Promise<EnvironmentComponentConfig[]> {
    return this.repo.find({
      where: { environmentId },
      order: { createdAt: 'ASC' },
    });
  }

  findByIdAndEnvironment(
    id: string,
    environmentId: string,
  ): Promise<EnvironmentComponentConfig | null> {
    return this.repo.findOneBy({ id, environmentId });
  }

  // Used by RequestReviewsService: a RollbackRequest stores the config id
  // directly, but VariablesService.rollback() also needs the environment id
  // (this is the only lookup that has both without the caller already
  // knowing which environment the config belongs to).
  findById(id: string): Promise<EnvironmentComponentConfig | null> {
    return this.repo.findOneBy({ id });
  }

  // Used by RequestReviewsService: a DeleteRequest for target_type
  // 'component'/'variable' stores environmentId + projectComponentId (the
  // same pair the UNIQUE constraint on this table is keyed on — LLD table
  // notes), not the config id directly, so it has to be resolved this way.
  findByEnvironmentAndComponent(
    environmentId: string,
    projectComponentId: string,
  ): Promise<EnvironmentComponentConfig | null> {
    return this.repo.findOneBy({ environmentId, projectComponentId });
  }

  create(
    fields: Partial<EnvironmentComponentConfig>,
  ): EnvironmentComponentConfig {
    return this.repo.create(fields);
  }

  save(
    config: EnvironmentComponentConfig,
  ): Promise<EnvironmentComponentConfig> {
    return this.repo.save(config);
  }

  remove(
    config: EnvironmentComponentConfig,
  ): Promise<EnvironmentComponentConfig> {
    return this.repo.remove(config);
  }
}
