import { EntityManager } from "typeorm";
import AppDataSource from "../datasource";
import { AdminAccount } from "../entities/adminAccount.entity";
import { AdminAuditLog } from "../entities/adminAuditLog.entity";
import { AppError } from "../exceptions/appError";
import log from "../utils/logger";
import { normalizeIp } from "../utils/normalizeIp";
export interface AuditContext {
  actor?: AdminAccount;
  requestId?: string;
  ip?: string;
}
export const audit = async (
  tx: EntityManager,
  action: string,
  outcome: string,
  context: AuditContext = {},
  targetId?: string,
  metadata: Record<string, unknown> = {},
) => {
  await tx.insert(AdminAuditLog, {
    actor_id: context.actor?.id ?? null,
    actor_role: context.actor?.role ?? null,
    action,
    outcome,
    target_id: targetId ?? null,
    request_id: context.requestId ?? null,
    ip_address: normalizeIp(context.ip)?.slice(0, 100) ?? null,
    metadata,
  });
};
// A failed action rolls back its transaction, including the success audit row,
// so the attempt is recorded separately. An audit outage must not mask the error.
export const withFailureAudit = async <T>(
  action: string,
  context: AuditContext,
  targetId: string | undefined,
  run: () => Promise<T>,
  metadata: Record<string, unknown> = {},
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    await audit(
      AppDataSource.manager,
      action,
      statusCode === 401 || statusCode === 403 ? "denied" : "failure",
      context,
      targetId,
      {
        ...metadata,
        status_code: statusCode,
        error: error instanceof AppError ? error.message : "Internal error",
      },
    ).catch((auditError) =>
      log.error({ err: auditError, action }, "Failed to record audit failure"),
    );
    throw error;
  }
};
