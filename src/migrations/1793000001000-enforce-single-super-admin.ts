import { MigrationInterface, QueryRunner } from "typeorm";
export class EnforceSingleSuperAdmin1793000001000
  implements MigrationInterface
{
  name = "EnforceSingleSuperAdmin1793000001000";
  async up(queryRunner: QueryRunner): Promise<void> {
    // Includes pending/disabled accounts: disabling must not create a second root identity.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_single_super_admin ON admin_accounts (role) WHERE role = 'super_admin'`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_single_super_admin`);
  }
}
