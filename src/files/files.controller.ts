import AppDataSource from "@src/datasource";
import { UserEntity, UserRole } from "@src/entities/user.entity";
import { ProfileStatus } from "@src/entities/talentProfile.entity";
import { ForbiddenError } from "@src/exceptions/forbiddenError";
import { NotFoundError } from "@src/exceptions/notFoundError";
import asyncHandler from "@src/middlewares/asyncHandler";
import { getFileStorage, normalizeFileKey } from "./storage/fileStorage";
import {
  validateFileContents,
  avatarMimeTypes,
  resumeMimeTypes,
} from "./fileValidation";

export const downloadResume = asyncHandler(async (req, res) => {
  const isOwner =
    req.user?.id === req.params.id && req.user?.role === UserRole.TALENT;
  const isRecruiter = req.user?.role === UserRole.RECRUITER;
  if (!isOwner && !isRecruiter)
    throw new ForbiddenError("You cannot access this résumé");
  const user = await AppDataSource.manager.findOne(UserEntity, {
    where: { id: req.params.id, role: UserRole.TALENT },
    relations: ["talent_profile"],
  });
  const profile = user?.talent_profile;
  if (
    !profile?.resume_path ||
    (!isOwner &&
      (!user.profile_completed ||
        profile.profile_status !== ProfileStatus.APPROVED))
  ) {
    throw new NotFoundError("Résumé not found");
  }
  const key = normalizeFileKey(profile.resume_path, "resumes");
  let contents: Buffer;
  try {
    contents = await getFileStorage().read(key);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new NotFoundError("Résumé not found");
    throw error;
  }
  await validateFileContents(contents, resumeMimeTypes);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": 'attachment; filename="resume.pdf"',
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  });
  res.send(contents);
});

export const getAvatar = asyncHandler(async (req, res) => {
  const key = normalizeFileKey(`avatars/${req.params.filename}`, "avatars");
  let contents: Buffer;
  try {
    contents = await getFileStorage().read(key);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new NotFoundError("Avatar not found");
    throw error;
  }
  const detected = await validateFileContents(contents, avatarMimeTypes);
  res.set({
    "Content-Type": detected.mime,
    "Content-Disposition": "inline",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  });
  res.send(contents);
});
