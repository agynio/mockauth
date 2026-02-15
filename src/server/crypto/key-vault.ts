import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "@/server/env";

const KEY = createHash("sha256")
  .update(env.MOCKAUTH_KEY_ENCRYPTION_SECRET)
  .digest();

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export const encrypt = (payload: string): string => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
};

export const decrypt = (payload: string): string => {
  const buffer = Buffer.from(payload, "base64url");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
};
