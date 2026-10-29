import fileRoutes from "@src/files/files.route";
import adminRoutes, { superAdminRouter } from "../admin/admin.route";
import authRoutes from "@src/auth/auth.route";
import dashboardRoutes from "@src/dashboard/dashboard.route";
import messagingRoutes from "@src/messaging/messaging.route";
import onboardingRoutes from "@src/onboarding/onboarding.route";
import skillsRoutes from "@src/skills/skills.route";
import talentRoutes from "@src/talents/talent.route";
import userRoutes from "@src/users/users.route";
import { Router } from "express";

const router = Router();

router.use("/admin", adminRoutes);
router.use("/superadmin", superAdminRouter);
router.use("/auth", authRoutes);
router.use("/onboarding", onboardingRoutes);
router.use("/skills", skillsRoutes);
router.use("/users", userRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/talents", talentRoutes);
router.use("/assets", fileRoutes);
router.use("/messages", messagingRoutes);

export default router;
