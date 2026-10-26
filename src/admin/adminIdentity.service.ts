import { EntityManager } from "typeorm";
import {
  AdminAccount,
  AdminRole,
  AdminStatus,
} from "../entities/adminAccount.entity";
import { UserEntity, UserProvider, UserRole } from "../entities/user.entity";
import { AppError } from "../exceptions/appError";

export const adminAccountQuery = (tx: EntityManager) =>
  tx
    .getRepository(AdminAccount)
    .createQueryBuilder("account")
    .innerJoinAndSelect("account.user", "identity");
export const findAdminAccount = (
  tx: EntityManager,
  id: string,
  lock = false,
) => {
  const query = adminAccountQuery(tx).where("account.id = :id", { id });
  if (lock) query.setLock("pessimistic_write");
  return query.getOne();
};
export const namesFromDisplay = (displayName?: string) => {
  if (!displayName) return { first_name: null, last_name: null };
  const [first, ...rest] = displayName.trim().split(/\s+/);
  const last = rest.join(" ") || null;
  if (first.length > 50 || (last && last.length > 50))
    throw new AppError(
      "First and last names must each be at most 50 characters",
      422,
    );
  return { first_name: first, last_name: last };
};
export interface IdentityNames {
  first_name?: string;
  last_name?: string;
}
export const identityNames = (displayName?: string, names?: IdentityNames) => ({
  ...(displayName ? namesFromDisplay(displayName) : {}),
  ...(names?.first_name !== undefined ? { first_name: names.first_name } : {}),
  ...(names?.last_name !== undefined ? { last_name: names.last_name } : {}),
});
export const createAdminIdentity = async (
  tx: EntityManager,
  email: string,
  role: AdminRole,
  displayName?: string,
  names?: IdentityNames,
) => {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    email,
  ]);
  const existing = await tx
    .getRepository(UserEntity)
    .createQueryBuilder("identity")
    .withDeleted()
    .where("lower(identity.email) = :email", { email })
    .getOne();
  if (existing)
    throw new AppError("An account with this email already exists", 409);
  const user = await tx.save(
    UserEntity,
    tx.create(UserEntity, {
      email,
      role: role as unknown as UserRole,
      provider: UserProvider.LOCAL,
      first_name: null,
      last_name: null,
      ...identityNames(displayName, names),
      profile_completed: false,
      is_email_verified: false,
      incomplete_signup_next_reminder_at: null,
    }),
  );
  return tx.save(
    AdminAccount,
    tx.create(AdminAccount, {
      user_id: user.id,
      user,
      status: AdminStatus.PENDING,
    }),
  );
};
