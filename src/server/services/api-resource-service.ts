import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { getActiveTenantById } from "@/server/services/tenant-service";

export const listApiResources = async (tenantId: string) => {
  return prisma.apiResource.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
};

export const getApiResourceForTenant = async (tenantId: string, apiResourceId: string) => {
  const resource = await prisma.apiResource.findFirst({ where: { tenantId, id: apiResourceId } });
  if (!resource) {
    throw new DomainError("API resource not found", { status: 404, code: "api_resource_not_found" });
  }
  return resource;
};

export const getApiResourceById = async (apiResourceId: string) => {
  const resource = await prisma.apiResource.findUnique({ where: { id: apiResourceId } });
  if (!resource) {
    throw new DomainError("API resource not found", { status: 404, code: "api_resource_not_found" });
  }
  return resource;
};

export const getApiResourceWithTenant = async (apiResourceId: string) => {
  const resource = await getApiResourceById(apiResourceId);
  const tenant = await getActiveTenantById(resource.tenantId);
  return { resource, tenant };
};

export const getTenantDefaultApiResource = async (tenantId: string) => {
  const resource = await prisma.apiResource.findFirst({ where: { tenantId, defaultFor: { id: tenantId } } });
  if (!resource) {
    throw new DomainError("Default API resource missing", { status: 500, code: "api_resource_missing" });
  }
  return resource;
};

export const createApiResource = async (
  tenantId: string,
  data: { name: string; description?: string | null },
) => {
  return prisma.apiResource.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description,
    },
  });
};

export const updateApiResource = async (
  tenantId: string,
  apiResourceId: string,
  data: { name: string; description?: string | null },
) => {
  await getApiResourceForTenant(tenantId, apiResourceId);
  return prisma.apiResource.update({
    where: { id: apiResourceId },
    data: { name: data.name, description: data.description },
  });
};

export const setDefaultApiResource = async (tenantId: string, apiResourceId: string) => {
  await getApiResourceForTenant(tenantId, apiResourceId);
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { defaultApiResourceId: apiResourceId },
  });
};
