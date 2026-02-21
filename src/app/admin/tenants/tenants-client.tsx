"use client";

import { useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { AlertTriangle, Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import type { MembershipRole } from "@/generated/prisma/client";
import { deleteTenantAction, setActiveTenantAction } from "@/app/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";

type TenantRecord = {
  membershipId: string;
  tenantId: string;
  name: string;
  createdAt: string;
  role: MembershipRole;
};

type Props = {
  tenants: TenantRecord[];
  activeTenantId: string | null;
};

const formatDate = (value: string) => format(new Date(value), "MMM d, yyyy");

export function TenantsClient({ tenants, activeTenantId }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [copiedTenantId, setCopiedTenantId] = useState<string | null>(null);
  const [dialogTenant, setDialogTenant] = useState<TenantRecord | null>(null);
  const [switchingTenantId, setSwitchingTenantId] = useState<string | null>(null);
  const [isSwitching, startSwitchTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const sortedTenants = useMemo(() => {
    return [...tenants].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }, [tenants]);

  const handleCopy = async (tenantId: string) => {
    try {
      await navigator.clipboard.writeText(tenantId);
      setCopiedTenantId(tenantId);
      setTimeout(() => setCopiedTenantId((current) => (current === tenantId ? null : current)), 1500);
      toast({ title: "Tenant ID copied" });
    } catch (error) {
      console.error("Failed to copy tenant ID", error);
      toast({ variant: "destructive", title: "Copy failed", description: "Unable to copy tenant ID" });
    }
  };

  const handleSwitch = (tenant: TenantRecord) => {
    if (tenant.tenantId === activeTenantId || isSwitching) {
      return;
    }
    setSwitchingTenantId(tenant.tenantId);
    startSwitchTransition(async () => {
      const result = await setActiveTenantAction({ tenantId: tenant.tenantId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to open tenant", description: result.error });
        setSwitchingTenantId(null);
        return;
      }
      router.refresh();
      toast({ title: "Tenant switched", description: `Now viewing ${tenant.name}` });
      setSwitchingTenantId(null);
    });
  };

  const handleDelete = () => {
    if (!dialogTenant) {
      return;
    }
    startDeleteTransition(async () => {
      const result = await deleteTenantAction({ tenantId: dialogTenant.tenantId });
      if (result.error) {
        toast({ variant: "destructive", title: "Delete failed", description: result.error });
        return;
      }
      toast({ title: "Tenant deleted", description: `${dialogTenant.name} has been removed.` });
      setDialogTenant(null);
      if ((result.data?.remainingTenants ?? 0) === 0) {
        router.push("/admin");
      } else {
        router.refresh();
      }
    });
  };

  if (sortedTenants.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No tenants yet</CardTitle>
          <CardDescription>Use the tenant switcher to create your first tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The sidebar switcher includes an &ldquo;Add tenant&rdquo; button once you open it. Create a tenant to unlock admin tools.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Tenants</CardTitle>
            <CardDescription>View and manage every tenant linked to your account.</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Deleting a tenant removes all dependent data.
          </div>
        </CardHeader>
        <CardContent>
          <Table data-testid="tenants-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Tenant ID</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTenants.map((tenant) => {
                const isActive = tenant.tenantId === activeTenantId;
                const canDelete = tenant.role === "OWNER";
                return (
                  <TableRow key={tenant.tenantId} data-testid={`tenant-row-${tenant.tenantId}`}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{tenant.name}</span>
                          {isActive ? <Badge variant="outline">Active</Badge> : null}
                        </div>
                        <p className="text-xs uppercase text-muted-foreground">{tenant.role.toLowerCase()}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">{tenant.tenantId}</code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Copy ${tenant.name} ID`}
                          onClick={() => handleCopy(tenant.tenantId)}
                          data-testid={`tenant-copy-${tenant.tenantId}`}
                        >
                          {copiedTenantId === tenant.tenantId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground" data-testid={`tenant-created-${tenant.tenantId}`}>
                      {formatDate(tenant.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleSwitch(tenant)}
                          disabled={isActive || isSwitching || switchingTenantId === tenant.tenantId}
                          data-testid={`tenant-open-${tenant.tenantId}`}
                        >
                          <ExternalLink className="mr-2 h-3.5 w-3.5" />
                          Open
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canDelete}
                          onClick={() => setDialogTenant(tenant)}
                          data-testid={`tenant-delete-${tenant.tenantId}`}
                          aria-disabled={!canDelete}
                          title={canDelete ? undefined : "Only owners can delete tenants"}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(dialogTenant)} onOpenChange={(open) => !open && setDialogTenant(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {dialogTenant?.name ?? "tenant"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action permanently removes the tenant and the following data:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
            <li>OAuth clients and redirect URIs</li>
            <li>API resources and signing keys</li>
            <li>Memberships, invites, and tenant cookies</li>
            <li>Issued authorization codes, access tokens, and mock sessions</li>
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="tenant-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="tenant-delete-confirm"
            >
              Delete tenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
