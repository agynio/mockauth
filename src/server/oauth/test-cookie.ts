import { cookies } from "next/headers";

import { env } from "@/server/env";

const COOKIE_PREFIX = "oauth-test-secret";
const COOKIE_TTL_SECONDS = 60 * 15;

export const buildTestSecretCookieName = (state: string) => `${COOKIE_PREFIX}-${state}`;
export const buildTestSecretCookiePath = (clientId: string) => `/admin/clients/${clientId}/test/redirect`;

const shouldUseSecureCookie = () => !env.MOCKAUTH_ALLOW_INSECURE_TEST_COOKIE;

export const setOauthTestSecretCookie = async (clientId: string, state: string, secret: string) => {
  const jar = await cookies();
  jar.set({
    name: buildTestSecretCookieName(state),
    value: secret,
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: "strict",
    path: buildTestSecretCookiePath(clientId),
    maxAge: COOKIE_TTL_SECONDS,
  });
};

export const readOauthTestSecretCookie = async (clientId: string, state: string): Promise<string | null> => {
  const jar = await cookies();
  const stored = jar.get(buildTestSecretCookieName(state));
  return stored?.value ?? null;
};

export const clearOauthTestSecretCookie = async (clientId: string, state: string) => {
  const jar = await cookies();
  jar.set({
    name: buildTestSecretCookieName(state),
    value: "",
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: "strict",
    path: buildTestSecretCookiePath(clientId),
    maxAge: 0,
  });
};
