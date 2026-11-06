import { In } from "typeorm";
import AppDataSource from "../datasource";
import {
  UserEntity,
  UserRole,
  UserStatus,
  SuspensionReason,
} from "../entities/user.entity";
import { AdminRole, AdminStatus } from "../entities/adminAccount.entity";
import { RefreshToken } from "../entities/refreshToken.entity";
import { AppError } from "../exceptions/appError";
import { NotFoundError } from "../exceptions/notFoundError";
import { audit, AuditContext, withFailureAudit } from "./adminAudit.service";
import { roleError } from "./admin.utils";

export const SUSPENSION_REASONS = [
  { value: SuspensionReason.POLICY_VIOLATION, label: "Policy violation" },
  { value: SuspensionReason.FRAUDULENT_PROFILE, label: "Fraudulent profile" },
  { value: SuspensionReason.USER_REQUEST, label: "User request" },
  { value: SuspensionReason.OTHER, label: "Other", note_required: true },
];

export class AdminUserStatusService {
  async change(
    id: string,
    status: UserStatus,
    context: AuditContext,
    reason?: SuspensionReason,
    note?: string,
  ) {
    return withFailureAudit(
      status === UserStatus.SUSPENDED ? "user.suspend" : "user.reactivate",
      context,
      id,
      () => this.apply(id, status, context, reason, note),
      { status, reason: reason ?? null },
    );
  }

  private async apply(
    id: string,
    status: UserStatus,
    context: AuditContext,
    reason?: SuspensionReason,
    note?: string,
  ) {
    if (
      !context.actor ||
      context.actor.status !== AdminStatus.ACTIVE ||
      ![AdminRole.ADMIN, AdminRole.SUPER_ADMIN].includes(context.actor.role)
    )
      throw roleError([AdminRole.ADMIN, AdminRole.SUPER_ADMIN]);
    if (
      status === UserStatus.SUSPENDED &&
      (!reason ||
        !Object.values(SuspensionReason).includes(reason) ||
        (reason === SuspensionReason.OTHER && !note?.trim()))
    )
      throw new AppError(
        "A valid suspension reason is required; OTHER requires a note",
        422,
      );

    return AppDataSource.transaction(async (tx) => {
      const user = await tx.findOne(UserEntity, {
        where: { id, role: In([UserRole.TALENT, UserRole.RECRUITER]) },
        lock: { mode: "pessimistic_write" },
      });
      if (!user) throw new NotFoundError("User account not found");
      if (user.status === status)
        throw new AppError(`Account is already ${status}`, 409);
      const previous = user.status;
      const previousReason = user.suspension_reason;
      const suspended = status === UserStatus.SUSPENDED;
      user.status = status;
      user.suspension_reason = suspended ? reason! : null;
      user.suspension_note = suspended ? (note?.trim() ?? null) : null;
      user.suspended_at = suspended ? new Date() : null;
      user.suspended_by = suspended ? context.actor!.id : null;
      if (suspended) user.session_version += 1;
      await tx.save(user);
      if (suspended)
        await tx.update(
          RefreshToken,
          { user: { id }, is_valid: true },
          { is_valid: false },
        );
      await audit(
        tx,
        suspended ? "user.suspend" : "user.reactivate",
        "success",
        context,
        id,
        {
          account_type: user.role,
          previous_status: previous,
          status,
          reason: suspended ? reason : previousReason,
          note: note?.trim() ?? null,
        },
      );
      return {
        id: user.id,
        account_type: user.role,
        status: user.status,
        suspension_reason: user.suspension_reason,
        suspension_note: user.suspension_note,
        suspended_at: user.suspended_at,
        suspended_by: user.suspended_by,
      };
    });
  }
}
