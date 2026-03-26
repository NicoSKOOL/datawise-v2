import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Color calculation utilities for domain comparison
export function isNumericColumn(value: any): boolean {
  return typeof value === 'number' || (!isNaN(Number(value)) && value !== '' && value !== null);
}

export function getComparisonColor(value: number, minValue: number, maxValue: number): string {
  if (maxValue === minValue) return 'bg-muted/20'; // Default for equal values
  
  // Calculate relative position (0 to 1)
  const relativePosition = (value - minValue) / (maxValue - minValue);
  
  // Create background with success color and varying opacity
  if (relativePosition >= 0.8) return 'bg-success/80 text-success-foreground';
  if (relativePosition >= 0.6) return 'bg-success/60 text-success-foreground';
  if (relativePosition >= 0.4) return 'bg-success/40';
  if (relativePosition >= 0.2) return 'bg-success/25';
  return 'bg-success/10';
}

export function calculateColumnStats(data: any[], column: string) {
  const numericValues = data
    .map(row => row[column])
    .filter(val => isNumericColumn(val))
    .map(val => Number(val));
  
  if (numericValues.length === 0) {
    return { min: 0, max: 0, hasNumericData: false };
  }
  
  return {
    min: Math.min(...numericValues),
    max: Math.max(...numericValues),
    hasNumericData: true
  };
}
