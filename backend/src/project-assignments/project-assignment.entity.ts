import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// The unit of delegation (PRD — Core entities): scopes a Member to one
// project + environment, optionally narrowed to a single component.
// projectComponentId === null means "every component in this environment",
// not "no components" — a Member with a null-component row here sees every
// config the environment has, same as an Admin would within that one
// environment.
@Entity('project_assignments')
export class ProjectAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid' })
  projectId!: string;

  @Column({ type: 'uuid' })
  environmentId!: string;

  @Column({ type: 'uuid', nullable: true })
  projectComponentId!: string | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
