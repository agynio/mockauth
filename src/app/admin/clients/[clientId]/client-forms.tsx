"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Loader2, Trash2 } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import {
  addRedirectUriAction,
  deleteRedirectUriAction,
  rotateClientSecretAction,
  updateClientNameAction,
} from "@/app/admin/actions";
import { CopyField } from "@/app/admin/_components/copy-field";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

const nameSchema = z.object({ name: z.string().min(2, "Name must be at least 2 characters") });
const redirectSchema = z.object({ uri: z.string().url("Enter a valid URL") });

export function UpdateClientNameForm({ clientId, initialName }: { clientId: string; initialName: string }) {
  const router = useRouter();
  const form = useForm<z.infer<typeof nameSchema>>({ resolver: zodResolver(nameSchema), defaultValues: { name: initialName } });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  useEffect(() => {
    form.reset({ name: initialName });
  }, [initialName, form]);

  const onSubmit = (values: z.infer<typeof nameSchema>) => {
    startTransition(async () => {
      const result = await updateClientNameAction({ clientId, name: values.name });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to update", description: result.error });
        return;
      }
      router.refresh();
      toast({ title: "Client updated", description: result.success ?? "Saved" });
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs text-muted-foreground">Client name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending} className="self-end">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
      </form>
    </Form>
  );
}

export function RotateSecretForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const { toast } = useToast();

  const rotate = () => {
    startTransition(async () => {
      const result = await rotateClientSecretAction({ clientId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to rotate", description: result.error });
        return;
      }
      if (result.data?.clientSecret) {
        setClientSecret(result.data.clientSecret);
      }
      router.refresh();
      toast({ title: "Client secret rotated", description: "Copy the new secret immediately" });
    });
  };

  return (
    <div className="space-y-4">
      {clientSecret ? (
        <CopyField
          label="New client secret"
          value={clientSecret}
          description="Secret is shown once. Store securely."
        />
      ) : null}
      <Button type="button" variant="secondary" onClick={rotate} disabled={pending} className="w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rotate secret"}
      </Button>
    </div>
  );
}

export function AddRedirectForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const form = useForm<z.infer<typeof redirectSchema>>({ resolver: zodResolver(redirectSchema), defaultValues: { uri: "" } });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const onSubmit = (values: z.infer<typeof redirectSchema>) => {
    startTransition(async () => {
      const result = await addRedirectUriAction({ clientId, uri: values.uri });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to save redirect", description: result.error });
        return;
      }
      toast({ title: "Redirect saved" });
      form.reset();
      router.refresh();
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField
          control={form.control}
          name="uri"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Redirect URI</FormLabel>
              <FormControl>
                <Input placeholder="https://app.example.com/callback" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending} className="self-end">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
        </Button>
      </form>
    </Form>
  );
}

export function DeleteRedirectButton({ redirectId }: { redirectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteRedirectUriAction({ redirectId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to remove", description: result.error });
        return;
      }
      toast({ title: "Redirect removed" });
      router.refresh();
    });
  };

  return (
    <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={handleDelete} disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      {!pending && <span className="ml-1 text-sm">Remove</span>}
    </Button>
  );
}
