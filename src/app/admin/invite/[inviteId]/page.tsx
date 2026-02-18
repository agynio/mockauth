import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authOptions } from "@/server/auth/options";
import { acceptInviteLink } from "@/server/services/membership-service";
import { DomainError } from "@/server/errors";
import { getRequestOrigin } from "@/server/utils/request-origin";

type PageParams = Promise<{ inviteId: string }>;
type SearchParams = Promise<{ token?: string }>;

const roleLabels: Record<string, string> = {
  OWNER: "owner",
  WRITER: "writer",
  READER: "reader",
};

const buildCallbackUrl = async (inviteId: string, token: string | null) => {
  const origin = await getRequestOrigin();
  const query = new URLSearchParams();
  if (token) {
    query.set("token", token);
  }
  const suffix = query.toString();
  return `${origin}/admin/invite/${inviteId}${suffix ? `?${suffix}` : ""}`;
};

export default async function AcceptInvitePage({ params, searchParams }: { params: PageParams; searchParams: SearchParams }) {
  const { inviteId } = await params;
  const resolvedSearch = await searchParams;
  const token = typeof resolvedSearch?.token === "string" ? resolvedSearch.token : null;

  if (!token) {
    return <InviteError heading="Missing invite token" description="The link is incomplete. Ask the tenant owner for a new invite." />;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const callbackUrl = await buildCallbackUrl(inviteId, token);
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  let result: Awaited<ReturnType<typeof acceptInviteLink>> | null = null;
  let errorMessage: string | null = null;

  try {
    result = await acceptInviteLink({ inviteId, token, userId: session!.user!.id });
  } catch (error) {
    errorMessage = error instanceof DomainError ? error.message : "Something went wrong when validating this invite.";
  }

  if (!result) {
    return <InviteError heading="Unable to accept invite" description={errorMessage ?? "Please try again later."} />;
  }

  const roleLabel = roleLabels[result.role] ?? result.role.toLowerCase();
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>You&apos;re in</CardTitle>
          <CardDescription>Access granted to {result.tenantName}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You joined <span className="font-semibold">{result.tenantName}</span> as a {roleLabel}. Head to the admin console to manage clients.
          </p>
          <Button asChild>
            <Link href="/admin/clients">Go to clients</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

const InviteError = ({ heading, description }: { heading: string; description: string }) => (
  <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-10">
    <Card className="w-full border-destructive/40">
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/admin/clients">Back to admin console</Link>
        </Button>
      </CardContent>
    </Card>
  </main>
);
