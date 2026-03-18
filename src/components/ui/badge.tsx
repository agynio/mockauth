import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "border border-brand-500/30 bg-brand-600/15 text-brand-400",
        secondary: "border border-border bg-surface-2 text-foreground",
        destructive: "border border-error-500/40 bg-error-500/10 text-error-500",
        success: "border border-success-500/40 bg-success-500/10 text-success-500",
        warning: "border border-warning-500/40 bg-warning-500/10 text-warning-500",
        outline: "border border-border text-foreground",
        muted: "border border-border bg-surface-2 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
