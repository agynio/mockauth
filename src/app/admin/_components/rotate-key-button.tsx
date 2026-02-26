"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { rotateKeyAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { JwtSigningAlg } from "@/generated/prisma/client";

export const RotateKeyButton = ({
  tenantId,
  alg,
  canRotate,
  hasActiveKey,
}: {
  tenantId: string;
  alg: JwtSigningAlg;
  canRotate: boolean;
  hasActiveKey: boolean;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleRotate = () => {
    startTransition(async () => {
      const result = await rotateKeyAction({ tenantId, alg });
      if (result.error) {
        toast({ variant: "destructive", title: "Unable to rotate key", description: result.error });
        return;
      }
      router.refresh();
      toast({ title: result.success ?? "Signing key rotated", description: "JWKS now contains the new key" });
    });
  };

  const label = hasActiveKey ? `Rotate ${alg}` : `Generate ${alg}`;
  const disabledLabel = canRotate ? label : "Owner access required";

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleRotate}
      disabled={pending || !canRotate}
      className="mt-2 w-full sm:mt-0 sm:w-auto"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : disabledLabel}
    </Button>
  );
};
