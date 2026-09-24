import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Environment } from './environment.entity';

@Injectable()
export class EnvironmentsRepository {
  constructor(
    @InjectRepository(Environment)
    private readonly repo: Repository<Environment>,
  ) {}

  findByProject(projectId: string): Promise<Environment[]> {
    return this.repo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
  }

  findByIdsOrderedByCreatedAt(ids: string[]): Promise<Environment[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repo.find({
      where: { id: In(ids) },
      order: { createdAt: 'ASC' },
    });
  }

  findById(id: string): Promise<Environment | null> {
    return this.repo.findOneBy({ id });
  }

  create(fields: { projectId: string; name: string }): Environment {
    return this.repo.create(fields);
  }

  save(environment: Environment): Promise<Environment> {
    return this.repo.save(environment);
  }

  remove(environment: Environment): Promise<Environment> {
    return this.repo.remove(environment);
  }
}
