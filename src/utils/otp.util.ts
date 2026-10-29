import { randomInt } from "crypto";
export const OtpUtil = {
  // Generates a numeric OTP of specified length (default 6 digits).
  generate(length = 6) {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return String(randomInt(min, max + 1));
  },
};
