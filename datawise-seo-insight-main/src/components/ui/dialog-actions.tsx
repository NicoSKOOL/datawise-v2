import * as React from "react";
import { cn } from "@/lib/utils";

interface DialogActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function DialogActions({ children, className, ...props }: DialogActionsProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 pt-6 mt-6 border-t border-border/50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
