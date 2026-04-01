import { cookies } from "next/headers";
import Link from "next/link";
import { format } from "date-fns";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { listPreauthorizedIdentities } from "@/server/services/preauthorized-identity-service";
import { getPickerTransaction } from "@/server/services/preauthorized-picker-service";
import { PREAUTHORIZED_PICKER_COOKIE } from "@/server/oidc/preauthorized/constants";

type PageProps = {
  params: Promise<{ apiResourceId: string }>;
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

export default async function PreauthorizedPickerPage({ params }: PageProps) {
  const { apiResourceId } = await params;
  const store = await cookies();
  const transactionId = store.get(PREAUTHORIZED_PICKER_COOKIE)?.value;
  if (!transactionId) {
    return renderError("The authorization request has expired. Please start again.");
  }

  const transaction = await getPickerTransaction(transactionId);
  if (!transaction || transaction.apiResourceId !== apiResourceId) {
    return renderError("The authorization request could not be found.");
  }
  if (transaction.consumedAt || transaction.expiresAt < new Date()) {
    return renderError("This authorization request is no longer active.");
  }

  const { tenant } = await getApiResourceWithTenant(apiResourceId);
  const identities = await listPreauthorizedIdentities(transaction.tenantId, transaction.clientId);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 text-foreground">
      <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-surface-1/90 p-8 shadow-2xl">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Select a preauthorized identity</h1>
          <p className="text-sm text-muted-foreground">
            Choose which identity should authorize access to <strong>{transaction.client.name}</strong> on tenant{" "}
            <strong>{tenant.name}</strong>.
          </p>
        </div>

        {identities.length === 0 ? (
          <Alert>
            <AlertTitle>No preauthorized identities</AlertTitle>
            <AlertDescription>
              An administrator must preauthorize at least one identity for this client before access can be granted.
            </AlertDescription>
          </Alert>
        ) : (
          <form
            method="POST"
            action={`/r/${apiResourceId}/oidc/preauthorized/picker/select`}
            className="space-y-4"
          >
            <fieldset className="space-y-3">
              {identities.map((identity, index) => {
                const label = identity.label ?? identity.providerEmail ?? identity.providerSubject ?? identity.id;
                const metadata = [identity.providerEmail, identity.providerSubject].filter(Boolean).join(" · ");
                return (
                  <label
                    key={identity.id}
                    className="flex gap-3 rounded-xl border border-border bg-surface-2/70 p-4 text-sm shadow-sm"
                  >
                    <input
                      type="radio"
                      name="identity_id"
                      value={identity.id}
                      required
                      defaultChecked={index === 0}
                      className="mt-1 h-4 w-4 rounded-full border border-border text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    />
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{label}</div>
                      {metadata ? <div className="text-xs text-muted-foreground">{metadata}</div> : null}
                      <div className="text-[0.7rem] text-muted-foreground">
                        Last updated {format(identity.updatedAt, "MMM d, yyyy 'at' h:mm a")}
                      </div>
                    </div>
                  </label>
                );
              })}
            </fieldset>
            <Button type="submit" size="lg" className="w-full text-base">
              Continue
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
