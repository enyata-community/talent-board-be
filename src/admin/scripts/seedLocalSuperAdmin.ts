import "dotenv/config";
import "reflect-metadata";
import config from "config";
import AppDataSource from "../../datasource";
import {
  assertLocalSeedTarget,
  seedLocalSuperAdmin,
} from "../localSuperAdmin.service";
import { closeLogger } from "../../utils/logger";

const run = async () => {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !["--host", "--reset-password"].includes(arg)))
      throw new Error("Usage: admin:seed:local [--host] [--reset-password]");
    const url = new URL(
      String((AppDataSource.options as { url?: string }).url),
    );
    assertLocalSeedTarget(
      config.get<string>("NODE_ENV"),
      process.env.NODE_ENV,
      url.toString(),
    );
    if (
      args.includes("--host") &&
      ["postgres", "postgres-dev"].includes(url.hostname)
    ) {
      url.hostname = "127.0.0.1";
      url.port = "5452";
    }
    // Seeding changes account rows only; it must not synchronize application tables.
    AppDataSource.setOptions({
      url: url.toString(),
      synchronize: false,
      migrationsRun: false,
    });
    await AppDataSource.initialize();
    const result = await seedLocalSuperAdmin(args.includes("--reset-password"));
    console.log(
      JSON.stringify({ ...result, login: "/api/v1/superadmin/auth/login" }),
    );
  } catch (error) {
    console.error(
      error instanceof Error && "isOperational" in error
        ? error.message
        : "Local seed failed. Use development mode and a local database with admin tables installed.",
    );
    process.exitCode = 1;
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    await closeLogger();
  }
};
void run();
