import { createFileUploader } from "@src/utils/createFileUploader";

export const uploadAvatar = createFileUploader({
  fieldname: "avatar",
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
});
