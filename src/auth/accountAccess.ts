import {
  UserEntity,
  UserStatus,
  isInternalRole,
} from "../entities/user.entity";
import { UnauthorizedError } from "../exceptions/unauthorizedError";

export const assertAccountAccess = (
  user: UserEntity | null,
  sessionVersion?: number,
) => {
  if (
    !user ||
    isInternalRole(user.role) ||
    user.status === UserStatus.SUSPENDED ||
    (sessionVersion !== undefined &&
      (user.session_version ?? 0) !== sessionVersion)
  )
    throw new UnauthorizedError(
      "Account access denied. Please log in again or contact support.",
    );
};
