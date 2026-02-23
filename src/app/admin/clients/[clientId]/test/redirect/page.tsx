import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { CopyField } from "@/app/admin/_components/copy-field";
import { TestSecretCleanup } from "@/app/admin/clients/[clientId]/test/test-secret-cleanup";
import { TestRunAgainButton } from "@/app/admin/clients/[clientId]/test/test-run-again-button";
import { DEFAULT_TEST_SCOPES } from "@/app/admin/clients/[clientId]/test/constants";
import { authOptions } from "@/server/auth/options";
import { getAdminTenantContext } from "@/server/services/admin-tenant-context";
import { getClientByIdForTenant } from "@/server/services/client-service";
import { getRequestOrigin } from "@/server/utils/request-origin";
import { buildOidcUrls } from "@/server/oidc/url-builder";
import { consumeOauthTestSession } from "@/server/services/oauth-test-service";
import { readOauthTestSecretCookie } from "@/server/oauth/test-cookie";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type PageParams = Promise<{ clientId: string }>;
type SearchParams = Promise<{ code?: string; state?: string; error?: string; error_description?: string }>;

type TokenResult = {
  status: "success";
  tokens: Record<string, unknown>;
  decodedIdToken: Record<string, unknown> | null;
  decodedAccessToken: Record<string, unknown> | null;
  scope: string;
  redirectUri: string;
};

type ErrorResult = { status: "error"; message: string; details?: unknown };

const RERUN_HINT = 'Use "Run again" to start a new test.';

const decodeJwtPayload = (token?: unknown) => {
  if (typeof token !== "string") {
    return null;
  }
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }
  try {
    const json = Buffer.from(segments[1], "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
};

export default async function ClientTestRedirectPage({ params, searchParams }: { params: PageParams; searchParams?: SearchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const { clientId } = await params;
  const resolvedSearch = searchParams ? await searchParams : {};
  const { code, state, error, error_description } = resolvedSearch;

  const { activeTenant } = await getAdminTenantContext(session.user.id);
  if (!activeTenant) {
    redirect("/admin/clients");
  }

  const client = await getClientByIdForTenant(activeTenant.id, clientId).catch(() => null);
  if (!client) {
    notFound();
  }

  const origin = await getRequestOrigin();
  const resourceId = client.apiResourceId ?? activeTenant.defaultApiResourceId;
  if (!resourceId) {
    notFound();
  }
  const urls = buildOidcUrls(origin, resourceId);
  const testRedirectUri = `${origin}/admin/clients/${client.id}/test/redirect`;

  const cookieSecret = state ? await readOauthTestSecretCookie(client.id, state) : null;
  const sessionRecord = state ? await consumeOauthTestSession(state) : null;
  const now = new Date();
  let rerunScopes = DEFAULT_TEST_SCOPES;
  let rerunRedirectUri = testRedirectUri;
  if (sessionRecord?.scopes?.trim()) {
    rerunScopes = sessionRecord.scopes;
  }
  if (sessionRecord?.redirectUri) {
    rerunRedirectUri = sessionRecord.redirectUri;
  }
  let result: TokenResult | ErrorResult;

  if (error) {
    result = {
      status: "error",
      message: `${error}${error_description ? `: ${error_description}` : ""}`,
    };
  } else if (!state) {
    result = { status: "error", message: `Missing state parameter. ${RERUN_HINT}` };
  } else if (!sessionRecord) {
    result = { status: "error", message: `Test session expired or already used. ${RERUN_HINT}` };
  } else if (sessionRecord.clientId !== client.id) {
    result = { status: "error", message: "State does not belong to this client." };
  } else if (sessionRecord.tenantId !== activeTenant.id) {
    result = { status: "error", message: "State is scoped to a different tenant." };
  } else if (sessionRecord.expiresAt < now) {
    result = { status: "error", message: `Test session expired. ${RERUN_HINT}` };
  } else if (!code) {
    result = { status: "error", message: "Authorization code missing from redirect." };
  } else if (client.tokenEndpointAuthMethod !== "none" && !cookieSecret) {
    result = { status: "error", message: `Client secret expired. ${RERUN_HINT}` };
  } else {
    const exchange = await exchangeAuthorizationCode({
      tokenUrl: urls.token,
      clientId: client.clientId,
      code,
      redirectUri: sessionRecord.redirectUri,
      codeVerifier: sessionRecord.codeVerifier,
      clientSecret: cookieSecret,
      tokenAuthMethod: client.tokenEndpointAuthMethod,
      requestedScope: sessionRecord.scopes,
    });
    result = exchange;
  }

  const isError = result.status === "error";
  const tokenResult = result.status === "success" ? result : null;
  let errorMessage: string | null = null;
  let errorDetails: unknown = null;
  if (result.status === "error") {
    errorMessage = result.message;
    errorDetails = result.details;
  }

  return (
    <div className="space-y-6">
      <TestSecretCleanup clientId={client.id} state={state} enabled={client.tokenEndpointAuthMethod !== "none"} />
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/clients/${client.id}/test`}>← Back to test config</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>OAuth test redirect</CardTitle>
          <CardDescription>Inspect the provider response and decoded tokens for {client.name}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <CopyField label="Authorization code" value={code ?? ""} testId="test-oauth-code" />
            <CopyField label="State" value={state ?? ""} testId="test-oauth-state" />
          </div>
          {isError ? (
            <div className="space-y-4">
              <Alert variant="destructive" data-testid="test-oauth-error">
                <AlertTitle>Token exchange failed</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
                <div className="mt-4">
                  <TestRunAgainButton
                    clientId={client.id}
                    scopes={rerunScopes}
                    redirectUri={rerunRedirectUri}
                    variant="secondary"
                    size="sm"
                    testId="test-oauth-reset"
                  >
                    Reset test
                  </TestRunAgainButton>
                </div>
              </Alert>
              {errorDetails ? (
                <pre className="overflow-auto rounded-md border bg-muted/50 p-3 text-xs" data-testid="test-oauth-error-details">
                  {formatJson(errorDetails)}
                </pre>
              ) : null}
            </div>
          ) : tokenResult ? (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <CopyField label="ID token" value={String(tokenResult.tokens.id_token ?? "")} testId="test-oauth-id-token" />
                <CopyField
                  label="Access token"
                  value={String(tokenResult.tokens.access_token ?? "")}
                  testId="test-oauth-access-token"
                />
              </div>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Decoded ID token</h3>
                <pre className="overflow-auto rounded-md border bg-muted/50 p-3 text-xs" data-testid="test-oauth-decoded-id">
                  {formatJson(tokenResult.decodedIdToken)}
                </pre>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Decoded access token</h3>
                <pre className="overflow-auto rounded-md border bg-muted/50 p-3 text-xs" data-testid="test-oauth-decoded-access">
                  {formatJson(tokenResult.decodedAccessToken)}
                </pre>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Raw token response</h3>
                <pre className="overflow-auto rounded-md border bg-muted/50 p-3 text-xs" data-testid="test-oauth-raw-response">
                  {formatJson(tokenResult.tokens)}
                </pre>
              </section>
              <dl className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
                <div>
                  <dt className="font-medium text-foreground">Scopes</dt>
                  <dd>{tokenResult.scope}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Redirect URI</dt>
                  <dd className="break-all">{tokenResult.redirectUri}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <TestRunAgainButton clientId={client.id} scopes={rerunScopes} redirectUri={rerunRedirectUri} />
            <CopyField label="Test redirect" value={testRedirectUri} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const exchangeAuthorizationCode = async (input: {
  tokenUrl: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientSecret: string | null;
  tokenAuthMethod: string;
  requestedScope: string;
}): Promise<TokenResult | ErrorResult> => {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
  });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };

  if (input.tokenAuthMethod === "client_secret_basic") {
    if (!input.clientSecret) {
      return { status: "error", message: "Client secret is required for this client." };
    }
    const credentials = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  } else if (input.tokenAuthMethod === "client_secret_post") {
    if (!input.clientSecret) {
      return { status: "error", message: "Client secret is required for this client." };
    }
    params.set("client_secret", input.clientSecret);
  } else if (input.tokenAuthMethod !== "none") {
    return { status: "error", message: `Unsupported token auth method ${input.tokenAuthMethod}` };
  }

  try {
    const response = await fetch(input.tokenUrl, { method: "POST", headers, body: params });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = text;
    }
    if (!response.ok || typeof payload !== "object" || payload === null) {
      return {
        status: "error",
        message: typeof payload === "object" && payload !== null
          ? String((payload as Record<string, unknown>).error_description ?? (payload as Record<string, unknown>).error ?? "Token exchange failed")
          : "Token exchange failed",
        details: payload,
      };
    }
    const tokenPayload = payload as Record<string, unknown>;
    return {
      status: "success",
      tokens: tokenPayload,
      decodedIdToken: decodeJwtPayload(tokenPayload.id_token),
      decodedAccessToken: decodeJwtPayload(tokenPayload.access_token),
      scope: typeof tokenPayload.scope === "string" && tokenPayload.scope ? tokenPayload.scope : input.requestedScope,
      redirectUri: input.redirectUri,
    };
  } catch (err) {
    return {
      status: "error",
      message: "Token exchange failed",
      details: err instanceof Error ? err.message : err,
    };
  }
};
