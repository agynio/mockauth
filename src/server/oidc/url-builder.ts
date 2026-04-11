export const buildOidcUrls = (origin: string, apiResourceId: string) => {
  const base = `${origin}/r/${apiResourceId}/oidc`;
  return {
    issuer: base,
    discovery: `${base}/.well-known/openid-configuration`,
    jwks: `${base}/jwks.json`,
    authorize: `${base}/authorize`,
    endSession: `${base}/end-session`,
    token: `${base}/token`,
    userinfo: `${base}/userinfo`,
  } as const;
};
