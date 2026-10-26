import { UserEntity } from "../entities/user.entity";
import {
  adminAccountQuery,
  createAdminIdentity,
} from "./adminIdentity.service";
import config from "config";
import { hash, verify } from "argon2";
import { IsNull } from "typeorm";
import AppDataSource from "../datasource";
import {
  AdminAccount,
  AdminRole,
  AdminStatus,
} from "../entities/adminAccount.entity";
import { AdminInvitation } from "../entities/adminInvitation.entity";
import { AdminSession } from "../entities/adminSession.entity";
import { AppError } from "../exceptions/appError";
import { audit } from "./adminAudit.service";

export const LOCAL_SUPER_ADMIN_EMAIL = "superadmin@example.com";
export const LOCAL_SUPER_ADMIN_PASSWORD = "LocalSuperAdmin123!";
export const assertLocalSeedTarget = (
  environment: string,
  runtimeEnvironment: string | undefined,
  databaseUrl: string,
) => {
  if (environment !== "development" || runtimeEnvironment === "production")
    throw new Error("Local Super Admin seed is only available in development");
  const url = new URL(databaseUrl);
  if (
    !["localhost", "127.0.0.1", "[::1]", "postgres", "postgres-dev"].includes(
      url.hostname,
    )
  )
    throw new Error("Local seed requires a local PostgreSQL host");
};

export const seedLocalSuperAdmin = async (resetPassword = false) => {
  assertLocalSeedTarget(
    config.get<string>("NODE_ENV"),
    process.env.NODE_ENV,
    String((AppDataSource.options as { url?: string }).url),
  );
  return AppDataSource.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(812744001)");
    const root = await adminAccountQuery(tx)
      .where("identity.role = :role OR identity.email = :email", {
        role: AdminRole.SUPER_ADMIN,
        email: LOCAL_SUPER_ADMIN_EMAIL,
      })
      .setLock("pessimistic_write")
      .getMany();
    if (
      root.length > 1 ||
      (root[0] &&
        (root[0].email !== LOCAL_SUPER_ADMIN_EMAIL ||
          root[0].role !== AdminRole.SUPER_ADMIN))
    )
      throw new AppError(
        "A different admin identity already exists; local seed will not replace it",
        409,
      );
    let account = root[0];
    if (account?.status === AdminStatus.DISABLED)
      throw new AppError(
        "Local seed will not reactivate a disabled Super Admin",
        409,
      );
    if (account?.status === AdminStatus.ACTIVE && !resetPassword) {
      if (
        !account.user.password ||
        !(await verify(account.user.password, LOCAL_SUPER_ADMIN_PASSWORD))
      )
        throw new AppError(
          "Existing local password differs; pass --reset-password to explicitly reset it",
          409,
        );
      return {
        email: LOCAL_SUPER_ADMIN_EMAIL,
        password: LOCAL_SUPER_ADMIN_PASSWORD,
        role: AdminRole.SUPER_ADMIN,
        created: false,
      };
    }
    const created = !account;
    if (!account)
      account = await createAdminIdentity(
        tx,
        LOCAL_SUPER_ADMIN_EMAIL,
        AdminRole.SUPER_ADMIN,
        "Local Super Admin",
      );
    await tx.update(
      UserEntity,
      { id: account.user_id },
      {
        password: await hash(LOCAL_SUPER_ADMIN_PASSWORD),
        first_name: "Local",
        last_name: "Super Admin",
        is_email_verified: true,
      },
    );
    account.status = AdminStatus.ACTIVE;
    account.password_set_at = new Date();
    account = await tx.save(AdminAccount, account);
    await tx.update(
      AdminInvitation,
      {
        admin_account_id: account.id,
        accepted_at: IsNull(),
        revoked_at: IsNull(),
      },
      { revoked_at: new Date() },
    );
    await tx.update(
      AdminSession,
      { admin_account_id: account.id, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
    await audit(
      tx,
      "admin.local_seed",
      "success",
      { actor: account },
      account.id,
    );
    return {
      email: LOCAL_SUPER_ADMIN_EMAIL,
      password: LOCAL_SUPER_ADMIN_PASSWORD,
      role: AdminRole.SUPER_ADMIN,
      created,
    };
  });
};
