import { createFileUploader } from "@src/utils/createFileUploader";

export const uploadResume = createFileUploader({
  fieldname: "resume",
  allowedMimeTypes: ["application/pdf"],
});
