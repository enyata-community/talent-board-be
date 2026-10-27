import { storeUploadedFile } from "@src/files/storeUploadedFile";
import { getFileStorage } from "@src/files/storage/fileStorage";
import log from "@src/utils/logger";
import asyncHandler from "@src/middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { UpdateProfileDTO } from "./schemas/updateProfile.schema";
import { UserService } from "./users.service";

const userService = new UserService();

export const getCurrentUser = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await userService.getCurrentUser(req.user.id);
    res.status(200).json({
      status: "success",
      message: "User fetched successfully",
      data: { user },
    });
  },
);

export const updateProfile = asyncHandler(
  async (req: Request, res: Response) => {
    const user = req.user!;

    const data = req.body as UpdateProfileDTO;
    const avatarKey = req.file
      ? await storeUploadedFile(req.file, "avatars")
      : undefined;
    let updated: Awaited<ReturnType<UserService["updateProfile"]>>;
    try {
      updated = await userService.updateProfile(
        user.id,
        user.role,
        data,
        avatarKey,
      );
    } catch (error) {
      if (avatarKey)
        await getFileStorage()
          .remove(avatarKey)
          .catch((err) =>
            log.error({ err }, "Failed to clean up rejected avatar"),
          );
      throw error;
    }

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully",
      data: updated,
    });
  },
);
