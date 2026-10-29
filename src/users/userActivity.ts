import { EntityManager, In, IsNull, LessThan, Or } from "typeorm";
import { UserEntity, UserRole } from "../entities/user.entity";
import logger from "../utils/logger";

export const ACTIVITY_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/** Record authenticated marketplace activity, with at most one write per five minutes. */
export const recordUserActivity = async (
  user: UserEntity,
  manager: EntityManager,
): Promise<void> => {
  if (![UserRole.TALENT, UserRole.RECRUITER].includes(user.role)) return;
  const now = new Date();
  const cutoff = new Date(now.getTime() - ACTIVITY_UPDATE_INTERVAL_MS);
  if (user.last_activity_at && user.last_activity_at >= cutoff) return;

  try {
    // The predicate also throttles concurrent requests across application instances
    // and prevents older requests from overwriting a newer observation.
    const result = await manager.update(
      UserEntity,
      {
        id: user.id,
        role: In([UserRole.TALENT, UserRole.RECRUITER]),
        deleted_at: IsNull(),
        last_activity_at: Or(IsNull(), LessThan(cutoff)),
      },
      {
        last_activity_at: now,
        // Activity must not change the profile's edit timestamp.
        updated_at: () => '"updated_at"',
      },
    );
    if (result.affected) user.last_activity_at = now;
  } catch {
    // Activity metadata must not prevent a successful login or API request.
    logger.warn("Unable to record user activity");
  }
};
