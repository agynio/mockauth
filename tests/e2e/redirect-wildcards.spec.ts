import { expect, test, type APIRequestContext } from "@playwright/test";

const pkce = "a".repeat(43);

test.afterEach(async ({ request }) => {
  await setAllowAnyRedirect(request, false);
});

type TenantContext = { tenantId: string; resourceId: string };

test.describe("redirect wildcard policy", () => {
  test("allows configured wildcard types and respects env flag", async ({ request }) => {
    await setAllowAnyRedirect(request, false);
    const tenant = await createIsolatedTenant(request);
    const clientId = await seedClient(request, tenant.tenantId, {
      redirectUris: [
        "https://exact.example.test/callback",
        "https://app.example.test/callback/*",
        "https://*.wildcard.test/callback",
        "*",
      ],
    });

    await expectRedirectAllowed(request, tenant, clientId, "https://exact.example.test/callback");
    await expectRedirectAllowed(request, tenant, clientId, "https://app.example.test/callback/child");
    await expectRedirectAllowed(request, tenant, clientId, "https://foo.wildcard.test/callback");
    await expectRedirectRejected(request, tenant, clientId, "https://foo.bar.wildcard.test/callback");

    await expectRedirectRejected(request, tenant, clientId, "https://anywhere.example.test/logout");

    await setAllowAnyRedirect(request, true);
    await expectRedirectAllowed(request, tenant, clientId, "https://anywhere.example.test/logout");

    await setAllowAnyRedirect(request, false);
    await expectRedirectRejected(request, tenant, clientId, "https://anywhere.example.test/logout");
  });
});

const createIsolatedTenant = async (request: APIRequestContext): Promise<TenantContext> => {
  const response = await request.post("/admin/api/test/seed-tenants-clients", { data: {} });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { tenantAId: string; tenantAResourceId: string };
  if (!payload.tenantAId || !payload.tenantAResourceId) {
    throw new Error("Failed to seed tenant for redirect tests");
  }
  return { tenantId: payload.tenantAId, resourceId: payload.tenantAResourceId };
};

const seedClient = async (request: APIRequestContext, tenantId: string, options: { redirectUris: string[] }) => {
  const response = await request.post("/api/test/clients", {
    data: {
      names: ["Wildcard QA"],
      clientType: "PUBLIC",
      tenantId,
      redirectUris: options.redirectUris,
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

const expectRedirectAllowed = async (
  request: APIRequestContext,
  tenant: TenantContext,
  clientId: string,
  redirectUri: string,
) => {
  const response = await authorize(request, tenant, clientId, redirectUri);
  expect(response.status()).toBe(302);
};

const expectRedirectRejected = async (
  request: APIRequestContext,
  tenant: TenantContext,
  clientId: string,
  redirectUri: string,
) => {
  const response = await authorize(request, tenant, clientId, redirectUri);
  expect(response.status()).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toBe("invalid_redirect_uri");
};

const authorize = (request: APIRequestContext, tenant: TenantContext, clientId: string, redirectUri: string) => {
  const url = new URL(`http://127.0.0.1:3000/r/${tenant.resourceId}/oidc/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", "state-value");
  url.searchParams.set("nonce", "nonce-value");
  url.searchParams.set("code_challenge", pkce);
  url.searchParams.set("code_challenge_method", "S256");
  return request.fetch(url.toString(), { method: "GET", maxRedirects: 0 });
};

const setAllowAnyRedirect = async (request: APIRequestContext, value: boolean) => {
  await request.post("/api/test/redirect-policy", { data: { allowAny: value } });
};
