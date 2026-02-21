"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

import { deleteTenantAction } from "@/app/admin/actions";
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
  tenantId: string;
  tenantName: string;
  canDelete: boolean;
};

export function TenantDangerZone({ tenantId, tenantName, canDelete }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDelete = () => {
    startDeleteTransition(async () => {
      const result = await deleteTenantAction({ tenantId });
      if (result.error) {
        toast({ variant: "destructive", title: "Delete failed", description: result.error });
        return;
      }
      toast({ title: "Tenant deleted", description: `${tenantName} has been removed.` });
      setDialogOpen(false);
      router.refresh();
    });
  };

  return (
    <Card data-testid="tenant-danger-zone">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger zone
        </CardTitle>
        <CardDescription>Deleting a tenant permanently removes all linked clients, members, and tokens.</CardDescription>
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
            data-testid="tenant-danger-delete"
          >
            Delete tenant
          </Button>
          {!canDelete ? (
            <p className="text-xs text-muted-foreground">Only tenant owners can delete tenants.</p>
          ) : null}
        </div>
      </CardContent>
      <AlertDialog open={isDialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {tenantName}?</AlertDialogTitle>
            <AlertDialogDescription>
              All data for this tenant will be removed immediately. This includes clients, API resources, members, and sessions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={isDeleting}
              data-testid="tenant-danger-confirm"
            >
              Delete tenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
