import { AppError } from "@src/exceptions/appError";

export function normalizeFileKey(
  value: string,
  kind?: "avatars" | "resumes",
): string {
  const key = value.replace(/^\/?uploads\//, "");
  if (
    !/^(avatars|resumes)\/[a-zA-Z0-9_-]+\.(pdf|png|jpg|jpeg|webp)$/.test(key) ||
    (kind && !key.startsWith(`${kind}/`))
  ) {
    throw new AppError("Invalid file reference", 404);
  }
  return key;
}
