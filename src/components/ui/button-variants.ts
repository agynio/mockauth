import { cva, type VariantProps } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 ring-offset-background",
  {
    variants: {
      variant: {
        default: "bg-brand-500 text-brand-900 shadow-lg shadow-brand-900/50 hover:bg-brand-400",
        subtle: "bg-brand-950 text-brand-100 hover:bg-brand-900",
        secondary: "bg-secondary text-secondary-foreground hover:bg-surface-3/80",
        outline: "border border-border bg-transparent text-foreground hover:bg-surface-2/80",
        ghost: "text-foreground hover:bg-surface-2/60",
        destructive: "bg-error-500 text-foreground hover:bg-error-500/80 focus-visible:ring-error-400",
        link: "text-brand-400 underline underline-offset-4 hover:text-brand-300",
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
