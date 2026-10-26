import "dotenv/config";
import "reflect-metadata";
import AppDataSource from "../../datasource";
import { AdminInvitationService } from "../adminInvitation.service";
import { email } from "../schemas/admin.schema";
import { adminConfig } from "../admin.config";
import { closeLogger } from "../../utils/logger";
const run = async () => {
  try {
    const args = process.argv.slice(2);
    const address = email.parse(args[0]);
    if (args.slice(1).some((arg) => arg !== "--retry"))
      throw new Error("Usage: admin:bootstrap email [--retry]");
    adminConfig();
    AppDataSource.setOptions({ synchronize: false, migrationsRun: false });
    await AppDataSource.initialize();
    const result = await new AdminInvitationService().bootstrap(
      address,
      args.includes("--retry"),
    );
    console.log(JSON.stringify(result));
    if (result.delivery_status !== "sent") process.exitCode = 1;
  } catch (error) {
    // Do not print database errors, SMTP details, or setup tokens.
    console.error(
      error instanceof Error && "isOperational" in error
        ? error.message
        : "Bootstrap failed. Check arguments, admin configuration, and database availability.",
    );
    process.exitCode = 1;
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    await closeLogger();
  }
};
void run();
