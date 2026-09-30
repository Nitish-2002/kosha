import { MigrationInterface, QueryRunner } from 'typeorm';

// DB script tracking (PRD Feature 12), part 1:
// - environments.position: the Admin-set lower → higher order the drift rule
//   needs. createdAt can't serve — a uat added later would sort after prod.
//   Backfilled from createdAt so existing projects keep their current order.
// - db_scripts: one row per script. The three UNIQUEs are the DB-level
//   guarantee behind "no duplicate number, name, or SQL within a project";
//   sqlFingerprint is a sha256 of the normalized SQL (see sql-fingerprint.ts),
//   since a btree can't index arbitrarily long text directly.
// - db_script_states: one row per script × environment. A missing row reads
//   as pending (an environment added after the script was written).
// - audit_logs.action gains 'apply' (a script marked as run in an environment).
export class CreateDbScripts1759200000000 implements MigrationInterface {
  name = 'CreateDbScripts1759200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "environments" ADD COLUMN "position" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      UPDATE "environments" SET "position" = ranked."rowNumber"
      FROM (
        SELECT "id", row_number() OVER (PARTITION BY "projectId" ORDER BY "createdAt") - 1 AS "rowNumber"
        FROM "environments"
      ) ranked
      WHERE "environments"."id" = ranked."id"
    `);

    await queryRunner.query(`
      CREATE TABLE "db_scripts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "projectId" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "sequence" integer NOT NULL,
        "name" text NOT NULL,
        "sql" text NOT NULL,
        "sqlFingerprint" text NOT NULL,
        "rerunAfterRestore" boolean NOT NULL DEFAULT false,
        "createdBy" uuid NOT NULL REFERENCES "users"("id"),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_db_scripts_project_sequence" UNIQUE ("projectId", "sequence"),
        CONSTRAINT "uq_db_scripts_project_name" UNIQUE ("projectId", "name"),
        CONSTRAINT "uq_db_scripts_project_fingerprint" UNIQUE ("projectId", "sqlFingerprint")
      )
    `);

    // CHECK: applied ⇔ who and when are both recorded.
    await queryRunner.query(`
      CREATE TABLE "db_script_states" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "scriptId" uuid NOT NULL REFERENCES "db_scripts"("id") ON DELETE CASCADE,
        "environmentId" uuid NOT NULL REFERENCES "environments"("id") ON DELETE CASCADE,
        "status" text NOT NULL CHECK ("status" IN ('pending', 'applied', 'not_applicable')),
        "appliedBy" uuid REFERENCES "users"("id"),
        "appliedAt" timestamptz,
        UNIQUE ("scriptId", "environmentId"),
        CHECK (("status" = 'applied') = ("appliedBy" IS NOT NULL AND "appliedAt" IS NOT NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_db_script_states_environment_id" ON "db_script_states" ("environmentId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check"`,
    );
    await queryRunner.query(`
      ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_check"
      CHECK ("action" IN ('create', 'update', 'delete', 'rollback', 'reveal', 'import',
                          'request', 'reject', 'login', 'logout', 'refresh', 'apply'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "audit_logs" WHERE "action" = 'apply'`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check"`,
    );
    await queryRunner.query(`
      ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_check"
      CHECK ("action" IN ('create', 'update', 'delete', 'rollback', 'reveal', 'import',
                          'request', 'reject', 'login', 'logout', 'refresh'))
    `);
    await queryRunner.query(`DROP TABLE "db_script_states"`);
    await queryRunner.query(`DROP TABLE "db_scripts"`);
    await queryRunner.query(
      `ALTER TABLE "environments" DROP COLUMN "position"`,
    );
  }
}
