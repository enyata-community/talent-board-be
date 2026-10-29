import { promises as fs } from "fs";
import os from "os";
import path from "path";
import config from "config";
import {
  LocalFileStorage,
  normalizeFileKey,
  getFileStorage,
} from "@src/files/storage/fileStorage";
import { validateFileContents } from "@src/files/fileValidation";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "talent-files-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  jest.restoreAllMocks();
});

test.each([
  "../secret.pdf",
  "resumes/../secret.pdf",
  "/etc/passwd",
  "https://evil.example/resume.pdf",
  "avatars/%2e%2e.pdf",
  "resumes/a.html",
])("rejects arbitrary file reference %s", (key) => {
  expect(() => normalizeFileKey(key)).toThrow();
});

test("private local storage preserves bytes and refuses overwrite and symlink reads", async () => {
  const storage = new LocalFileStorage(root, path.join(root, "legacy"));
  await storage.put(
    "resumes/random.pdf",
    Buffer.from("private"),
    "application/pdf",
  );
  expect((await storage.read("resumes/random.pdf")).toString()).toBe("private");
  expect(
    (await fs.stat(path.join(root, "resumes/random.pdf"))).mode & 0o777,
  ).toBe(0o600);
  await expect(
    storage.put(
      "resumes/random.pdf",
      Buffer.from("overwrite"),
      "application/pdf",
    ),
  ).rejects.toThrow();
  await fs.symlink(
    path.join(root, "resumes/random.pdf"),
    path.join(root, "resumes/link.pdf"),
  );
  await expect(storage.read("resumes/link.pdf")).rejects.toThrow();
  await storage.remove("resumes/random.pdf");
  await expect(storage.read("resumes/random.pdf")).rejects.toThrow();
});

test("existing upload keys can be read only through the restricted storage adapter", async () => {
  const legacy = path.join(root, "legacy");
  await fs.mkdir(path.join(legacy, "resumes"), { recursive: true });
  await fs.writeFile(
    path.join(legacy, "resumes/1746289362406-resume.pdf"),
    "legacy",
  );
  const storage = new LocalFileStorage(path.join(root, "private"), legacy);
  expect(
    (await storage.read("uploads/resumes/1746289362406-resume.pdf")).toString(),
  ).toBe("legacy");
  expect(() => normalizeFileKey("resumes/a.pdf", "avatars")).toThrow();
});

test("HTML and SVG cannot pass as a résumé or avatar", async () => {
  await expect(
    validateFileContents(
      Buffer.from("<html><script>alert(1)</script></html>"),
      ["application/pdf"],
    ),
  ).rejects.toThrow();
  await expect(
    validateFileContents(Buffer.from('<svg onload="alert(1)"></svg>'), [
      "image/png",
    ]),
  ).rejects.toThrow();
  expect(
    await validateFileContents(Buffer.from("%PDF-1.7\n%%EOF"), [
      "application/pdf",
    ]),
  ).toMatchObject({ mime: "application/pdf", ext: "pdf" });
});

test("production cannot silently fall back to local file storage", () => {
  jest.spyOn(config, "get").mockReturnValue("production");
  expect(getFileStorage).toThrow();
});
