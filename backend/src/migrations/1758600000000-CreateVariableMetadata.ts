import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVariableMetadata1758600000000 implements MigrationInterface {
  name = 'CreateVariableMetadata1758600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "variable_metadata" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "environmentComponentConfigId" uuid NOT NULL REFERENCES "environment_component_configs"("id") ON DELETE CASCADE,
        "key" text NOT NULL,
        "isSecret" boolean NOT NULL DEFAULT false,
        "lastChangedBy" uuid NOT NULL REFERENCES "users"("id"),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("environmentComponentConfigId", "key")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_variable_metadata_config_id" ON "variable_metadata" ("environmentComponentConfigId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "variable_metadata"`);
  }
}
