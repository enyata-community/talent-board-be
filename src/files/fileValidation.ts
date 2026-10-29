import { fromBuffer } from "file-type";
import { AppError } from "@src/exceptions/appError";

export const avatarMimeTypes = ["image/jpeg", "image/png", "image/webp"];
export const resumeMimeTypes = ["application/pdf"];

export async function validateFileContents(
  contents: Buffer,
  allowedMimeTypes: string[],
) {
  let detected: Awaited<ReturnType<typeof fromBuffer>>;
  try {
    detected = await fromBuffer(contents);
  } catch {
    throw new AppError("Invalid file contents", 400);
  }
  if (!detected || !allowedMimeTypes.includes(detected.mime)) {
    throw new AppError(
      `File contents must be ${allowedMimeTypes.join(", ")}`,
      400,
    );
  }
  return detected;
}
