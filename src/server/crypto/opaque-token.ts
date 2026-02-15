import { createHash, randomBytes } from "crypto";

export const generateOpaqueToken = (bytes = 32): string =>
  randomBytes(bytes).toString("base64url");

export const hashOpaqueToken = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
