import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity';

@Injectable()
export class ProjectsRepository {
  constructor(
    @InjectRepository(Project) private readonly repo: Repository<Project>,
  ) {}

  findAllOrderedByCreatedAt(): Promise<Project[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  findByIdsOrderedByCreatedAt(ids: string[]): Promise<Project[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repo.find({
      where: { id: In(ids) },
      order: { createdAt: 'DESC' },
    });
  }

  findById(id: string): Promise<Project | null> {
    return this.repo.findOneBy({ id });
  }

  create(fields: {
    name: string;
    description: string | null;
    createdBy: string;
  }): Project {
    return this.repo.create(fields);
  }

  save(project: Project): Promise<Project> {
    return this.repo.save(project);
  }

  remove(project: Project): Promise<Project> {
    return this.repo.remove(project);
  }
}
