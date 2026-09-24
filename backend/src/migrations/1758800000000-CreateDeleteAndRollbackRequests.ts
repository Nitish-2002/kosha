import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeleteAndRollbackRequests1758800000000 implements MigrationInterface {
  name = 'CreateDeleteAndRollbackRequests1758800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // project_id/environment_id/project_component_id are nullable and only
    // the ones relevant to target_type are populated — e.g. a
    // target_type='variable' row sets environment_id + project_component_id
    // + key, a target_type='project' row sets only project_id. This lets one
    // table cover all four delete targets from PRD Feature 6 without a
    // separate column per granularity (LLD — table notes). ON DELETE CASCADE
    // on all three: if the thing a pending request targets is gone (e.g. an
    // Admin deleted the project directly while a Member's request on one of
    // its variables was still pending), the request is dead weight, not a
    // historical record worth keeping — same reasoning as project_assignments.
    // requesterId/reviewerId reference users(id) with no special ON DELETE
    // action: users.id is never hard-deleted (deactivation only), so that FK
    // never actually gets exercised, but the column still needs to reference
    // a real row.
    await queryRunner.query(`
      CREATE TABLE "delete_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requesterId" uuid NOT NULL REFERENCES "users"("id"),
        "targetType" text NOT NULL CHECK ("targetType" IN ('variable', 'component', 'environment', 'project')),
        "projectId" uuid REFERENCES "projects"("id") ON DELETE CASCADE,
        "environmentId" uuid REFERENCES "environments"("id") ON DELETE CASCADE,
        "projectComponentId" uuid REFERENCES "project_components"("id") ON DELETE CASCADE,
        "key" text,
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
        "reviewerId" uuid REFERENCES "users"("id"),
        "reviewerNote" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "reviewedAt" timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_delete_requests_status" ON "delete_requests" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_delete_requests_requester_id" ON "delete_requests" ("requesterId")`,
    );

    // Rollback only ever applies to one granularity (a specific config's
    // file), so it keeps a direct FK instead of decomposing like
    // delete_requests does.
    await queryRunner.query(`
      CREATE TABLE "rollback_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requesterId" uuid NOT NULL REFERENCES "users"("id"),
        "environmentComponentConfigId" uuid NOT NULL REFERENCES "environment_component_configs"("id") ON DELETE CASCADE,
        "key" text,
        "targetVersionId" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
        "reviewerId" uuid REFERENCES "users"("id"),
        "reviewerNote" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "reviewedAt" timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rollback_requests_status" ON "rollback_requests" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rollback_requests_requester_id" ON "rollback_requests" ("requesterId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rollback_requests"`);
    await queryRunner.query(`DROP TABLE "delete_requests"`);
  }
}
