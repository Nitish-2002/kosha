import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// A numbered SQL script belonging to a project (PRD Feature 12). Kosha only
// records it — nothing here ever connects to or runs against a database.
@Entity('db_scripts')
export class DbScript {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  projectId!: string;

  // Shown as 001, 002, … — assigned as max + 1 within the project.
  @Column({ type: 'integer' })
  sequence!: number;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  sql!: string;

  @Column({ type: 'text' })
  sqlFingerprint!: string;

  @Column({ type: 'boolean', default: false })
  rerunAfterRestore!: boolean;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
