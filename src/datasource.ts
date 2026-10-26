import "dotenv/config";

import config from "config";
import path from "path";
import "reflect-metadata";
import { DataSource } from "typeorm";

const isCompiled = path.resolve(__dirname).includes("build");
const isProduction = config.get<string>("NODE_ENV") === "production";

const databaseUrl =
  process.env.DATABASE_URL || config.get<string>("DATABASE_URL");

const AppDataSource = new DataSource({
  type: "postgres",
  url: databaseUrl,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  // Identity backfills must run before old columns can be removed.
  synchronize: config.get<string>("NODE_ENV") === "test",
  logging: false,
  entities: isCompiled
    ? ["build/src/entities/**/*.js"]
    : ["src/entities/**/*{.ts,.js}"],
  migrations: isCompiled
    ? ["build/src/migrations/**/*.js"]
    : ["src/migrations/**/*{.ts,.js}"],
  migrationsTableName: "migrations",
});

export async function initializeDataSource() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}

export default AppDataSource;
