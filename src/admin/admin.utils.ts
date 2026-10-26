import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { AdminAccount } from "../entities/adminAccount.entity";
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
