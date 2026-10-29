import { Router } from "express";
import { AdminRole } from "../entities/adminAccount.entity";
import { validateData } from "../middlewares/validateData";
import {
  adminRequest,
  authenticateAdmin,
  checkAdminOrigin,
  requireAdminCsrf,
  requireSuperAdmin,
  throttleAdmin,
} from "./middlewares/adminSecurity";
import {
  auditListSchema,
  idSchema,
  invitationSchema,
  listSchema,
  loginSchema,
  setupSchema,
} from "./schemas/admin.schema";
import * as controller from "./admin.controller";
import * as usersController from "./adminUsers.controller";
import { adminUsersSchema } from "./schemas/adminUsers.schema";

// The realm is assigned by server-side route mounting, never client input.
export const createAdminRouter = (role: AdminRole) => {
  const router = Router();
  router.use((req, _res, next) => {
    req.adminRealm = role;
    next();
  });
  router.use(adminRequest, checkAdminOrigin);
  // Share limits across realms so switching login URLs cannot bypass throttles.
  router.post(
    "/auth/login",
    throttleAdmin("login", 10, true),
    validateData(loginSchema),
    controller.login,
  );
  router.post(
    "/auth/setup-password",
    throttleAdmin("setup", 10),
    validateData(setupSchema),
    controller.setupPassword,
  );
  router.post("/auth/logout", controller.logout);
  router.use(authenticateAdmin);
  router.get("/auth/me", controller.me);
  router.get(
    "/users",
    validateData(adminUsersSchema, ["query"]),
    usersController.listUsers,
  );
  router.get(
    "/users/:id",
    validateData(idSchema, ["params"]),
    validateData(listSchema, ["query"]),
    usersController.getUser,
  );
  if (role === AdminRole.SUPER_ADMIN) {
    router.use(requireSuperAdmin);
    router.get(
      "/invitations",
      validateData(listSchema, ["query"]),
      controller.listInvitations,
    );
    router.post(
      "/invitations",
      requireAdminCsrf,
      throttleAdmin("invite", 20),
      validateData(invitationSchema),
      controller.invite,
    );
    router.post(
      "/invitations/:id/resend",
      requireAdminCsrf,
      throttleAdmin("resend", 10),
      validateData(idSchema, ["params"]),
      controller.resend,
    );
    router.delete(
      "/invitations/:id",
      requireAdminCsrf,
      validateData(idSchema, ["params"]),
      controller.revoke,
    );
    router.get(
      "/audit-logs",
      validateData(auditListSchema, ["query"]),
      controller.listAudit,
    );
  }
  return router;
};
export const superAdminRouter = createAdminRouter(AdminRole.SUPER_ADMIN);
export default createAdminRouter(AdminRole.ADMIN);
