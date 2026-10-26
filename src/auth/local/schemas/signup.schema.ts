import { z } from "zod";

export const signupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Invalid email format"),

    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be at most 128 characters")
      .regex(/[a-z]/, "Password must include a lowercase letter")
      .regex(/[A-Z]/, "Password must include an uppercase letter")
      .regex(/\d/, "Password must include a number")
      .regex(/[@$!%*?&]/, "Password must include a special character"),

    confirm_password: z.string(),
  })
  .strict()
  .refine((data) => data.password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export type LocalSignupRequest = z.infer<typeof signupSchema>;
export type LocalSignupDTO = Omit<LocalSignupRequest, "confirm_password">;
