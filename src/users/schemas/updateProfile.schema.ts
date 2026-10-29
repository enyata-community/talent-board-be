import { z } from "zod";

export const updateProfileSchema = z.object({
  first_name: z.string().min(1).max(50),
  last_name: z.string().min(1).max(50),
  bio: z.string().max(250).optional(),
  avatar: z.never().optional(),
});

export type UpdateProfileDTO = Omit<
  z.infer<typeof updateProfileSchema>,
  "avatar"
>;
