import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { incrementAuthCounter } from "./authSecurityStore";
import asyncHandler from "@src/middlewares/asyncHandler";

// Postgres increments atomically across instances; failures never bypass limits.
export const authRateLimit = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const windowSeconds = 900;
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const keys = [`auth-limit:ip:${req.ip}:${bucket}`];
    if (typeof req.body?.email === "string") {
      const email = createHash("sha256")
        .update(req.body.email.trim().toLowerCase())
        .digest("hex");
      keys.push(`auth-limit:email:${email}:${bucket}`);
    }
    for (const key of keys) {
      const count = await incrementAuthCounter(key, windowSeconds);
      if (count > (key.includes(":email:") ? 20 : 100)) {
        res.setHeader(
          "Retry-After",
          String(
            windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds),
          ),
        );
        return res.status(429).json({
          status: "error",
          message: "Too many authentication attempts. Please try again later.",
        });
      }
    }
    next();
  },
);
