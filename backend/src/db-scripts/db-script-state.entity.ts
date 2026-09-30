import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type DbScriptStatus = 'pending' | 'applied' | 'not_applicable';

// One script's state in one environment. No row = pending.
@Entity('db_script_states')
export class DbScriptState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scriptId!: string;

  @Column({ type: 'uuid' })
  environmentId!: string;

  @Column({ type: 'text' })
  status!: DbScriptStatus;

  @Column({ type: 'uuid', nullable: true })
  appliedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  // Set when this "applied" came over in a restored dump (DbRefresh), not
  // from someone running the script by hand.
  @Column({ type: 'uuid', nullable: true })
  refreshId!: string | null;
}
