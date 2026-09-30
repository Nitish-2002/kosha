import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// One recorded restore of an environment's database from another
// environment's dump (PRD Feature 12 — "Record DB refresh").
@Entity('db_refreshes')
export class DbRefresh {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  projectId!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceEnvironmentId!: string | null;

  @Column({ type: 'text' })
  sourceEnvironmentName!: string;

  @Column({ type: 'uuid' })
  targetEnvironmentId!: string;

  // Calendar date the dump was taken, 'YYYY-MM-DD' — not a moment in time.
  @Column({ type: 'date' })
  dumpTakenOn!: string;

  @Column({ type: 'uuid' })
  recordedBy!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
