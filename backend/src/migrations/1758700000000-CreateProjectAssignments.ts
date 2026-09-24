import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectAssignments1758700000000 implements MigrationInterface {
  name = 'CreateProjectAssignments1758700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // All four FKs CASCADE: an assignment only means something in the
    // context of a user/project/environment/component that still exists —
    // once any of those is gone, the assignment row is dead weight, not a
    // historical record worth keeping (unlike AuditLog, which deliberately
    // keeps a name snapshot after its target is deleted).
    await queryRunner.query(`
      CREATE TABLE "project_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "projectId" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "environmentId" uuid NOT NULL REFERENCES "environments"("id") ON DELETE CASCADE,
        "projectComponentId" uuid REFERENCES "project_components"("id") ON DELETE CASCADE,
        "createdBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_project_assignments_user_id" ON "project_assignments" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_project_assignments_environment_id" ON "project_assignments" ("environmentId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "project_assignments"`);
  }
}
