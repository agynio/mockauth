import { JwtSigningAlg } from "@/generated/prisma/client";

export const SUPPORTED_JWT_SIGNING_ALGS = [
  "RS256",
  "PS256",
  "ES256",
  "ES384",
] as const satisfies readonly JwtSigningAlg[];

export const DEFAULT_JWT_SIGNING_ALG: JwtSigningAlg = "RS256";

const SUPPORTED_SET = new Set<JwtSigningAlg>(SUPPORTED_JWT_SIGNING_ALGS);

export const isJwtSigningAlg = (value: unknown): value is JwtSigningAlg => {
  return typeof value === "string" && SUPPORTED_SET.has(value as JwtSigningAlg);
};

export const assertJwtSigningAlg = (value: unknown): JwtSigningAlg => {
  if (!isJwtSigningAlg(value)) {
    throw new Error(`Unsupported JWT signing alg: ${value}`);
  }
  return value;
};
