import { createHash } from "crypto";

export const computeS256Challenge = (verifier: string): string => {
  const digest = createHash("sha256").update(verifier).digest();
  return digest.toString("base64url");
};
