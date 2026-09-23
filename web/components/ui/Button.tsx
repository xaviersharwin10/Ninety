"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-lime text-[#06070a] hover:bg-[#d4ff66] active:scale-[0.98] shadow-[0_0_0_1px_rgba(198,255,61,0.4),0_10px_30px_-10px_rgba(198,255,61,0.5)]",
  secondary: "glass text-text hover:border-border-strong active:scale-[0.98]",
  ghost: "text-text-muted hover:text-text active:scale-[0.98]",
  danger: "bg-coral/15 text-coral border border-coral/30 hover:bg-coral/20 active:scale-[0.98]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading, fullWidth, disabled, className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`relative inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
});
