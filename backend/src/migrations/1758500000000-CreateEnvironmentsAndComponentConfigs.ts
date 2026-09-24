import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEnvironmentsAndComponentConfigs1758500000000 implements MigrationInterface {
  name = 'CreateEnvironmentsAndComponentConfigs1758500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "environments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "projectId" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("projectId", "name")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_environments_project_id" ON "environments" ("projectId")`,
    );

    // ON DELETE NO ACTION on projectComponentId: deleting a component that
    // still has a config attached is a DB-level 409 (LLD — table notes wants
    // RESTRICT's effect, but NOT the literal RESTRICT action — see below).
    // DEFERRABLE INITIALLY DEFERRED: deleting a whole project cascades down
    // two independent sibling paths — projects -> project_components, and
    // projects -> environments -> environment_component_configs — and
    // Postgres doesn't guarantee the second finishes before the first checks
    // this constraint. Deferring the check to end-of-transaction means it
    // only fires if a config is still dangling once every cascade in the
    // same statement has run; a standalone component-delete (no project
    // deletion involved) still gets the same immediate 409 either way, since
    // nothing else in that single-statement transaction clears the block.
    // This has to be NO ACTION, not RESTRICT: per Postgres docs, RESTRICT's
    // check can never be deferred regardless of DEFERRABLE — only NO ACTION
    // (the same "reject if still referenced" behavior) honors deferred
    // timing, which is the whole point of this constraint here.
    // ON DELETE SET NULL on the two credential FKs: deleting a credential is
    // never blocked (LLD — table notes); the config row survives with a
    // dangling reference rather than the delete being rejected.
    // CHECK enforces "exactly one of the s3_*/github_* groups is populated,
    // matching sourceType" as a DB guarantee, not app-level logic.
    await queryRunner.query(`
      CREATE TABLE "environment_component_configs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "environmentId" uuid NOT NULL REFERENCES "environments"("id") ON DELETE CASCADE,
        "projectComponentId" uuid NOT NULL REFERENCES "project_components"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        "sourceType" text NOT NULL CHECK ("sourceType" IN ('s3', 'github')),
        "s3Bucket" text,
        "s3Region" text,
        "s3CredentialId" uuid REFERENCES "credentials"("id") ON DELETE SET NULL,
        "s3KeyOverride" text,
        "githubRepo" text,
        "githubBranch" text,
        "githubCredentialId" uuid REFERENCES "credentials"("id") ON DELETE SET NULL,
        "githubConfigmapPath" text,
        "githubSecretPath" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("environmentId", "projectComponentId"),
        CHECK (
          ("sourceType" = 's3'
            AND "s3Bucket" IS NOT NULL AND "s3Region" IS NOT NULL AND "s3CredentialId" IS NOT NULL
            AND "githubRepo" IS NULL AND "githubBranch" IS NULL AND "githubCredentialId" IS NULL
            AND "githubConfigmapPath" IS NULL AND "githubSecretPath" IS NULL)
          OR
          ("sourceType" = 'github'
            AND "githubRepo" IS NOT NULL AND "githubBranch" IS NOT NULL AND "githubCredentialId" IS NOT NULL
            AND "s3Bucket" IS NULL AND "s3Region" IS NULL AND "s3CredentialId" IS NULL AND "s3KeyOverride" IS NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_environment_component_configs_environment_id" ON "environment_component_configs" ("environmentId")`,
    );

    // Rows from before these FKs existed can point at a project/environment
    // that's since been hard-deleted — null them out first, exactly what ON
    // DELETE SET NULL would have done had the constraint existed at delete
    // time.
    await queryRunner.query(`
      UPDATE "audit_logs" SET "projectId" = NULL
      WHERE "projectId" IS NOT NULL AND "projectId" NOT IN (SELECT "id" FROM "projects")
    `);
    await queryRunner.query(`
      UPDATE "audit_logs" SET "environmentId" = NULL
      WHERE "environmentId" IS NOT NULL AND "environmentId" NOT IN (SELECT "id" FROM "environments")
    `);

    // Backfills the FKs audit_logs.entity.ts's comment deferred until both
    // tables existed. ON DELETE SET NULL — a deleted project/environment
    // doesn't take its audit history down with it (LLD — table notes).
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "fk_audit_logs_project_id" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "fk_audit_logs_environment_id" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "fk_audit_logs_environment_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "fk_audit_logs_project_id"`,
    );
    await queryRunner.query(`DROP TABLE "environment_component_configs"`);
    await queryRunner.query(`DROP TABLE "environments"`);
  }
}
