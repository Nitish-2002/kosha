import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProjectComponent } from './project-component.entity';

@Injectable()
export class ProjectComponentsRepository {
  constructor(
    @InjectRepository(ProjectComponent)
    private readonly repo: Repository<ProjectComponent>,
  ) {}

  findAllOrderedByCreatedAt(): Promise<ProjectComponent[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  findByProject(projectId: string): Promise<ProjectComponent[]> {
    return this.repo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
  }

  findById(id: string): Promise<ProjectComponent | null> {
    return this.repo.findOneBy({ id });
  }

  findByIds(ids: string[]): Promise<ProjectComponent[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }

  findByIdAndProject(
    id: string,
    projectId: string,
  ): Promise<ProjectComponent | null> {
    return this.repo.findOneBy({ id, projectId });
  }

  create(fields: { projectId: string; name: string }): ProjectComponent {
    return this.repo.create(fields);
  }

  save(component: ProjectComponent): Promise<ProjectComponent> {
    return this.repo.save(component);
  }

  remove(component: ProjectComponent): Promise<ProjectComponent> {
    return this.repo.remove(component);
  }
}
