import { CustomJwtPayload } from "@src/interfaces";
import config from "config";
import { randomUUID } from "crypto";
import { sign, verify } from "jsonwebtoken";

export const signToken = (
  id: string,
  keyName: "ACCESS_TOKEN_PRIVATE_KEY" | "REFRESH_TOKEN_PRIVATE_KEY",
  options?: object,
): string => {
  const signingKey = Buffer.from(
    config.get<string>(keyName),
    "base64",
  ).toString("ascii");

  return sign({ id }, signingKey, {
    ...(options && options),
    algorithm: "RS256",
    jwtid: randomUUID(),
  });
};

export const verifyToken = (
  token: string,
  keyName: "ACCESS_TOKEN_PUBLIC_KEY" | "REFRESH_TOKEN_PUBLIC_KEY",
): CustomJwtPayload | null => {
  const publicKey = Buffer.from(config.get<string>(keyName), "base64").toString(
    "ascii",
  );

  // Verify the token using the public key and return the decoded payload if valid
  try {
    return verify(token, publicKey, {
      algorithms: ["RS256"],
    }) as CustomJwtPayload;
  } catch (error) {
    return null;
  }
};
