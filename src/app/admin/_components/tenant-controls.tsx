"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { createTenantAction, setActiveTenantAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type TenantOption = {
  id: string;
  name: string;
};

const tenantFormSchema = z.object({
  name: z.string().min(2, "Tenant name must include at least two characters"),
});

type TenantFormValues = z.infer<typeof tenantFormSchema>;

export function TenantSwitcher({
  tenants,
  activeTenantId,
  onAddTenant,
}: {
  tenants: TenantOption[];
  activeTenantId: string | null;
  onAddTenant: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const [optimisticTenantId, setOptimisticTenantId] = useState<string | null>(null);

  const fallbackTenantId = tenants[0]?.id ?? "";
  const selectedTenantId = optimisticTenantId ?? activeTenantId ?? fallbackTenantId;
  const activeTenant = tenants.find((tenant) => tenant.id === selectedTenantId);
  const filteredTenants = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) {
      return tenants;
    }
    return tenants.filter((tenant) => tenant.name.toLowerCase().includes(trimmed) || tenant.id.toLowerCase().includes(trimmed));
  }, [searchQuery, tenants]);

  const handleSelect = (tenantId: string) => {
    if (!tenantId || tenantId === selectedTenantId || pending) {
      setOpen(false);
      return;
    }
    setOptimisticTenantId(tenantId);
    startTransition(async () => {
      const result = await setActiveTenantAction({ tenantId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to set tenant", description: result.error });
        setOptimisticTenantId(null);
        return;
      }
      router.refresh();
      toast({ title: "Active tenant updated", description: `Switched to ${tenants.find((t) => t.id === tenantId)?.name ?? tenantId}` });
      setOptimisticTenantId(null);
      setSearchQuery("");
      setOpen(false);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
        <span>Active tenant</span>
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select tenant"
            data-testid="tenant-switcher"
            className="w-full justify-between"
          >
            <div className="flex flex-col text-left">
              <span className="font-semibold">
                {activeTenant ? activeTenant.name : tenants.length === 0 ? "No tenants" : "Select tenant"}
              </span>
              {activeTenant ? <span className="text-xs text-muted-foreground">{activeTenant.id}</span> : null}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start" sideOffset={8}>
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search tenants"
                className="pl-8"
                data-testid="tenant-search"
              />
            </div>
          </div>
          <div
            className="max-h-64 overflow-y-auto p-1"
            role="listbox"
            aria-label="Tenants"
            data-testid="tenant-options"
          >
            {filteredTenants.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                {tenants.length === 0 ? "No tenants yet. Create one to get started." : "No tenants match your search."}
              </p>
            ) : (
              filteredTenants.map((tenant) => {
                const isSelected = tenant.id === selectedTenantId;
                return (
                  <button
                    key={tenant.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(tenant.id)}
                    className={cn(
                      "flex w-full flex-col items-start rounded-md px-3 py-2 text-left text-sm",
                      isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    )}
                    data-testid={`tenant-option-${tenant.id}`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="font-medium">{tenant.name}</span>
                      {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                    </div>
                    <span className="text-xs text-muted-foreground">{tenant.id}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t bg-muted/40 p-3">
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-center gap-2"
              onClick={() => {
                setOpen(false);
                setSearchQuery("");
                onAddTenant();
              }}
              data-testid="tenant-option-add"
            >
              <Plus className="h-4 w-4" />
              Add tenant
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function CreateTenantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: { name: "" },
  });
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const handleSubmit = (values: TenantFormValues) => {
    startTransition(async () => {
      const result = await createTenantAction(values);
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to create tenant", description: result.error });
        return;
      }
      router.refresh();
      toast({ title: "Tenant created", description: result.success ?? "Tenant added" });
      form.reset();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tenant</DialogTitle>
          <DialogDescription>Provide a descriptive name so your team can identify the tenant quickly.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tenant name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Corp QA" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create tenant"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
