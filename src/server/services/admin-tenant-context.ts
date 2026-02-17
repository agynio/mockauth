import { cookies } from "next/headers";

import type { Prisma } from "@/generated/prisma/client";
import { isProd } from "@/server/env";
import { getTenantMemberships } from "@/server/services/tenant-service";

export const ADMIN_ACTIVE_TENANT_COOKIE = "admin_active_tenant";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const cookieOptions = {
  path: "/admin",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProd,
  maxAge: COOKIE_MAX_AGE_SECONDS,
};

export const setAdminActiveTenantCookie = async (tenantId: string) => {
  const store = await cookies();
  store.set(ADMIN_ACTIVE_TENANT_COOKIE, tenantId, cookieOptions);
};

export const clearAdminActiveTenantCookie = async () => {
  const store = await cookies();
  store.set(ADMIN_ACTIVE_TENANT_COOKIE, "", { ...cookieOptions, maxAge: 0 });
};

type MembershipWithTenant = Prisma.TenantMembershipGetPayload<{ include: { tenant: true } }>;

export const getAdminTenantContext = async (adminUserId: string): Promise<{
  memberships: MembershipWithTenant[];
  activeMembership: MembershipWithTenant | null;
  activeTenant: MembershipWithTenant["tenant"] | null;
}> => {
  const store = await cookies();
  const cookieTenantId = store.get(ADMIN_ACTIVE_TENANT_COOKIE)?.value;
  const memberships = await getTenantMemberships(adminUserId);
  const activeMembership = memberships.find((membership) => membership.tenantId === cookieTenantId) ?? memberships[0] ?? null;

  return {
    memberships,
    activeMembership,
    activeTenant: activeMembership?.tenant ?? null,
  };
};
