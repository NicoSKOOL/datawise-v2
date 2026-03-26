import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { downloadCSV } from "@/lib/csvUtils";
import { cn, isNumericColumn, getComparisonColor, calculateColumnStats } from "@/lib/utils";

interface DataTableProps {
  data: any[];
  title: string;
  description?: string;
  loading?: boolean;
  enableComparison?: boolean;
}

export function DataTable({ data, title, description, loading = false, enableComparison = false }: DataTableProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Loading data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleDownloadCSV = () => {
    // Filter out React elements from data for CSV export
    const csvData = data.map(row => {
      const cleanRow: any = {};
      Object.keys(row).forEach(key => {
        const value = row[key];
        if (React.isValidElement(value)) {
          // Skip React elements in CSV export
          return;
        }
        cleanRow[key] = value;
      });
      return cleanRow;
    });
    downloadCSV(csvData, title.toLowerCase().replace(/\s+/g, '-'));
  };

  // Get columns from the first data item
  const columns = Object.keys(data[0]);
  
  // Calculate column statistics for comparison mode
  const columnStats = enableComparison && data.length > 1 ? 
    columns.reduce((stats, column) => {
      stats[column] = calculateColumnStats(data, column);
      return stats;
    }, {} as Record<string, any>) : {};

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <Button onClick={handleDownloadCSV} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column} className="whitespace-nowrap">
                    {column.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, index) => (
                <TableRow key={index}>
                  {columns.map((column) => {
                  const value = row[column];
                    const displayValue = typeof value === 'object' && value !== null ?
                      (React.isValidElement(value) ? value : JSON.stringify(value)) :
                      value?.toString() || '-';
                    
                    // Apply color coding for comparison mode
                    let cellClassName = "whitespace-nowrap";
                    
                    if (enableComparison && data.length > 1 && columnStats[column]?.hasNumericData && isNumericColumn(value)) {
                      const { min, max } = columnStats[column];
                      const colorClass = getComparisonColor(Number(value), min, max);
                      cellClassName = cn(cellClassName, colorClass);
                    }
                    
                    return (
                      <TableCell key={column} className={cellClassName}>
                        {React.isValidElement(displayValue) ? displayValue : displayValue}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {data.length} results
        </div>
      </CardContent>
    </Card>
  );
}