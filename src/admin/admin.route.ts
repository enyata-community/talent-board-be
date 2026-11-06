import { Router } from "express";
import { AdminRole } from "../entities/adminAccount.entity";
import { validateData } from "../middlewares/validateData";
import {
  adminRequest,
  authenticateAdmin,
  checkAdminOrigin,
  requireAdminCsrf,
  requireRecentAuth,
  requireSuperAdmin,
  throttleAdmin,
} from "./middlewares/adminSecurity";
import {
  adminAccountsSchema,
  adminRoleSchema,
  adminStatusSchema,
  auditListSchema,
  idSchema,
  invitationSchema,
  listSchema,
  loginSchema,
  reauthenticateSchema,
  setupSchema,
} from "./schemas/admin.schema";
import * as controller from "./admin.controller";
import * as usersController from "./adminUsers.controller";
import * as accountsController from "./adminAccounts.controller";
import {
  adminUsersSchema,
  userStatusSchema,
} from "./schemas/adminUsers.schema";

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
  router.post(
    "/auth/reauthenticate",
    requireAdminCsrf,
    throttleAdmin("reauth", 10),
    validateData(reauthenticateSchema),
    controller.reauthenticate,
  );
  router.patch(
    "/users/:id/status",
    requireAdminCsrf,
    validateData(idSchema, ["params"]),
    validateData(userStatusSchema),
    usersController.changeUserStatus,
  );
  router.get(
    "/users/suspension-reasons",
    usersController.listSuspensionReasons,
  );
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
      requireRecentAuth,
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
      "/admins",
      validateData(adminAccountsSchema, ["query"]),
      accountsController.listAdmins,
    );
    router.patch(
      "/admins/:id/role",
      requireAdminCsrf,
      requireRecentAuth,
      validateData(idSchema, ["params"]),
      validateData(adminRoleSchema),
      accountsController.changeAdminRole,
    );
    router.patch(
      "/admins/:id/status",
      requireAdminCsrf,
      requireRecentAuth,
      validateData(idSchema, ["params"]),
      validateData(adminStatusSchema),
      accountsController.changeAdminStatus,
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
