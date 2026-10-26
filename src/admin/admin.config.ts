import config from "config";
import { AdminRole } from "../entities/adminAccount.entity";
export const adminConfig = (role: AdminRole = AdminRole.ADMIN) => {
  const frontend = new URL(config.get<string>("ADMIN_FRONTEND_URL"));
  const production = config.get<string>("NODE_ENV") === "production";
  if (production && frontend.protocol !== "https:")
    throw new Error("ADMIN_FRONTEND_URL requires HTTPS in production");
  if (
    !["http:", "https:"].includes(frontend.protocol) ||
    frontend.username ||
    frontend.password ||
    frontend.search ||
    frontend.hash
  )
    throw new Error("Invalid ADMIN_FRONTEND_URL");
  return {
    frontend,
    production,
    cookie:
      role === AdminRole.SUPER_ADMIN
        ? "talentboard_superadmin_session"
        : "talentboard_admin_session",
    path: `/${config.get<string>("API_PREFIX")}/${role === AdminRole.SUPER_ADMIN ? "superadmin" : "admin"}`,
    invitationMs: 24 * 60 * 60 * 1000,
    sessionMs: 8 * 60 * 60 * 1000,
    idleMs: 30 * 60 * 1000,
  };
};
