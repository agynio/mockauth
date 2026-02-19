import { env } from "@/server/env";

let override: boolean | null = null;

export const allowAnyRedirects = () => {
  if (override !== null) {
    return override;
  }
  return env.MOCKAUTH_ALLOW_ANY_REDIRECT;
};

export const setAllowAnyRedirectOverride = (value: boolean | null) => {
  override = value;
};
