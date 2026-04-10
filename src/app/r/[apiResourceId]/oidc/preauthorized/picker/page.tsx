import { redirect } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { parseAuthorizeReturnTo, toRelativeReturnTo } from "@/server/oidc/return-to";
import { getRequestOrigin } from "@/server/utils/request-origin";

type PageProps = {
  params: Promise<{ apiResourceId: string }>;
  searchParams?: Promise<{ return_to?: string }>;
};

const renderError = (message: string) => (
  <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
    <div className="w-full max-w-md rounded-2xl border border-border bg-surface-1/90 p-8 text-center shadow-2xl">
      <h1 className="mb-3 text-2xl font-semibold">Preauthorized session unavailable</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="ghost" size="sm" className="mt-6">
        <Link href="/">Return home</Link>
      </Button>
    </div>
  </div>
);

export default async function PreauthorizedPickerPage({ params, searchParams }: PageProps) {
  const { apiResourceId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const returnTo = resolvedSearchParams?.return_to;
  const origin = await getRequestOrigin();
  const returnToUrl = parseAuthorizeReturnTo(returnTo, {
    apiResourceId,
    origin,
  });
  if (!returnToUrl) {
    return renderError("The authorization request has expired. Please start again.");
  }
  returnToUrl.searchParams.set("auth_strategy", "preauthorized");
  const loginUrl = new URL(`/r/${apiResourceId}/oidc/login`, origin);
  loginUrl.searchParams.set("return_to", returnToUrl.toString());
  redirect(toRelativeReturnTo(loginUrl));
}
