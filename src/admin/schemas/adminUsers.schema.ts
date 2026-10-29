import { z } from "zod";
import { listSchema } from "./admin.schema";

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
