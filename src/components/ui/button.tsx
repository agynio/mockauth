"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";
import { buttonVariants, type ButtonVariantProps } from "@/components/ui/button-variants";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariantProps {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
  const { className, variant, size, asChild = false, ...rest } = props;
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...rest} />;
});
Button.displayName = "Button";

export { buttonVariants };
