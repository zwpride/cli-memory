import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[1.1rem] text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(180deg,rgba(84,162,255,0.95),rgba(36,115,255,0.92))] text-white shadow-[0_18px_38px_-22px_rgba(37,99,235,0.75)] hover:-translate-y-0.5 hover:shadow-[0_22px_46px_-24px_rgba(37,99,235,0.7)]",
        destructive:
          "bg-[linear-gradient(180deg,rgba(248,113,113,0.96),rgba(220,38,38,0.92))] text-white shadow-[0_18px_38px_-24px_rgba(220,38,38,0.75)] hover:-translate-y-0.5 hover:shadow-[0_22px_46px_-24px_rgba(220,38,38,0.7)]",
        outline:
          "border border-white/55 bg-white/72 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl hover:border-white/70 hover:bg-white/84 dark:border-white/10 dark:bg-white/[0.06] dark:text-foreground dark:hover:border-white/16 dark:hover:bg-white/[0.1]",
        secondary:
          "border border-white/40 bg-white/46 text-muted-foreground backdrop-blur-xl hover:bg-white/72 hover:text-foreground dark:border-white/8 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] dark:hover:text-foreground",
        ghost:
          "text-muted-foreground hover:bg-white/62 hover:text-foreground dark:hover:bg-white/[0.08] dark:hover:text-foreground",
        mcp: "bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700",
        link: "text-blue-500 underline-offset-4 hover:underline dark:text-blue-400",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-[0.95rem] px-3 text-xs",
        lg: "h-10 rounded-[1.2rem] px-8",
        icon: "h-9 w-9 p-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
