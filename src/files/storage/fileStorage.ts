import { S3FileStorage } from "./s3FileStorage";
import { normalizeFileKey } from "./fileKey";
export { normalizeFileKey } from "./fileKey";
import { promises as fs, constants } from "fs";
import path from "path";
import config from "config";
import { AppError } from "@src/exceptions/appError";

// Cloud adapters must preserve these private object-key semantics. No public URLs
// or caller-supplied filesystem paths are accepted by the storage layer.
export interface FileStorage {
  put(key: string, contents: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalFileStorage implements FileStorage {
  constructor(
    private readonly root = process.env.PRIVATE_UPLOADS_DIR ||
      "private-uploads",
    private readonly legacyRoot = "uploads",
  ) {}

  private filename(key: string) {
    return path.resolve(this.root, normalizeFileKey(key));
  }

  async put(
    key: string,
    contents: Buffer,
    _contentType: string,
  ): Promise<void> {
    const filename = this.filename(key);
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await fs.writeFile(filename, contents, { flag: "wx", mode: 0o600 });
  }

  async read(key: string): Promise<Buffer> {
    const normalized = normalizeFileKey(key);
    // O_NOFOLLOW prevents a symlink at the file itself from escaping storage.
    const read = async (filename: string) => {
      const handle = await fs.open(
        filename,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const real = await fs.realpath(filename);
        const root = await fs.realpath(path.dirname(path.dirname(filename)));
        if (!real.startsWith(`${root}${path.sep}`))
          throw new AppError("Invalid file reference", 404);
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
          throw new AppError("Invalid file", 404);
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    };
    try {
      return await read(this.filename(normalized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return read(path.resolve(this.legacyRoot, normalized));
    }
  }

  async remove(key: string): Promise<void> {
    await fs
      .unlink(this.filename(key))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
}

let s3Storage: S3FileStorage | undefined;
export function getFileStorage(): FileStorage {
  const production = config.get<string>("NODE_ENV") === "production";
  const provider =
    process.env.FILE_STORAGE_PROVIDER || (production ? "s3" : "local");
  if (provider === "s3") {
    const bucket = process.env.S3_BUCKET_NAME?.trim();
    const region = process.env.AWS_REGION?.trim();
    if (
      !bucket ||
      !region ||
      bucket.startsWith("your_") ||
      region.startsWith("your_")
    ) {
      throw new AppError(
        "S3_BUCKET_NAME and AWS_REGION must be configured",
        503,
      );
    }
    s3Storage ??= new S3FileStorage(bucket, region);
    return s3Storage;
  }
  if (provider === "local" && !production) return new LocalFileStorage();
  throw new AppError(
    "File storage is not configured for this environment",
    503,
  );
}
