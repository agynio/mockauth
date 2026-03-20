"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

import { deleteClientAction } from "@/app/admin/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

type Props = {
  clientId: string;
  clientName: string;
  canDelete: boolean;
};

export function ClientDangerZone({ clientId, clientName, canDelete }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDelete = () => {
    startDeleteTransition(async () => {
      const result = await deleteClientAction({ clientId });
      if (result.error) {
        toast({ variant: "destructive", title: "Delete failed", description: result.error });
        return;
      }
      toast({ title: "Client deleted", description: `${clientName} has been removed.` });
      setDialogOpen(false);
      router.push("/admin/clients");
      router.refresh();
    });
  };

  return (
    <Card data-testid="client-danger-zone">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger zone
        </CardTitle>
        <CardDescription>Deleting a client permanently removes all linked redirect URIs, tokens, and proxy data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This action cannot be undone. Ensure you have exported any required configuration before continuing.
        </p>
        <div className="space-y-2">
          <Button
            variant="destructive"
            onClick={() => setDialogOpen(true)}
            disabled={!canDelete}
            data-testid="client-danger-delete"
          >
            Delete client
          </Button>
          {!canDelete ? (
            <p className="text-xs text-muted-foreground">Only owners or writers can delete clients.</p>
          ) : null}
        </div>
      </CardContent>
      <AlertDialog open={isDialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {clientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              All data for this client will be removed immediately. This includes redirect URIs, tokens, and proxy sessions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={isDeleting}
              data-testid="client-danger-confirm"
            >
              Delete client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
