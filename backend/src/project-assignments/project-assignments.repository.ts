import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ProjectAssignment } from './project-assignment.entity';

@Injectable()
export class ProjectAssignmentsRepository {
  constructor(
    @InjectRepository(ProjectAssignment)
    private readonly repo: Repository<ProjectAssignment>,
  ) {}

  findForUser(userId: string): Promise<ProjectAssignment[]> {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  findForProject(projectId: string): Promise<ProjectAssignment[]> {
    return this.repo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
  }

  findForUserAndProject(
    userId: string,
    projectId: string,
  ): Promise<ProjectAssignment[]> {
    return this.repo.find({ where: { userId, projectId } });
  }

  findForUserAndEnvironment(
    userId: string,
    environmentId: string,
  ): Promise<ProjectAssignment[]> {
    return this.repo.find({ where: { userId, environmentId } });
  }

  findOneMatching(
    userId: string,
    environmentId: string,
    projectComponentId: string | null,
  ): Promise<ProjectAssignment | null> {
    return this.repo.findOneBy({
      userId,
      environmentId,
      projectComponentId: projectComponentId ?? IsNull(),
    });
  }

  findById(id: string): Promise<ProjectAssignment | null> {
    return this.repo.findOneBy({ id });
  }

  create(fields: {
    userId: string;
    projectId: string;
    environmentId: string;
    projectComponentId: string | null;
    createdBy: string;
  }): ProjectAssignment {
    return this.repo.create(fields);
  }

  save(assignment: ProjectAssignment): Promise<ProjectAssignment> {
    return this.repo.save(assignment);
  }

  remove(assignment: ProjectAssignment): Promise<ProjectAssignment> {
    return this.repo.remove(assignment);
  }
}
