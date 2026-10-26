import { AdminAccount, AdminRole } from "../entities/adminAccount.entity";
import { AdminSession } from "../entities/adminSession.entity";
import { CustomJwtPayload } from "../interfaces";

declare global {
  namespace Express {
    interface User extends CustomJwtPayload {}

    interface Request {
      user?: User;
      admin?: AdminAccount;
      adminSession?: AdminSession;
      adminRequestId?: string;
      adminRealm?: AdminRole;
    }
  }
}
