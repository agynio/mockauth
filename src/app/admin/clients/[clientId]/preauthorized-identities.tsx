"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2, UserPlus } from "lucide-react";

import {
  deletePreauthorizedIdentityAction,
  refreshPreauthorizedIdentityAction,
  startPreauthorizedAdminAuthAction,
} from "@/app/admin/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";

export type PreauthorizedIdentitySummary = {
  id: string;
  label: string;
  metadata?: string | null;
  updatedAtLabel: string;
  providerScope?: string | null;
  accessTokenExpiresAtLabel?: string | null;
  refreshTokenExpiresAtLabel?: string | null;
};

type Props = {
  clientId: string;
  canManage: boolean;
  identities: PreauthorizedIdentitySummary[];
};

export function PreauthorizedIdentitySection({ clientId, canManage, identities }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"refresh" | "delete" | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleStartCapture = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) {
      toast({ variant: "destructive", title: "Not authorized", description: "You need write access." });
      return;
    }
    startTransition(async () => {
      const result = await startPreauthorizedAdminAuthAction({
        clientId,
        identityLabel: label.trim() || undefined,
      });
      if (result.error || !result.data?.authorizationUrl) {
        toast({ variant: "destructive", title: "Unable to start", description: result.error ?? "Try again." });
        return;
      }
      window.location.assign(result.data.authorizationUrl);
    });
  };

  const runIdentityAction = (identityId: string, action: "refresh" | "delete") => {
    if (!canManage) {
      toast({ variant: "destructive", title: "Not authorized", description: "You need write access." });
      return;
    }
    if (action === "delete") {
      const confirmed = window.confirm("Remove this preauthorized identity?");
      if (!confirmed) {
        return;
      }
    }
    setPendingIdentity(identityId);
    setPendingAction(action);
    startTransition(async () => {
      const result =
        action === "refresh"
          ? await refreshPreauthorizedIdentityAction({ identityId })
          : await deletePreauthorizedIdentityAction({ identityId });
      if (result.error) {
        toast({ variant: "destructive", title: "Action failed", description: result.error });
      } else {
        toast({ title: action === "refresh" ? "Tokens refreshed" : "Identity deleted" });
        router.refresh();
      }
      setPendingIdentity(null);
      setPendingAction(null);
    });
  };

  const isRowPending = (identityId: string, action: "refresh" | "delete") =>
    isPending && pendingIdentity === identityId && pendingAction === action;

  return (
    <Card data-testid="preauthorized-identities">
      <CardHeader>
        <CardTitle>Preauthorized identities</CardTitle>
        <CardDescription>
          Capture upstream identities for this client so end-users can select them during authorization.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleStartCapture} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-2 text-sm text-foreground">
            <span className="font-medium">Identity label (optional)</span>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="QA admin"
              disabled={isPending || !canManage}
            />
          </label>
          <Button type="submit" disabled={isPending || !canManage} className="w-full sm:w-auto">
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            Add identity
          </Button>
        </form>

        {!canManage ? <p className="text-xs text-muted-foreground">Only owners or writers can manage identities.</p> : null}

        {identities.length === 0 ? (
          <Alert>
            <AlertTitle>No identities yet</AlertTitle>
            <AlertDescription>Start a preauthorized capture to add the first identity.</AlertDescription>
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identity</TableHead>
                <TableHead>Provider scope</TableHead>
                <TableHead>Access token</TableHead>
                <TableHead>Refresh token</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {identities.map((identity) => (
                <TableRow key={identity.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{identity.label}</div>
                      {identity.metadata ? (
                        <div className="text-xs text-muted-foreground">{identity.metadata}</div>
                      ) : null}
                      <div className="text-[0.7rem] text-muted-foreground">Updated {identity.updatedAtLabel}</div>
                    </div>
                  </TableCell>
                  <TableCell>{identity.providerScope ?? "—"}</TableCell>
                  <TableCell>{identity.accessTokenExpiresAtLabel ?? "—"}</TableCell>
                  <TableCell>{identity.refreshTokenExpiresAtLabel ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => runIdentityAction(identity.id, "refresh")}
                        disabled={isPending || !canManage}
                      >
                        {isRowPending(identity.id, "refresh") ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-3 w-3" />
                        )}
                        Refresh
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => runIdentityAction(identity.id, "delete")}
                        disabled={isPending || !canManage}
                      >
                        {isRowPending(identity.id, "delete") ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-3 w-3" />
                        )}
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
