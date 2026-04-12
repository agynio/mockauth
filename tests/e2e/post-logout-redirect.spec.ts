import { expect, test, type APIRequestContext } from "@playwright/test";

type TenantContext = { tenantId: string; resourceId: string };

test.describe("post logout redirect URIs", () => {
  test("validates post_logout_redirect_uri against post-logout list", async ({ request }) => {
    const tenant = await createIsolatedTenant(request);
    const clientId = await seedClient(request, tenant.tenantId, {
      redirectUris: ["https://client.example.test/callback"],
      postLogoutRedirectUris: ["https://client.example.test/logout"],
    });

    const allowed = await endSession(request, tenant, clientId, "https://client.example.test/logout", "logout-state");
    expect(allowed.status()).toBe(302);
    expect(allowed.headers()["location"]).toBe("https://client.example.test/logout?state=logout-state");

    const rejected = await endSession(request, tenant, clientId, "https://client.example.test/callback", "bad-state");
    expect(rejected.status()).toBe(400);
    const body = (await rejected.json()) as { error: string };
    expect(body.error).toBe("invalid_redirect_uri");
  });
});

const createIsolatedTenant = async (request: APIRequestContext): Promise<TenantContext> => {
  const uniqueAdminEmail = `pw-admin+${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const response = await request.post("/admin/api/test/seed-tenants-clients", { data: { adminEmail: uniqueAdminEmail } });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { tenantAId: string; tenantAResourceId: string };
  if (!payload.tenantAId || !payload.tenantAResourceId) {
    throw new Error("Failed to seed tenant for post-logout redirect tests");
  }
  return { tenantId: payload.tenantAId, resourceId: payload.tenantAResourceId };
};

const seedClient = async (
  request: APIRequestContext,
  tenantId: string,
  options: { redirectUris: string[]; postLogoutRedirectUris: string[] },
) => {
  const response = await request.post("/api/test/clients", {
    data: {
      names: ["Post-logout QA"],
      tokenEndpointAuthMethods: ["none"],
      tenantId,
      redirectUris: options.redirectUris,
      postLogoutRedirectUris: options.postLogoutRedirectUris,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { clients: { clientId: string }[] };
  const [client] = payload.clients;
  if (!client) {
    throw new Error("Failed to seed client");
  }
  return client.clientId;
};

const endSession = (
  request: APIRequestContext,
  tenant: TenantContext,
  clientId: string,
  postLogoutRedirectUri: string,
  state: string,
) => {
  const url = new URL(`http://127.0.0.1:3000/r/${tenant.resourceId}/oidc/end-session`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  url.searchParams.set("state", state);
  return request.fetch(url.toString(), { method: "GET", maxRedirects: 0 });
};
