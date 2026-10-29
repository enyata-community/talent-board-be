import { randomUUID } from "crypto";
import {
  validateFileContents,
  avatarMimeTypes,
  resumeMimeTypes,
} from "./fileValidation";
import { getFileStorage } from "./storage/fileStorage";

export async function storeUploadedFile(
  file: Express.Multer.File,
  kind: "avatars" | "resumes",
) {
  const detected = await validateFileContents(
    file.buffer,
    kind === "avatars" ? avatarMimeTypes : resumeMimeTypes,
  );
  const key = `${kind}/${randomUUID()}.${detected.ext}`;
  await getFileStorage().put(key, file.buffer, detected.mime);
  return key;
}
