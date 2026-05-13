import * as React from "react";
import { cn } from "@/lib/utils";

export const Surface = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Surface({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-card text-card-foreground rounded-xl shadow-card border-0",
          "transition-shadow hover:shadow-card-hover",
          className
        )}
        {...props}
      />
    );
  }
);

export function SurfaceHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-6 pt-6 pb-4 flex items-start justify-between gap-4", className)}
      {...props}
    />
  );
}

export function SurfaceTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-headline text-base font-semibold leading-tight tracking-tight", className)}
      {...props}
    />
  );
}

export function SurfaceDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />
  );
}

export function SurfaceBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pb-6", className)} {...props} />;
}
