import { Readable } from "stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { S3FileStorage } from "@src/files/storage/s3FileStorage";
import {
  getFileStorage,
  LocalFileStorage,
} from "@src/files/storage/fileStorage";
import config from "config";

const send = jest.fn();
const storage = () =>
  new S3FileStorage("private-bucket", "eu-west-1", {
    send,
  } as unknown as S3Client);
const names = ["FILE_STORAGE_PROVIDER", "S3_BUCKET_NAME", "AWS_REGION"];
const original = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
beforeEach(() => {
  jest.clearAllMocks();
  names.forEach((name) => delete process.env[name]);
});
afterEach(() => {
  jest.restoreAllMocks();
  names.forEach((name) => {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  });
});

test("uploads use private bucket keys, fixed metadata, and refuse overwrites", async () => {
  send.mockResolvedValue({});
  const contents = Buffer.from("%PDF-1.7");
  await storage().put("resumes/random.pdf", contents, "application/pdf");
  const command = send.mock.calls[0][0];
  expect(command).toBeInstanceOf(PutObjectCommand);
  expect(command.input).toMatchObject({
    Bucket: "private-bucket",
    Key: "resumes/random.pdf",
    Body: contents,
    ContentType: "application/pdf",
    IfNoneMatch: "*",
    CacheControl: "private, no-store",
  });
  expect(command.input).not.toHaveProperty("ACL");
});

test("reads stream bytes with a bounded range and closes the stream", async () => {
  const body = Readable.from([Buffer.from("%PDF-1.7")]);
  send.mockResolvedValue({ Body: body, ContentLength: 8 });
  expect((await storage().read("uploads/resumes/random.pdf")).toString()).toBe(
    "%PDF-1.7",
  );
  expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
  expect(send.mock.calls[0][0].input).toMatchObject({
    Key: "resumes/random.pdf",
    Range: "bytes=0-2097152",
  });
  expect(body.destroyed).toBe(true);
});

test("oversized streams are rejected even without ContentLength", async () => {
  const body = Readable.from([Buffer.alloc(2 * 1024 * 1024), Buffer.from("x")]);
  send.mockResolvedValue({ Body: body });
  await expect(storage().read("resumes/random.pdf")).rejects.toMatchObject({
    statusCode: 413,
  });
  expect(body.destroyed).toBe(true);
});

test("missing S3 objects map to the existing not-found contract", async () => {
  send.mockRejectedValue({
    name: "NoSuchKey",
    $metadata: { httpStatusCode: 404 },
  });
  await expect(storage().read("resumes/random.pdf")).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("service failures remain failures rather than falling back to local files", async () => {
  send.mockRejectedValue(new Error("credentials or provider detail"));
  await expect(storage().read("resumes/random.pdf")).rejects.toMatchObject({
    statusCode: 503,
    message: "Unable to read file from S3",
  });
});

test("cleanup deletes only the validated object key", async () => {
  send.mockResolvedValue({});
  await storage().remove("avatars/random.png");
  expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  expect(send.mock.calls[0][0].input).toEqual({
    Bucket: "private-bucket",
    Key: "avatars/random.png",
  });
  send.mockClear();
  await expect(storage().remove("../private.pdf")).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test("production requires S3 configuration and forbids local fallback", () => {
  jest.spyOn(config, "get").mockReturnValue("production");
  expect(getFileStorage).toThrow(
    "S3_BUCKET_NAME and AWS_REGION must be configured",
  );
  process.env.FILE_STORAGE_PROVIDER = "local";
  expect(getFileStorage).toThrow(
    "File storage is not configured for this environment",
  );
  process.env.FILE_STORAGE_PROVIDER = "s3";
  process.env.S3_BUCKET_NAME = "your_private_uploads_bucket";
  process.env.AWS_REGION = "your_aws_region";
  expect(getFileStorage).toThrow(
    "S3_BUCKET_NAME and AWS_REGION must be configured",
  );
  process.env.S3_BUCKET_NAME = "private-bucket";
  process.env.AWS_REGION = "eu-west-1";
  expect(getFileStorage()).toBeInstanceOf(S3FileStorage);
});

test("development keeps the private local option", () => {
  jest.spyOn(config, "get").mockReturnValue("development");
  expect(getFileStorage()).toBeInstanceOf(LocalFileStorage);
});
