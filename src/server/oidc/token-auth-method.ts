export const TOKEN_AUTH_METHODS = ["client_secret_basic", "client_secret_post", "none"] as const;

export type TokenAuthMethod = (typeof TOKEN_AUTH_METHODS)[number];

export const isTokenAuthMethod = (value: unknown): value is TokenAuthMethod =>
  TOKEN_AUTH_METHODS.includes(value as TokenAuthMethod);

export const requiresClientSecret = (methods: TokenAuthMethod[]): boolean =>
  methods.includes("client_secret_basic") || methods.includes("client_secret_post");

export const parseTokenAuthMethods = (methods: string[]): TokenAuthMethod[] => {
  if (!methods || methods.length === 0) {
    throw new Error("At least one token auth method is required");
  }
  const unique = Array.from(new Set(methods));
  const invalid = unique.filter((method) => !isTokenAuthMethod(method));
  if (invalid.length > 0) {
    throw new Error(`Invalid token auth method: ${invalid.join(", ")}`);
  }
  const ordered = TOKEN_AUTH_METHODS.filter((method) => unique.includes(method));
  return ordered as TokenAuthMethod[];
};

export const normalizeTokenAuthMethods = (methods?: string[] | null): TokenAuthMethod[] => {
  const provided = methods ?? ["client_secret_basic"];
  return parseTokenAuthMethods(provided);
};

export const resolveUpstreamAuthMethod = (method: string | null | undefined): TokenAuthMethod => {
  if (!method) {
    throw new Error("Upstream token auth method is required");
  }
  return parseTokenAuthMethods([method])[0];
};
