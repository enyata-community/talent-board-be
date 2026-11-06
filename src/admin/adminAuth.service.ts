import { verify, hash } from "argon2";
import { IsNull } from "typeorm";
import AppDataSource from "../datasource";
import {
  AdminAccount,
  AdminRole,
  AdminStatus,
} from "../entities/adminAccount.entity";
import { adminAccountQuery, findAdminAccount } from "./adminIdentity.service";
import { isInternalRole } from "../entities/user.entity";
import { AdminSession } from "../entities/adminSession.entity";
import { AdminAuthThrottle } from "../entities/adminAuthThrottle.entity";
import { AppError } from "../exceptions/appError";
import { adminConfig } from "./admin.config";
import { audit, AuditContext } from "./adminAudit.service";
import { digest, secret, sessionTokenError } from "./admin.utils";

// A fixed-cost dummy verification prevents the missing-account path skipping Argon2.
let dummyHash: Promise<string> | undefined;
// Failures are counted per normalized email whether or not an account exists,
// so lockouts do not reveal which emails belong to admins.
const lockoutKey = (email: string) =>
  `lockout:email:${digest(email.trim().toLowerCase())}`;

export class AdminAuthService {
  private async assertNotLocked(
    email: string,
    context: AuditContext,
    action: string,
  ) {
    const row = await AppDataSource.manager.findOneBy(AdminAuthThrottle, {
      key: lockoutKey(email),
    });
    const remaining = row ? row.expires_at.getTime() - Date.now() : 0;
    if (!row || row.attempts < adminConfig().lockoutAttempts || remaining <= 0)
      return;
    await audit(
      AppDataSource.manager,
      "admin.login.locked",
      "denied",
      context,
      undefined,
      {
        attempted_action: action,
      },
    );
    const minutes = Math.ceil(remaining / 60000);
    throw new AppError(
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      429,
    );
  }

  // The window starts at the first failure; reaching the limit restarts it as the lockout.
  private async recordFailure(email: string) {
    const { lockoutAttempts, lockoutMs } = adminConfig();
    await AppDataSource.manager.query(
      `INSERT INTO admin_auth_throttles (key, attempts, expires_at) VALUES ($1, 1, $2)
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN admin_auth_throttles.expires_at <= now() THEN 1
          ELSE admin_auth_throttles.attempts + 1 END,
        expires_at = CASE WHEN admin_auth_throttles.expires_at <= now()
          OR admin_auth_throttles.attempts + 1 >= $3 THEN EXCLUDED.expires_at
          ELSE admin_auth_throttles.expires_at END`,
      [lockoutKey(email), new Date(Date.now() + lockoutMs), lockoutAttempts],
    );
  }

  private clearFailures(email: string) {
    return AppDataSource.manager.delete(AdminAuthThrottle, {
      key: lockoutKey(email),
    });
  }

  async login(
    email: string,
    password: string,
    context: AuditContext,
    expectedRole?: AdminRole,
  ) {
    await this.assertNotLocked(email, context, "login");
    const account = await adminAccountQuery(AppDataSource.manager)
      .where("identity.email = :email", { email })
      .getOne();
    dummyHash ??= hash(secret());
    const valid = await verify(
      account?.user.password ?? (await dummyHash),
      password,
    );
    if (
      !valid ||
      !account ||
      !isInternalRole(account.user.role) ||
      account.status !== AdminStatus.ACTIVE ||
      (expectedRole && account.role !== expectedRole)
    ) {
      await this.recordFailure(email);
      await audit(AppDataSource.manager, "admin.login", "failure", context);
      throw new AppError("Invalid email or password", 401);
    }
    const token = secret();
    const csrfToken = secret();
    const settings = adminConfig();
    const now = Date.now();
    const session = await AppDataSource.transaction(async (tx) => {
      // Recheck status under lock so concurrent disabling cannot create a valid session.
      const current = await findAdminAccount(tx, account.id, true);
      if (
        !current ||
        !isInternalRole(current.user.role) ||
        current.status !== AdminStatus.ACTIVE ||
        (expectedRole && current.role !== expectedRole)
      )
        throw new AppError("Invalid email or password", 401);
      const saved = await tx.save(
        AdminSession,
        tx.create(AdminSession, {
          admin_account_id: account.id,
          token_hash: digest(token),
          csrf_token: csrfToken,
          last_seen_at: new Date(now),
          reauthenticated_at: new Date(now),
          idle_expires_at: new Date(now + settings.idleMs),
          expires_at: new Date(now + settings.sessionMs),
        }),
      );
      await tx.update(
        AdminAccount,
        { id: account.id },
        { last_login_at: new Date(now) },
      );
      await audit(tx, "admin.login", "success", { ...context, actor: current });
      return saved;
    });
    await this.clearFailures(email);
    return { account, token, csrfToken, session };
  }

  // Step-up: confirms the password on an existing session before sensitive actions.
  async reauthenticate(
    session: AdminSession,
    account: AdminAccount,
    password: string,
    context: AuditContext,
  ) {
    const actorContext = { ...context, actor: account };
    await this.assertNotLocked(account.email, actorContext, "reauthenticate");
    if (!(await verify(account.user.password, password))) {
      await this.recordFailure(account.email);
      await audit(
        AppDataSource.manager,
        "admin.reauthenticate",
        "failure",
        actorContext,
        account.id,
      );
      throw new AppError("Incorrect password", 403);
    }
    const now = new Date();
    await AppDataSource.transaction(async (tx) => {
      await tx.update(
        AdminSession,
        { id: session.id },
        { reauthenticated_at: now },
      );
      await audit(
        tx,
        "admin.reauthenticate",
        "success",
        actorContext,
        account.id,
      );
    });
    await this.clearFailures(account.email);
    return new Date(now.getTime() + adminConfig().stepUpMs);
  }

  async authenticate(token: string, expectedRole?: AdminRole) {
    if (!token) throw sessionTokenError(expectedRole, true);
    if (!/^[a-f0-9]{64}$/.test(token)) throw sessionTokenError(expectedRole);
    return AppDataSource.transaction(async (tx) => {
      const session = await tx
        .getRepository(AdminSession)
        .createQueryBuilder("session")
        .addSelect("session.csrf_token")
        .where("session.token_hash = :hash", { hash: digest(token) })
        .setLock("pessimistic_write")
        .getOne();
      const now = Date.now();
      if (
        !session ||
        session.revoked_at ||
        session.expires_at.getTime() <= now ||
        session.idle_expires_at.getTime() <= now
      )
        throw sessionTokenError(expectedRole);
      const account = await findAdminAccount(tx, session.admin_account_id);
      if (
        !account ||
        account.status !== AdminStatus.ACTIVE ||
        !isInternalRole(account.user.role) ||
        (expectedRole && account.role !== expectedRole)
      )
        throw sessionTokenError(expectedRole);
      await tx.update(
        AdminSession,
        { id: session.id },
        {
          last_seen_at: new Date(now),
          idle_expires_at: new Date(
            Math.min(now + adminConfig().idleMs, session.expires_at.getTime()),
          ),
        },
      );
      return { account, session };
    });
  }

  async logout(session: AdminSession, context: AuditContext) {
    await AppDataSource.transaction(async (tx) => {
      // Login takes this same account lock. A concurrent login either commits
      // before logout and is revoked, or starts a fresh session after logout.
      const account = await findAdminAccount(
        tx,
        session.admin_account_id,
        true,
      );
      if (!account) return;
      const current = await tx.findOne(AdminSession, {
        where: { id: session.id, admin_account_id: account.id },
        lock: { mode: "pessimistic_write" },
      });
      const now = new Date();
      // Recheck under the lock: replaying an old logout must not terminate a
      // fresh session created after an earlier logout completed.
      if (
        !current ||
        current.revoked_at ||
        current.expires_at <= now ||
        current.idle_expires_at <= now
      )
        return;
      await tx.update(
        AdminSession,
        { admin_account_id: account.id, revoked_at: IsNull() },
        { revoked_at: now },
      );
      await audit(
        tx,
        "admin.logout",
        "success",
        { ...context, actor: account },
        account.id,
      );
    });
  }
}
