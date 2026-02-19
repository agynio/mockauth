import crypto from "node:crypto";

import { SignJWT, importJWK } from "jose";

export interface LogtoStubProfile {
  sub: string;
  email: string;
  name?: string;
}

interface AuthorizationEntry {
  profile: LogtoStubProfile;
  codeChallenge?: string | null;
}

const DEFAULT_PROFILE: LogtoStubProfile = {
  sub: "stub-owner",
  email: "owner@example.test",
  name: "Owner",
};

const profileQueue: LogtoStubProfile[] = [];
const authorizationCodes = new Map<string, AuthorizationEntry>();
const accessTokens = new Map<string, LogtoStubProfile>();

const keyId = "test-logto-stub";
const privateJwk = {
  kty: "EC",
  crv: "P-384",
  kid: keyId,
  x: "CGT-Vakw-WC1WOTqUF2dw1A4xlDjN_vN6pbXB3_kb2WXf5fszRuV2D5NPLpy2MVr",
  y: "2Bs5hslxyy0f-cwsHHrPCfcEKvpcGTSvTx1eIkjUFo41fE0FAKcajq1oo_9ZoKBP",
  d: "OcNdz5CaoaQG8LcOjey6n2kJPgcRGKQTWwyUzZHiULfIaNalCuYhoxMnIUlovQqe",
};

const publicJwk = {
  kty: "EC",
  crv: "P-384",
  kid: keyId,
  x: privateJwk.x,
  y: privateJwk.y,
};

let privateKeyPromise: Promise<Awaited<ReturnType<typeof importJWK>>> | undefined;

const getPrivateKey = async () => {
  if (!privateKeyPromise) {
    privateKeyPromise = importJWK(privateJwk, "ES384");
  }
  return privateKeyPromise;
};

const createCodeChallenge = (codeVerifier: string) => {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return hash
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
};

const dequeueProfile = (overrides?: Partial<LogtoStubProfile>): LogtoStubProfile => {
  const source = profileQueue.shift() ?? DEFAULT_PROFILE;
  return {
    sub: overrides?.sub ?? source.sub,
    email: overrides?.email ?? source.email,
    name: overrides?.name ?? source.name,
  };
};

export const logtoStub = {
  enqueueProfile(profile: Partial<LogtoStubProfile>) {
    profileQueue.push({
      sub: profile.sub ?? crypto.randomUUID(),
      email: profile.email ?? DEFAULT_PROFILE.email,
      name: profile.name ?? DEFAULT_PROFILE.name,
    });
  },

  clearProfiles() {
    profileQueue.length = 0;
  },

  issueAuthorization(codeChallenge?: string | null) {
    const profile = dequeueProfile();
    const code = crypto.randomBytes(16).toString("hex");
    authorizationCodes.set(code, { profile, codeChallenge });
    return { code, profile };
  },

  exchangeCode(code: string, codeVerifier?: string | null) {
    const entry = authorizationCodes.get(code);
    if (!entry) {
      return null;
    }

    authorizationCodes.delete(code);

    if (entry.codeChallenge) {
      if (!codeVerifier) {
        return null;
      }
      const expected = createCodeChallenge(codeVerifier);
      if (expected !== entry.codeChallenge) {
        return null;
      }
    }

    return entry.profile;
  },

  async createTokens(profile: LogtoStubProfile, options: { issuer: string; audience: string }) {
    const { issuer, audience } = options;
    const now = Math.floor(Date.now() / 1000);
    const expiration = now + 3600;

    const privateKey = await getPrivateKey();
    const idToken = await new SignJWT({
      sub: profile.sub,
      email: profile.email,
      name: profile.name,
    })
      .setProtectedHeader({ alg: "ES384", kid: keyId })
      .setIssuedAt(now)
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiration)
      .sign(privateKey);

    const accessToken = await new SignJWT({
      sub: profile.sub,
      scope: "openid profile email",
    })
      .setProtectedHeader({ alg: "ES384", kid: keyId })
      .setIssuedAt(now)
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiration)
      .sign(privateKey);

    accessTokens.set(accessToken, profile);

    return {
      idToken,
      accessToken,
      expiresIn: expiration - now,
    };
  },

  getJwks() {
    return { keys: [publicJwk] };
  },

  getProfileFromAccessToken(token: string) {
    return accessTokens.get(token);
  },
};
