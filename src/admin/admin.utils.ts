import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  AdminAccount,
  AdminRole,
  AdminStatus,
} from "../entities/adminAccount.entity";
import { AppError } from "../exceptions/appError";
export const secret = () => randomBytes(32).toString("hex");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const equalSecret = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export const adminDto = (account: AdminAccount) => ({
  id: account.id,
  user_id: account.user_id,
  email: account.email,
  display_name: account.display_name || account.email,
  first_name: account.user?.first_name ?? null,
  last_name: account.user?.last_name ?? null,
  role: account.role,
});
// Name the missing credential, matching the talent/recruiter auth messages.
export const sessionTokenError = (role?: AdminRole, missing = false) => {
  const token =
    role === AdminRole.SUPER_ADMIN
      ? "super admin session token"
      : "admin session token";
  return new AppError(
    missing
      ? `Missing ${token}. Please log in.`
      : `Invalid ${token}! Please log in again.`,
    401,
  );
};
export const csrfTokenError = (missing: boolean) =>
  new AppError(
    missing
      ? "Missing CSRF token. Send the x-admin-csrf header returned by login or auth/me."
      : "Invalid CSRF token! Send the x-admin-csrf value from your latest login or auth/me.",
    403,
  );
export const roleError = (roles: AdminRole[]) =>
  new AppError(`Access denied. Requires role: ${roles.join(", ")}`, 403);
export const assertActiveSuperAdmin = (actor?: AdminAccount) => {
  if (
    actor?.role !== AdminRole.SUPER_ADMIN ||
    actor.status !== AdminStatus.ACTIVE
  )
    throw roleError([AdminRole.SUPER_ADMIN]);
};
