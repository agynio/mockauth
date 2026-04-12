import { NextResponse } from "next/server";

import { createClient } from "@/server/services/client-service";
import { env } from "@/server/env";
import { normalizeTokenAuthMethods } from "@/server/oidc/token-auth-method";

const DEFAULT_TENANT_ID = "tenant_qa";

type Body = {
  tenantId?: string;
  names?: string[];
  tokenEndpointAuthMethods?: string[];
  pkceRequired?: boolean;
  allowedGrantTypes?: string[];
  redirectUris?: string[];
  postLogoutRedirectUris?: string[];
};

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = ((await request.json().catch(() => ({}))) ?? {}) as Body;
  const tenantId = payload.tenantId ?? DEFAULT_TENANT_ID;
  const names = Array.isArray(payload.names) && payload.names.length > 0 ? payload.names : ["Playwright Client"];
  let tokenEndpointAuthMethods: ReturnType<typeof normalizeTokenAuthMethods>;
  try {
    tokenEndpointAuthMethods = normalizeTokenAuthMethods(payload.tokenEndpointAuthMethods);
  } catch (error) {
    console.error("Invalid token auth methods", error);
    return NextResponse.json({ error: "Invalid token auth methods" }, { status: 400 });
  }
  const pkceRequired = payload.pkceRequired ?? true;
  const allowedGrantTypes =
    Array.isArray(payload.allowedGrantTypes) && payload.allowedGrantTypes.length > 0
      ? payload.allowedGrantTypes
      : ["authorization_code"];
  const redirectUris = Array.isArray(payload.redirectUris) ? payload.redirectUris : undefined;
  const postLogoutRedirectUris = Array.isArray(payload.postLogoutRedirectUris)
    ? payload.postLogoutRedirectUris
    : undefined;

  const created = [] as { id: string; name: string; clientId: string }[];
  for (const name of names) {
    const { client } = await createClient(tenantId, {
      name,
      tokenEndpointAuthMethods,
      pkceRequired,
      allowedGrantTypes,
      redirectUris,
      postLogoutRedirectUris,
    });
    created.push({ id: client.id, name: client.name, clientId: client.clientId });
  }

  return NextResponse.json({ clients: created });
}
