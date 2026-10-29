import { storeUploadedFile } from "@src/files/storeUploadedFile";
import { getFileStorage } from "@src/files/storage/fileStorage";
import AppDataSource from "@src/datasource";
import { UserRole } from "@src/entities/user.entity";
import {
  OnboardingPayload,
  RecruiterPayload,
  TalentPayload,
} from "@src/interfaces";
import asyncHandler from "@src/middlewares/asyncHandler";
import { createSendToken } from "@src/utils/createSendToken";
import { EmailService } from "@src/utils/email";
import log from "@src/utils/logger";
import config from "config";
import { NextFunction, Request, Response } from "express";
import { OnboardingService } from "./onboarding.service";

const service = new OnboardingService();

export const createOnboardingHandler = <T extends OnboardingPayload>(
  role: UserRole,
  formatPayload: (req: Request) => T,
) =>
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const entityManager = AppDataSource.manager;
    const userId = req.user.id;
    const payload = formatPayload(req);
    let storedKey: string | undefined;
    let persisted = false;

    try {
      if (role === UserRole.TALENT && req.file) {
        storedKey = await storeUploadedFile(req.file, "resumes");
        (payload as TalentPayload).resume_path = storedKey;
      }
      const updatedUser = await service.onboardUser(userId, payload, role);
      persisted = true;

      const firstName = updatedUser.first_name || "there";
      const audience = role === UserRole.RECRUITER ? "recruiter" : "talent";
      const frontendUrl =
        config.get<string>("FRONTEND_URL") || "http://localhost:3000";
      const getStartedUrl = `${frontendUrl.replace(/\/$/, "")}/dashboard`;

      await EmailService.sendWelcome(
        updatedUser.email,
        getStartedUrl,
        firstName,
        audience,
      ).catch((error) => {
        // Welcome email failure should not block successful onboarding.
        log.error(
          { err: error, userId: updatedUser.id, email: updatedUser.email },
          "Failed to send welcome email after onboarding",
        );
      });

      await createSendToken(
        updatedUser,
        200,
        `${role.charAt(0).toUpperCase() + role.slice(1)} onboarded successfully`,
        req,
        res,
        entityManager,
      );
    } catch (error) {
      if (storedKey && !persisted) {
        await getFileStorage()
          .remove(storedKey)
          .catch((cleanupError) =>
            log.error(
              { err: cleanupError },
              "Failed to clean up rejected upload",
            ),
          );
      }
      throw error;
    }
  });

export const onboardTalent = createOnboardingHandler<TalentPayload>(
  UserRole.TALENT,
  (req) => ({
    ...req.body,
    resume_path: "",
  }),
);

export const onboardRecruiter = createOnboardingHandler<RecruiterPayload>(
  UserRole.RECRUITER,
  (req) => ({
    ...req.body,
  }),
);
