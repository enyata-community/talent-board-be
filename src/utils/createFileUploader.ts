import { UploadConfig } from "@src/interfaces";
import { validateFileContents } from "@src/files/fileValidation";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";

export const createFileUploader = ({
  fieldname,
  allowedMimeTypes,
  maxSizeMB = 2,
}: UploadConfig) => {
  // Keep uploads in bounded memory until body validation and authorization pass.
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxSizeMB * 1024 * 1024,
      files: 1,
      fields: 30,
      fieldSize: 10 * 1024,
    },
  }).single(fieldname);
  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (error) => {
      if (error)
        return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
          status: "fail",
          message: "Invalid upload or upload limit exceeded",
        });
      if (!req.file) return next();
      validateFileContents(req.file.buffer, allowedMimeTypes)
        .then((detected) => {
          req.file.mimetype = detected.mime;
          next();
        })
        .catch(next);
    });
  };
};
