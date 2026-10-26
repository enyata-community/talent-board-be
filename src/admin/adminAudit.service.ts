import { EntityManager } from "typeorm";
import { AdminAccount } from "../entities/adminAccount.entity";
import { AdminAuditLog } from "../entities/adminAuditLog.entity";
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
) => {
  await tx.insert(AdminAuditLog, {
    actor_id: context.actor?.id ?? null,
    actor_role: context.actor?.role ?? null,
    action,
    outcome,
    target_id: targetId ?? null,
    request_id: context.requestId ?? null,
    ip_address: context.ip?.slice(0, 100) ?? null,
  });
};
