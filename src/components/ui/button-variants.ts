import { cva, type VariantProps } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 ring-offset-background",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-brand-500",
        secondary: "bg-secondary text-secondary-foreground hover:bg-surface-3/80 focus-visible:ring-brand-500",
        outline: "border border-border bg-transparent text-primary hover:bg-surface-3 focus-visible:ring-brand-500",
        ghost: "bg-transparent text-foreground hover:bg-surface-2 active:bg-surface-3 focus-visible:ring-brand-500",
        destructive: "bg-destructive text-destructive-foreground hover:bg-error-700 active:bg-error-700 focus-visible:ring-error-500",
        link: "text-brand-400 underline underline-offset-4 hover:text-brand-500 focus-visible:ring-brand-500 focus-visible:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
