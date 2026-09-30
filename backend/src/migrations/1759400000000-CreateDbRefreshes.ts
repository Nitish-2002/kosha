import { MigrationInterface, QueryRunner } from 'typeorm';

// "Record DB refresh" (PRD Feature 12): an environment's database was
// restored from another environment's dump, so its script states are reset
// to match the source.
// - db_refreshes: one row per recorded restore. sourceEnvironmentName is a
//   snapshot so the history still reads sensibly if the source is deleted
//   (its FK then goes NULL); deleting the restored environment removes its
//   refresh history with it.
// - db_script_states.refreshId: set on an "applied" state that came over in
//   the dump rather than being run by hand, so the UI can say "from preprod
//   dump" instead of naming a person. Cleared whenever someone marks or
//   undoes by hand.
export class CreateDbRefreshes1759400000000 implements MigrationInterface {
  name = 'CreateDbRefreshes1759400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "db_refreshes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "projectId" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "sourceEnvironmentId" uuid REFERENCES "environments"("id") ON DELETE SET NULL,
        "sourceEnvironmentName" text NOT NULL,
        "targetEnvironmentId" uuid NOT NULL REFERENCES "environments"("id") ON DELETE CASCADE,
        "dumpTakenOn" date NOT NULL,
        "recordedBy" uuid NOT NULL REFERENCES "users"("id"),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CHECK ("sourceEnvironmentId" IS DISTINCT FROM "targetEnvironmentId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_db_refreshes_target_environment_id" ON "db_refreshes" ("targetEnvironmentId", "createdAt")`,
    );
    await queryRunner.query(`
      ALTER TABLE "db_script_states"
      ADD COLUMN "refreshId" uuid REFERENCES "db_refreshes"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "db_script_states" DROP COLUMN "refreshId"`,
    );
    await queryRunner.query(`DROP TABLE "db_refreshes"`);
  }
}
