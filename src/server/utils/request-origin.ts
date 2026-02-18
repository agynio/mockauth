import { headers } from "next/headers";

export const getRequestOrigin = async () => {
  const headerList = await headers();
  const forwardedHost = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim();
    if (host) {
      return `${proto}://${host}`;
    }
  }

  const fallback = process.env.NEXTAUTH_URL;
  if (fallback) {
    try {
      return new URL(fallback).origin;
    } catch {}
  }

  return "http://localhost:3000";
};
