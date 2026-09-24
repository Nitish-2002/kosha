import { MigrationInterface, QueryRunner } from 'typeorm';

// "Last active" on the Members page — set on each Google sign-in (a new
// session), never on token refresh. Null until the user's next sign-in.
export class AddUserLastLoginAt1759000000000 implements MigrationInterface {
  name = 'AddUserLastLoginAt1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "lastLoginAt" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastLoginAt"`);
  }
}
