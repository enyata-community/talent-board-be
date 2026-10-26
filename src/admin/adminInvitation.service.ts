import { UserEntity, isInternalRole } from "../entities/user.entity";
import {
  adminAccountQuery,
  findAdminAccount,
  createAdminIdentity,
  identityNames,
  IdentityNames,
} from "./adminIdentity.service";
import { hash } from "argon2";
import { IsNull } from "typeorm";
import AppDataSource from "../datasource";
import {
  AdminAccount,
  AdminRole,
  AdminStatus,
} from "../entities/adminAccount.entity";
import { AdminInvitation } from "../entities/adminInvitation.entity";
import { AppError } from "../exceptions/appError";
import { EmailService } from "../utils/email";
import { adminConfig } from "./admin.config";
import { audit, AuditContext } from "./adminAudit.service";
import { digest, secret } from "./admin.utils";

export class AdminInvitationService {
  private async createInvitation(
    tx: typeof AppDataSource.manager,
    account: AdminAccount,
    actor?: AdminAccount,
  ) {
    await tx.update(
      AdminInvitation,
      {
        admin_account_id: account.id,
        accepted_at: IsNull(),
        revoked_at: IsNull(),
      },
      { revoked_at: new Date() },
    );
    const token = secret();
    const invitation = await tx.save(
      AdminInvitation,
      tx.create(AdminInvitation, {
        admin_account_id: account.id,
        invited_by_admin_id: actor?.id ?? null,
        token_hash: digest(token),
        expires_at: new Date(Date.now() + adminConfig().invitationMs),
        delivery_status: "pending",
      }),
    );
    return { invitation, token, email: account.email, role: account.role };
  }

  private async deliver(result: {
    invitation: AdminInvitation;
    token: string;
    email: string;
    role: AdminRole;
  }) {
    const url = new URL(adminConfig().frontend.toString());
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${result.role === AdminRole.SUPER_ADMIN ? "superadmin" : "admin"}/setup-password`;
    url.hash = new URLSearchParams({ token: result.token }).toString();
    let status = "sent";
    try {
      await EmailService.sendAdminInvitation(result.email, url.toString());
    } catch {
      status = "failed";
    }
    await AppDataSource.transaction(async (tx) => {
      await tx.update(
        AdminInvitation,
        { id: result.invitation.id },
        { delivery_status: status },
      );
      await audit(
        tx,
        "admin.invitation.delivery",
        status === "sent" ? "success" : "failure",
        {},
        result.invitation.id,
      );
    });
    return {
      id: result.invitation.id,
      admin_account_id: result.invitation.admin_account_id,
      expires_at: result.invitation.expires_at,
      delivery_status: status,
    };
  }

  async bootstrap(email: string, retry = false) {
    adminConfig();
    const result = await AppDataSource.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(812744001)");
      const existing = await adminAccountQuery(tx)
        .where("identity.role = :role", { role: AdminRole.SUPER_ADMIN })
        .getOne();
      if (existing) {
        if (
          !retry ||
          existing.email !== email ||
          existing.status !== AdminStatus.PENDING
        )
          throw new AppError(
            "Super Admin already exists; bootstrap cannot change credentials",
            409,
          );
        const invitation = await this.createInvitation(tx, existing);
        await audit(tx, "admin.bootstrap.retry", "success", {}, existing.id);
        return invitation;
      }
      if (retry) throw new AppError("No pending Super Admin to retry", 409);
      const account = await createAdminIdentity(
        tx,
        email,
        AdminRole.SUPER_ADMIN,
      );
      const invitation = await this.createInvitation(tx, account);
      await audit(tx, "admin.bootstrap", "success", {}, account.id);
      return invitation;
    });
    return this.deliver(result);
  }

  async invite(
    email: string,
    displayName: string | undefined,
    context: AuditContext,
    names?: IdentityNames,
  ) {
    this.requireSuperAdmin(context);
    adminConfig();
    const result = await AppDataSource.transaction(async (tx) => {
      const account = await createAdminIdentity(
        tx,
        email,
        AdminRole.ADMIN,
        displayName,
        names,
      );
      const invitation = await this.createInvitation(
        tx,
        account,
        context.actor,
      );
      await audit(
        tx,
        "admin.invitation.create",
        "success",
        context,
        invitation.invitation.id,
      );
      return invitation;
    });
    return this.deliver(result);
  }

  async change(id: string, resend: boolean, context: AuditContext) {
    this.requireSuperAdmin(context);
    if (resend) adminConfig();
    const result = await AppDataSource.transaction(async (tx) => {
      const invitation = await tx.findOne(AdminInvitation, {
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!invitation) throw new AppError("Invitation not found", 404);
      const account = await findAdminAccount(
        tx,
        invitation.admin_account_id,
        true,
      );
      if (!account || account.role !== AdminRole.ADMIN)
        throw new AppError("Invitation cannot be managed here", 403);
      if (
        invitation.accepted_at ||
        invitation.revoked_at ||
        account.status !== AdminStatus.PENDING
      )
        throw new AppError("Invitation is no longer pending", 409);
      await tx.update(AdminInvitation, { id }, { revoked_at: new Date() });
      await audit(
        tx,
        resend ? "admin.invitation.resend" : "admin.invitation.revoke",
        "success",
        context,
        id,
      );
      return resend ? this.createInvitation(tx, account, context.actor) : null;
    });
    return result ? this.deliver(result) : undefined;
  }

  async setup(
    token: string,
    password: string,
    displayName: string | undefined,
    context: AuditContext,
    expectedRole?: AdminRole,
    names?: IdentityNames,
  ) {
    const passwordHash = await hash(password);
    try {
      await AppDataSource.transaction(async (tx) => {
        const invitation = await tx.findOne(AdminInvitation, {
          where: { token_hash: digest(token) },
          lock: { mode: "pessimistic_write" },
        });
        if (
          !invitation ||
          invitation.accepted_at ||
          invitation.revoked_at ||
          invitation.expires_at <= new Date()
        )
          throw new AppError("Invalid or expired invitation", 400);
        const account = await findAdminAccount(
          tx,
          invitation.admin_account_id,
          true,
        );
        if (
          !account ||
          account.status !== AdminStatus.PENDING ||
          !isInternalRole(account.user.role) ||
          (expectedRole && account.role !== expectedRole)
        )
          throw new AppError("Invalid or expired invitation", 400);
        await tx.update(
          AdminAccount,
          { id: account.id },
          {
            password_set_at: new Date(),
            status: AdminStatus.ACTIVE,
          },
        );
        await tx.update(
          UserEntity,
          { id: account.user_id },
          {
            password: passwordHash,
            is_email_verified: true,
            ...(displayName ||
            names?.first_name !== undefined ||
            names?.last_name !== undefined
              ? identityNames(displayName, names)
              : {}),
          },
        );
        await tx.update(
          AdminInvitation,
          { id: invitation.id },
          { accepted_at: new Date() },
        );
        await audit(
          tx,
          "admin.password.setup",
          "success",
          { ...context, actor: account },
          account.id,
        );
      });
    } catch (error) {
      if (error instanceof AppError)
        await audit(
          AppDataSource.manager,
          "admin.password.setup",
          "failure",
          context,
        );
      throw error;
    }
  }

  private requireSuperAdmin(context: AuditContext) {
    if (
      context.actor?.role !== AdminRole.SUPER_ADMIN ||
      context.actor.status !== AdminStatus.ACTIVE
    )
      throw new AppError("Super Admin required", 403);
  }
}
