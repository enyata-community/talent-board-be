import { z } from "zod";
export const email = z.string().trim().toLowerCase().email().max(254);
export const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
const nameFields = {
  first_name: z.string().trim().min(1).max(50).optional(),
  last_name: z.string().trim().min(1).max(50).optional(),
};
export const invitationSchema = z
  .object({
    email,
    display_name: z.string().trim().min(1).max(100).optional(),
    ...nameFields,
  })
  .strict();
export const setupSchema = z
  .object({
    ...nameFields,
    token: z.string().regex(/^[a-f0-9]{64}$/),
    password: z.string().min(8).max(128),
    display_name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export const idSchema = z.object({ id: z.string().uuid() });
export const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export const auditListSchema = listSchema
  .extend({
    actor_id: z.string().uuid().optional(),
    action: z.string().max(100).optional(),
    outcome: z.enum(["success", "failure", "denied"]).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "Invalid date range");
