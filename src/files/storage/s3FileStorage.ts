import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AppError } from "@src/exceptions/appError";
import { Readable } from "stream";
import { normalizeFileKey } from "./fileKey";
import type { FileStorage } from "./fileStorage";

const maxFileBytes = 2 * 1024 * 1024;

export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    region: string,
    client?: S3Client,
  ) {
    // Default credential chain: environment, shared AWS profile, or workload IAM role.
    this.client = client ?? new S3Client({ region, maxAttempts: 3 });
  }

  async put(key: string, contents: Buffer, contentType: string): Promise<void> {
    const normalized = normalizeFileKey(key);
    if (contents.length > maxFileBytes)
      throw new AppError("File exceeds the 2 MiB limit", 413);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: normalized,
          Body: contents,
          ContentType: contentType,
          ContentLength: contents.length,
          IfNoneMatch: "*",
          CacheControl: "private, no-store",
          ContentDisposition: normalized.startsWith("resumes/")
            ? 'attachment; filename="resume.pdf"'
            : "inline",
          // No public ACL: use bucket-owner-enforced ownership and Block Public Access.
        }),
      );
    } catch {
      throw new AppError("Unable to store file in S3", 503);
    }
  }

  async read(key: string): Promise<Buffer> {
    const normalized = normalizeFileKey(key);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: normalized,
          // Bound even existing objects not originally created by this application.
          Range: `bytes=0-${maxFileBytes}`,
        }),
      );
      const body = response.Body;
      if (!(body instanceof Readable))
        throw new AppError("Invalid S3 response body", 503);
      try {
        if ((response.ContentLength ?? 0) > maxFileBytes)
          throw new AppError("Stored file exceeds the 2 MiB limit", 413);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of body) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > maxFileBytes)
            throw new AppError("Stored file exceeds the 2 MiB limit", 413);
          chunks.push(bytes);
        }
        return Buffer.concat(chunks);
      } finally {
        body.destroy();
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      const failure = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        failure.name === "NoSuchKey" ||
        failure.$metadata?.httpStatusCode === 404
      ) {
        throw Object.assign(new Error("File not found"), { code: "ENOENT" });
      }
      throw new AppError("Unable to read file from S3", 503);
    }
  }

  // Remove the file from S3. If the file does not exist, do nothing.
  async remove(key: string): Promise<void> {
    const normalized = normalizeFileKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: normalized }),
      );
    } catch {
      throw new AppError("Unable to delete file from S3", 503);
    }
  }
}
