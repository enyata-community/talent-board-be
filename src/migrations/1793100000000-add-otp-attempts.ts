import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOtpAttempts1793100000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "email_otps" ADD COLUMN "failed_attempts" integer NOT NULL DEFAULT 0`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "email_otps" DROP COLUMN "failed_attempts"`,
    );
  }
}
