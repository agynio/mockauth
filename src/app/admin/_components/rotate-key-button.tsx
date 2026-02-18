"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { rotateKeyAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export const RotateKeyButton = ({ tenantId }: { tenantId: string }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleRotate = () => {
    startTransition(async () => {
      const result = await rotateKeyAction({ tenantId });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to rotate key", description: result.error });
        return;
      }
      router.refresh();
      toast({ title: "Signing key rotated", description: "JWKS now contains the new key" });
    });
  };

  return (
    <Button type="button" variant="secondary" onClick={handleRotate} disabled={pending} className="mt-4">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rotate signing key"}
    </Button>
  );
};
