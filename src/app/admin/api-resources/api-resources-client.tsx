"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { MembershipRole } from "@/generated/prisma/client";
import {
  createApiResourceAction,
  setDefaultApiResourceAction,
  updateApiResourceAction,
} from "@/app/admin/actions";
import { CopyBundleButton, CopyField } from "@/app/admin/_components/copy-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ResourceRecord = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

type Props = {
  tenantId: string;
  tenantName: string;
  viewerRole: MembershipRole;
  defaultResourceId: string;
  origin: string;
  resources: ResourceRecord[];
};

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; resource: ResourceRecord }
  | null;

const resourceFormSchema = z.object({
  name: z.string().min(2, "Name must be at least two characters"),
  description: z.string().max(200, "Keep descriptions under 200 characters").optional().nullable(),
});

const ISSUER_FIELDS = [
  { key: "authorize", label: "Authorization endpoint" },
  { key: "token", label: "Token endpoint" },
  { key: "userinfo", label: "Userinfo" },
  { key: "jwks", label: "JWKS" },
  { key: "discovery", label: "Discovery (.well-known)" },
] as const;

const buildIssuerUrls = (origin: string, apiResourceId: string) => {
  const base = `${origin}/r/${apiResourceId}/oidc`;
  return {
    issuer: base,
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    userinfo: `${base}/userinfo`,
    jwks: `${base}/jwks.json`,
    discovery: `${base}/.well-known/openid-configuration`,
  };
};

export function ApiResourcesClient({ tenantId, tenantName, viewerRole, defaultResourceId, origin, resources }: Props) {
  const canManage = viewerRole === "OWNER" || viewerRole === "WRITER";
  const { toast } = useToast();
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [pendingDefault, startDefaultTransition] = useTransition();
  const issuerUrls = useMemo(() => buildIssuerUrls(origin, defaultResourceId), [origin, defaultResourceId]);
  const resourceMap = useMemo(() => new Map(resources.map((resource) => [resource.id, resource])), [resources]);
  const defaultResource = resourceMap.get(defaultResourceId) ?? resources[0];

  const form = useForm<z.infer<typeof resourceFormSchema>>({
    resolver: zodResolver(resourceFormSchema),
    defaultValues: { name: "", description: "" },
  });

  const [saving, startSaveTransition] = useTransition();

  const closeDialog = () => {
    setDialogState(null);
    form.reset({ name: "", description: "" });
  };

  const openCreateDialog = () => {
    form.reset({ name: "", description: "" });
    setDialogState({ mode: "create" });
  };

  const openEditDialog = (resource: ResourceRecord) => {
    form.reset({ name: resource.name, description: resource.description ?? "" });
    setDialogState({ mode: "edit", resource });
  };

  const handleSubmit = (values: z.infer<typeof resourceFormSchema>) => {
    if (!dialogState) {
      return;
    }

    startSaveTransition(async () => {
      const payload = { tenantId, name: values.name, description: values.description ?? null };
      const result =
        dialogState.mode === "create"
          ? await createApiResourceAction(payload)
          : await updateApiResourceAction({ ...payload, apiResourceId: dialogState.resource.id });

      if (result.error) {
        toast({ variant: "destructive", title: "Save failed", description: result.error });
        return;
      }

      toast({ title: dialogState.mode === "create" ? "API resource created" : "API resource updated" });
      router.refresh();
      closeDialog();
    });
  };

  const handleSetDefault = (resourceId: string) => {
    startDefaultTransition(async () => {
      const result = await setDefaultApiResourceAction({ tenantId, apiResourceId: resourceId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to update default", description: result.error });
        return;
      }
      toast({ title: "Default issuer updated" });
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Default issuer</CardTitle>
          <CardDescription>Copy the live endpoints for {tenantName}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6" data-testid="issuer-panel">
          <div className="text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{defaultResource?.name ?? "Default resource"}</p>
            <p>{tenantName}</p>
          </div>
          <section className="space-y-4">
            <CopyField label="Tenant ID" value={tenantId} testId="issuer-field-tenant" />
            <CopyField label="Issuer" value={issuerUrls.issuer} testId="issuer-field-issuer" />
            <CopyBundleButton
              label="Copy endpoints"
              testId="issuer-copy-bundle"
              items={[
                { label: "Issuer", value: issuerUrls.issuer },
                ...ISSUER_FIELDS.map(({ label, key }) => ({ label, value: issuerUrls[key] })),
              ]}
            />
          </section>
          <div className="grid gap-3 md:grid-cols-2">
            {ISSUER_FIELDS.map(({ label, key }) => (
              <CopyField key={key} label={label} value={issuerUrls[key]} testId={`issuer-field-${key}`} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>API resources</CardTitle>
            <CardDescription>Issue dedicated URLs per downstream API.</CardDescription>
          </div>
          {canManage ? (
            <Button type="button" onClick={openCreateDialog} data-testid="api-resource-create-btn">
              Create resource
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {resources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API resources yet. Writers and owners can create them.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((resource) => {
                  const isDefault = resource.id === defaultResourceId;
                  return (
                    <TableRow key={resource.id} data-testid="api-resource-row" data-resource-id={resource.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-foreground">{resource.name}</span>
                          {isDefault ? (
                            <Badge variant="outline" className="w-fit text-xs" data-testid="api-resource-default-badge">
                              Default issuer
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {resource.description ?? "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {format(new Date(resource.createdAt), "PPP")}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => openEditDialog(resource)} disabled={!canManage}>
                          Edit
                        </Button>
                        {!isDefault && canManage ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetDefault(resource.id)}
                            disabled={pendingDefault}
                            data-testid="api-resource-set-default"
                          >
                            Set default
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(dialogState)} onOpenChange={(open) => (!open ? closeDialog() : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogState?.mode === "edit" ? "Edit API resource" : "Create API resource"}</DialogTitle>
            <DialogDescription>
              {dialogState?.mode === "edit"
                ? "Update the display name or description for this issuer."
                : "Name the downstream API that will use this issuer."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4" data-testid="api-resource-form">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input placeholder="Payments API" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Optional notes" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : dialogState?.mode === "edit" ? "Save changes" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
