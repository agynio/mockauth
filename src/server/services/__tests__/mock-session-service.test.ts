import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashOpaqueToken } from "@/server/crypto/opaque-token";
import { prisma } from "@/server/db/client";
import { env } from "@/server/env";
import { createSession } from "@/server/services/mock-session-service";

describe("mock-session-service", () => {
  it("sets expiresAt using the configured TTL", async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `Session Tenant ${randomUUID()}` },
    });
    const user = await prisma.mockUser.create({
      data: {
        tenantId: tenant.id,
        username: `session-user-${randomUUID()}`,
        displayName: "Session User",
      },
    });

    const token = await createSession(tenant.id, user.id, {
      strategy: "USERNAME",
      subject: user.username,
    });

    const stored = await prisma.mockSession.findUnique({
      where: { sessionTokenHash: hashOpaqueToken(token) },
    });

    expect(stored).not.toBeNull();
    const ttlSeconds = Math.round((stored!.expiresAt.getTime() - stored!.createdAt.getTime()) / 1000);
    expect(ttlSeconds).toBeGreaterThanOrEqual(env.MOCKAUTH_SESSION_TTL_SECONDS - 1);
    expect(ttlSeconds).toBeLessThanOrEqual(env.MOCKAUTH_SESSION_TTL_SECONDS + 1);
  });
});
