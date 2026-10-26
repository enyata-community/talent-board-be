import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from "typeorm";

export class CreatePasswordResetTokensTable1745418605538
  implements MigrationInterface
{
  name = "CreatePasswordResetTokensTable1745418605538";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "password_reset_tokens",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "uuid",
          },
          { name: "user_id", type: "uuid" },
          { name: "email", type: "varchar" },
          { name: "token", type: "varchar" },
          { name: "expires_at", type: "timestamp" },
          { name: "used_at", type: "timestamp", isNullable: true },
          { name: "created_at", type: "timestamp", default: "now()" },
          { name: "updated_at", type: "timestamp", default: "now()" },
          { name: "deleted_at", type: "timestamp", isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      "password_reset_tokens",
      new TableForeignKey({
        columnNames: ["user_id"],
        referencedColumnNames: ["id"],
        referencedTableName: "users",
        onDelete: "CASCADE",
      }),
    );

    // Index for faster lookups during reset
    await queryRunner.query(
      `CREATE INDEX "IDX_PASSWORD_RESET_EMAIL_TOKEN" ON "password_reset_tokens" ("email", "token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // dropTable removes its foreign keys and indexes through the query runner,
    // keeping TypeORM's cached table metadata consistent during full rollback.
    await queryRunner.dropTable("password_reset_tokens");
  }
}
