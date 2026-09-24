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

  findAll(): Promise<ProjectAssignment[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  findForProject(projectId: string): Promise<ProjectAssignment[]> {
    return this.repo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
  }

  async countDistinctUsersByProject(
    projectIds: string[],
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows: { projectId: string; count: string }[] = await this.repo
      .createQueryBuilder('assignment')
      .select('assignment.projectId', 'projectId')
      .addSelect('COUNT(DISTINCT assignment.userId)', 'count')
      .where('assignment.projectId IN (:...projectIds)', { projectIds })
      .groupBy('assignment.projectId')
      .getRawMany();
    return new Map(rows.map((row) => [row.projectId, Number(row.count)]));
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
