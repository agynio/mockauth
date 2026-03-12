"use client";

import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<React.ElementRef<typeof ToastPrimitives.Viewport>, React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>>(
  ({ className, ...props }, ref) => (
    <ToastPrimitives.Viewport
      ref={ref}
      className={cn("fixed bottom-4 right-4 z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-2", className)}
      {...props}
    />
  ),
);
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = {
  default: "border border-border bg-surface-2 text-foreground",
  success: "border border-success-500/50 bg-success-500/10 text-success-500",
  warning: "border border-warning-500/50 bg-warning-500/10 text-warning-500",
  destructive: "border border-error-500/60 bg-error-500/10 text-error-500",
};

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & { variant?: keyof typeof toastVariants }
>(({ className, variant = "default", ...props }, ref) => (
  <ToastPrimitives.Root
    ref={ref}
    className={cn(
      "pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-xl border px-4 py-3 shadow-xl ring-offset-background transition data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full",
      toastVariants[variant],
      className,
    )}
    {...props}
  />
));
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = ToastPrimitives.Action;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-3 top-3 rounded-md opacity-60 ring-offset-background transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title ref={ref} className={cn("text-sm font-semibold", className)} {...props} />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

export { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose, ToastAction };
