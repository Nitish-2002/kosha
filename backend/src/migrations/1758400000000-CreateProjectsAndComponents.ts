import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectsAndComponents1758400000000 implements MigrationInterface {
  name = 'CreateProjectsAndComponents1758400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL UNIQUE,
        "description" text,
        "createdBy" uuid NOT NULL REFERENCES "users"("id"),
        "archivedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ON DELETE CASCADE from project: deleting a project takes its own
    // declared components with it. ON DELETE RESTRICT is what a *future*
    // environment_component_configs migration will add on its own FK to
    // this table — nothing references components yet, but the LLD already
    // commits to that guarantee, so the naming/shape here anticipates it.
    await queryRunner.query(`
      CREATE TABLE "project_components" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "projectId" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("projectId", "name")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_project_components_project_id" ON "project_components" ("projectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "project_components"`);
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
