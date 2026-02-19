import { randomUUID } from "crypto";

import { prisma } from "@/server/db/client";
import {
  createApiResource,
  getApiResourceForTenant,
  listApiResources,
  setDefaultApiResource,
} from "@/server/services/api-resource-service";
import { describe, expect, it } from "vitest";

const createTenant = async () => {
  const tenant = await prisma.tenant.create({ data: { name: `API Resource Tenant ${randomUUID()}` } });
  const apiResource = await prisma.apiResource.create({ data: { tenantId: tenant.id, name: "Default" } });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultApiResourceId: apiResource.id } });
  return tenant;
};

describe("api resource service", () => {
  it("creates and lists resources", async () => {
    const tenant = await createTenant();
    await createApiResource(tenant.id, { name: "Payments" });
    const resources = await listApiResources(tenant.id);
    expect(resources.map((resource) => resource.name)).toContain("Payments");
  });

  it("sets a new default resource and scopes lookups", async () => {
    const tenant = await createTenant();
    const secondary = await createApiResource(tenant.id, { name: "Orders" });
    const updatedTenant = await setDefaultApiResource(tenant.id, secondary.id);
    expect(updatedTenant.defaultApiResourceId).toBe(secondary.id);
    const fetched = await getApiResourceForTenant(tenant.id, secondary.id);
    expect(fetched.name).toBe("Orders");
  });
});
