import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-xl border px-4 py-3 text-sm text-foreground [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-2 [&>svg]:text-muted-foreground",
        success: "border-success-500/60 bg-success-500/10 text-success-500 [&>svg]:text-success-500",
        warning: "border-warning-500/60 bg-warning-500/10 text-warning-500 [&>svg]:text-warning-500",
        destructive: "border-error-500/60 bg-error-500/10 text-error-500 [&>svg]:text-error-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(function Alert(
  { className, variant, ...props },
  ref,
) {
  return <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
});

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(function AlertTitle(
  { className, ...props },
  ref,
) {
  return <h5 ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />;
});

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(function AlertDescription(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />;
});

export { Alert, AlertDescription, AlertTitle };
