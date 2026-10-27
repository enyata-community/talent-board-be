import { storeUploadedFile } from "@src/files/storeUploadedFile";
import express from "express";
import { Server, request } from "http";
import { AddressInfo } from "net";
import AppDataSource from "@src/datasource";
import { UserRole } from "@src/entities/user.entity";
import { ProfileStatus } from "@src/entities/talentProfile.entity";
import talentRoutes from "@src/talents/talent.route";
import fileRoutes from "@src/files/files.route";
import { createFileUploader } from "@src/utils/createFileUploader";
import { getFileStorage } from "@src/files/storage/fileStorage";

jest.mock("@src/datasource", () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn(() => ({})),
    manager: { findOne: jest.fn() },
  },
}));
jest.mock("@src/files/storage/fileStorage", () => ({
  ...jest.requireActual("@src/files/storage/fileStorage"),
  getFileStorage: jest.fn(),
}));
jest.mock("@src/middlewares/deserializeUser", () => ({
  deserializeUser: (req, res, next) => {
    const actor = req.headers["x-test-actor"];
    if (!actor) return res.status(401).json({ message: "Missing tokens" });
    req.user = {
      id: actor === "owner" ? "11111111-1111-4111-8111-111111111111" : "other",
      role: actor === "recruiter" ? "recruiter" : "talent",
    };
    next();
  },
}));
let server: Server;
const read = jest.fn();
const id = "11111111-1111-4111-8111-111111111111";
const pdf = Buffer.from("%PDF-1.7\n%%EOF");

beforeAll(async () => {
  const app = express();
  app.use("/talents", talentRoutes);
  app.use("/assets", fileRoutes);
  app.post(
    "/upload",
    createFileUploader({
      fieldname: "resume",
      allowedMimeTypes: ["application/pdf"],
    }),
    (req, res) => res.json({ mime: req.file?.mimetype }),
  );
  app.use((err, _req, res, _next) =>
    res.status(err.statusCode || 500).json({ message: err.message }),
  );
  server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    listening.on("error", reject);
  });
});
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  jest.clearAllMocks();
  (getFileStorage as jest.Mock).mockReturnValue({ read });
  read.mockResolvedValue(pdf);
  (AppDataSource.manager.findOne as jest.Mock).mockResolvedValue({
    role: UserRole.TALENT,
    profile_completed: true,
    talent_profile: {
      resume_path: "resumes/private.pdf",
      profile_status: ProfileStatus.APPROVED,
    },
  });
});
const send = (
  url: string,
  actor?: string,
  body?: Buffer,
  headers: Record<string, string> = {},
) =>
  new Promise<{ status: number; headers: any; body: Buffer }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          path: url,
          method: body ? "POST" : "GET",
          headers: { ...(actor ? { "x-test-actor": actor } : {}), ...headers },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    },
  );

test.each(["owner", "recruiter"])(
  "%s can download a résumé as a private attachment",
  async (actor) => {
    const res = await send(`/talents/${id}/resume`, actor);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(pdf);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  },
);
test("anonymous and unrelated talents cannot read résumés", async () => {
  expect((await send(`/talents/${id}/resume`)).status).toBe(401);
  expect((await send(`/talents/${id}/resume`, "stranger")).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
});
test("recruiters cannot read unapproved résumés; owners can", async () => {
  (AppDataSource.manager.findOne as jest.Mock).mockResolvedValue({
    profile_completed: true,
    talent_profile: {
      resume_path: "resumes/private.pdf",
      profile_status: ProfileStatus.PENDING,
    },
  });
  expect((await send(`/talents/${id}/resume`, "recruiter")).status).toBe(404);
  expect((await send(`/talents/${id}/resume`, "owner")).status).toBe(200);
});
test("invalid IDs and public résumé paths cannot expose files", async () => {
  expect((await send("/talents/bad-id/resume", "owner")).status).toBe(422);
  expect(
    (await send("/assets/avatars/..%2fresumes%2fprivate.pdf")).status,
  ).toBe(404);
  expect(read).not.toHaveBeenCalled();
});
test("HTML cannot be served as an avatar", async () => {
  read.mockResolvedValue(Buffer.from("<html><script>alert(1)</script></html>"));
  expect((await send("/assets/avatars/spoof.png")).status).toBe(400);
});
test("multipart MIME spoofing is rejected and oversized files return 413", async () => {
  const upload = (data: Buffer) => {
    const boundary = "test-upload-boundary";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return send("/upload", undefined, body, {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    });
  };
  expect((await upload(Buffer.from("<html>spoofed PDF</html>"))).status).toBe(
    400,
  );
  expect((await upload(Buffer.alloc(2 * 1024 * 1024 + 1))).status).toBe(413);
  expect((await upload(pdf)).status).toBe(200);
});

test("storage keys use random IDs and the detected extension instead of client filenames", async () => {
  const put = jest.fn().mockResolvedValue(undefined);
  (getFileStorage as jest.Mock).mockReturnValue({ put });
  const file = {
    buffer: pdf,
    originalname: "../../evil.html",
    mimetype: "text/html",
  } as Express.Multer.File;
  const first = await storeUploadedFile(file, "resumes");
  const second = await storeUploadedFile(file, "resumes");
  expect(first).toMatch(/^resumes\/[a-f0-9-]{36}\.pdf$/);
  expect(first).not.toBe(second);
  expect(put).toHaveBeenCalledWith(first, pdf, "application/pdf");
});
