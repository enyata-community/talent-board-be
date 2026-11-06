import { z } from "zod";
import { listSchema } from "./admin.schema";
import { SuspensionReason, UserStatus } from "../../entities/user.entity";

export const adminUsersSchema = listSchema
  .extend({
    search: z.string().trim().min(1).max(254).optional(),
    account_type: z.enum(["talent", "recruiter"]).optional(),
    status: z.enum(["active", "suspended"]).optional(),
    sort_by: z.enum(["join_date", "last_activity"]).default("join_date"),
    sort_order: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

export type AdminUsersQuery = z.infer<typeof adminUsersSchema>;

const note = z.string().trim().min(1).max(1000).optional();
// One endpoint sets an explicit target status; it never toggles, so retries and
// concurrent admins cannot flip an account back.
export const userStatusSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal(UserStatus.SUSPENDED),
        reason: z.nativeEnum(SuspensionReason),
        note,
      })
      .strict(),
    z.object({ status: z.literal(UserStatus.ACTIVE), note }).strict(),
  ])
  .refine(
    (value) =>
      value.status !== UserStatus.SUSPENDED ||
      value.reason !== SuspensionReason.OTHER ||
      Boolean(value.note),
    {
      path: ["note"],
      message: "A note is required for OTHER",
    },
  );

export type UserStatusInput = z.infer<typeof userStatusSchema>;
