import type { NextFunction, Request, Response } from "express";

export const injectResumePath = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  // The schema requires an upload; ignore any path supplied by the client.
  req.body.resume_path = req.file ? "pending-upload" : undefined;
  next();
};
