import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserAccountStatus1793100002000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "users_status_enum" AS ENUM ('active', 'suspended')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "status" "users_status_enum" NOT NULL DEFAULT 'active'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_management" ON "users" ("role", "status", "created_at", "id") WHERE "deleted_at" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_management"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "users_status_enum"`);
  }
}
