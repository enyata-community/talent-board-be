import { EntityManager, IsNull } from "typeorm";
import AppDataSource from "../datasource";
import {
  AdminAccount,
  AdminRole,
  AdminStatus,
} from "../entities/adminAccount.entity";
import { AdminInvitation } from "../entities/adminInvitation.entity";
import { AdminSession } from "../entities/adminSession.entity";
import { UserEntity, UserRole } from "../entities/user.entity";
import { AppError } from "../exceptions/appError";
import { NotFoundError } from "../exceptions/notFoundError";
import { assertActiveSuperAdmin, adminDto } from "./admin.utils";
import { audit, AuditContext, withFailureAudit } from "./adminAudit.service";
import { adminAccountQuery, findAdminAccount } from "./adminIdentity.service";
import { AdminAccountsQuery } from "./schemas/admin.schema";

// Must match the limit enforced by the AddAdminRoleLifecycle migration trigger.
export const MAX_SUPER_ADMINS = 2;

// Same advisory lock as the database trigger, so checks and writes serialize.
export const lockSuperAdminSlots = (tx: EntityManager) =>
  tx.query("SELECT pg_advisory_xact_lock(812744002)");

const usedSlots = async (tx: EntityManager, excludeUserId?: string) =>
  (
    await tx.query("SELECT talentboard_super_admin_slots($1) AS slots", [
      excludeUserId ?? null,
    ])
  )[0].slots as number;

export const assertSuperAdminSlot = async (
  tx: EntityManager,
  excludeUserId?: string,
) => {
  await lockSuperAdminSlots(tx);
  if ((await usedSlots(tx, excludeUserId)) >= MAX_SUPER_ADMINS)
    throw new AppError(
      `Super Admin limit reached (maximum ${MAX_SUPER_ADMINS}, including pending invitations)`,
      409,
    );
};

const otherActiveSuperAdmins = (tx: EntityManager, userId: string) =>
  adminAccountQuery(tx)
    .where("identity.role = :role", { role: AdminRole.SUPER_ADMIN })
    .andWhere("account.status = :status", { status: AdminStatus.ACTIVE })
    .andWhere("identity.id <> :userId", { userId })
    .getCount();

// Privilege changes end every session immediately rather than on next request.
const revokeSessions = (tx: EntityManager, accountId: string) =>
  tx.update(
    AdminSession,
    { admin_account_id: accountId, revoked_at: IsNull() },
    { revoked_at: new Date() },
  );

const accountDto = (account: AdminAccount) => ({
  ...adminDto(account),
  status: account.status,
  last_login_at: account.last_login_at,
  created_at: account.created_at,
});

export class AdminAccountService {
  async list(query: AdminAccountsQuery) {
    const qb = adminAccountQuery(AppDataSource.manager);
    if (query.role) qb.andWhere("identity.role = :role", { role: query.role });
    if (query.status)
      qb.andWhere("account.status = :status", { status: query.status });
    const [items, total] = await qb
      .orderBy("account.created_at", "DESC")
      .addOrderBy("account.id", "DESC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: items.map(accountDto),
      total,
      page: query.page,
      limit: query.limit,
      super_admin_slots: {
        used: await usedSlots(AppDataSource.manager),
        max: MAX_SUPER_ADMINS,
      },
    };
  }

  async changeRole(id: string, role: AdminRole, context: AuditContext) {
    return withFailureAudit(
      "admin.role.change",
      context,
      id,
      () => {
        assertActiveSuperAdmin(context.actor);
        if (id === context.actor!.id)
          throw new AppError("You cannot change your own role", 403);
        return AppDataSource.transaction(async (tx) => {
          await lockSuperAdminSlots(tx);
          const account = await findAdminAccount(tx, id, true);
          if (!account) throw new NotFoundError("Admin account not found");
          if (account.status !== AdminStatus.ACTIVE)
            throw new AppError(
              "Only active admin accounts can change role",
              409,
            );
          const previous = account.role;
          if (previous === role)
            throw new AppError(`Admin account is already ${role}`, 409);
          if (role === AdminRole.SUPER_ADMIN)
            await assertSuperAdminSlot(tx, account.user_id);
          else if ((await otherActiveSuperAdmins(tx, account.user_id)) < 1)
            throw new AppError(
              "At least one active Super Admin must remain",
              409,
            );
          await tx.update(
            UserEntity,
            { id: account.user_id },
            { role: role as unknown as UserRole },
          );
          await revokeSessions(tx, account.id);
          await audit(tx, "admin.role.change", "success", context, id, {
            previous_role: previous,
            role,
          });
          account.user.role = role as unknown as UserRole;
          return accountDto(account);
        });
      },
      { role },
    );
  }

  async deactivate(id: string, context: AuditContext) {
    return withFailureAudit("admin.deactivate", context, id, () => {
      assertActiveSuperAdmin(context.actor);
      if (id === context.actor!.id)
        throw new AppError("You cannot deactivate your own account", 403);
      return AppDataSource.transaction(async (tx) => {
        await lockSuperAdminSlots(tx);
        const account = await findAdminAccount(tx, id, true);
        if (!account) throw new NotFoundError("Admin account not found");
        if (account.status === AdminStatus.DISABLED)
          throw new AppError("Admin account is already disabled", 409);
        if (
          account.role === AdminRole.SUPER_ADMIN &&
          account.status === AdminStatus.ACTIVE &&
          (await otherActiveSuperAdmins(tx, account.user_id)) < 1
        )
          throw new AppError(
            "At least one active Super Admin must remain",
            409,
          );
        const previous = account.status;
        await tx.update(AdminAccount, { id }, { status: AdminStatus.DISABLED });
        await revokeSessions(tx, id);
        // A disabled pending account must not keep a usable setup link.
        await tx.update(
          AdminInvitation,
          { admin_account_id: id, accepted_at: IsNull(), revoked_at: IsNull() },
          { revoked_at: new Date() },
        );
        await audit(tx, "admin.deactivate", "success", context, id, {
          role: account.role,
          previous_status: previous,
        });
        account.status = AdminStatus.DISABLED;
        return accountDto(account);
      });
    });
  }
}
