import { randomUUID } from "crypto";

import { JwtSigningAlg, KeyStatus, Prisma } from "@/generated/prisma/client";
import { exportJWK, generateKeyPair, importJWK, type JWK } from "jose";

import { prisma } from "@/server/db/client";
import { encrypt, decrypt } from "@/server/crypto/key-vault";
import { DomainError } from "@/server/errors";
import { DEFAULT_JWT_SIGNING_ALG } from "@/server/oidc/signing-alg";

export const getActiveKeyForAlg = async (tenantId: string, alg: JwtSigningAlg) => {
  const key = await prisma.tenantKey.findFirst({
    where: { tenantId, alg, status: KeyStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
  });

  if (!key) {
    throw new DomainError(`No active signing key for ${alg}`, { status: 500 });
  }

  return key;
};

export const ensureActiveKeyForAlg = async (tenantId: string, alg: JwtSigningAlg) => {
  const existing = await prisma.tenantKey.findFirst({
    where: { tenantId, alg, status: KeyStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return existing;
  }

  return rotateKeyForAlg(tenantId, alg);
};

const runWithTransaction = async <T>(
  tx: Prisma.TransactionClient | undefined,
  operation: (client: Prisma.TransactionClient) => Promise<T>,
) => {
  if (tx) {
    return operation(tx);
  }
  return prisma.$transaction(operation);
};

export const rotateKeyForAlg = async (
  tenantId: string,
  alg: JwtSigningAlg = DEFAULT_JWT_SIGNING_ALG,
  tx?: Prisma.TransactionClient,
) => {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  const [publicJwk, privateJwk] = await Promise.all([
    exportJWK(publicKey),
    exportJWK(privateKey),
  ]);

  const kid = randomUUID();
  publicJwk.kid = kid;
  publicJwk.use = "sig";
  publicJwk.alg = alg;
  privateJwk.kid = kid;
  privateJwk.use = "sig";
  privateJwk.alg = alg;

  const kty = publicJwk.kty;
  if (!kty) {
    throw new DomainError("Generated key missing key type", { status: 500 });
  }

  return runWithTransaction(tx, async (client) => {
    await client.tenantKey.updateMany({
      where: { tenantId, alg, status: KeyStatus.ACTIVE },
      data: { status: KeyStatus.ROTATED },
    });

    return client.tenantKey.create({
      data: {
        tenantId,
        kid,
        kty,
        alg,
        use: "sig",
        status: KeyStatus.ACTIVE,
        publicJwk: publicJwk as Prisma.InputJsonValue,
        privateJwkEncrypted: encrypt(JSON.stringify(privateJwk)),
      },
    });
  });
};

export const getJwks = async (tenantId: string) => {
  const keys = await prisma.tenantKey.findMany({
    where: { tenantId, status: { in: [KeyStatus.ACTIVE, KeyStatus.ROTATED] } },
    orderBy: { createdAt: "desc" },
  });

  return keys.map((key) => key.publicJwk as JWK);
};

export const getPublicJwkByKid = async (tenantId: string, kid: string) => {
  const record = await prisma.tenantKey.findFirst({
    where: { tenantId, kid, status: { in: [KeyStatus.ACTIVE, KeyStatus.ROTATED] } },
  });

  if (!record) {
    throw new DomainError("Key not found", { status: 400, code: "invalid_token" });
  }

  return record.publicJwk as JWK;
};

export const getPrivateJwk = async (keyId: string, tenantId: string) => {
  const key = await prisma.tenantKey.findFirst({ where: { id: keyId, tenantId } });
  if (!key) {
    throw new DomainError("Signing key not found", { status: 500 });
  }

  return JSON.parse(decrypt(key.privateJwkEncrypted)) as JWK;
};

export const importPrivateKey = async (keyRecord: { id: string; tenantId: string; privateJwkEncrypted: string; kid: string }) => {
  const jwk = JSON.parse(decrypt(keyRecord.privateJwkEncrypted)) as JWK;
  const alg = jwk.alg;
  if (!alg) {
    throw new DomainError("Signing key missing algorithm", { status: 500 });
  }
  return importJWK(jwk, alg);
};
