import * as React from "react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DateRangePickerProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  className?: string;
}

export function DateRangePicker({
  dateRange,
  onDateRangeChange,
  className,
}: DateRangePickerProps) {
  const currentDate = new Date();
  const [startMonth, setStartMonth] = React.useState<string>(
    dateRange?.from ? format(dateRange.from, "yyyy-MM") : format(subMonths(currentDate, 11), "yyyy-MM")
  );
  const [endMonth, setEndMonth] = React.useState<string>(
    dateRange?.to ? format(dateRange.to, "yyyy-MM") : format(currentDate, "yyyy-MM")
  );

  // Generate month options (last 36 months)
  const generateMonthOptions = () => {
    const options = [];
    for (let i = 0; i < 36; i++) {
      const date = subMonths(currentDate, i);
      options.push({
        value: format(date, "yyyy-MM"),
        label: format(date, "MMM yyyy")
      });
    }
    return options;
  };

  const monthOptions = generateMonthOptions();

  const handleApply = () => {
    const from = startOfMonth(new Date(startMonth + "-01"));
    const to = endOfMonth(new Date(endMonth + "-01"));
    onDateRangeChange({ from, to });
  };

  const presetRanges = [
    { label: "Last 3 months", months: 3 },
    { label: "Last 6 months", months: 6 },
    { label: "Last 12 months", months: 12 },
  ];

  const applyPreset = (months: number) => {
    const to = endOfMonth(currentDate);
    const from = startOfMonth(subMonths(currentDate, months - 1));
    setStartMonth(format(from, "yyyy-MM"));
    setEndMonth(format(to, "yyyy-MM"));
    onDateRangeChange({ from, to });
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !dateRange && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateRange?.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, "MMM yyyy")} -{" "}
                  {format(dateRange.to, "MMM yyyy")}
                </>
              ) : (
                format(dateRange.from, "MMM yyyy")
              )
            ) : (
              <span>Select month range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="start">
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {presetRanges.map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(preset.months)}
                  className="flex-1"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Start Month</label>
                <Select value={startMonth} onValueChange={setStartMonth}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">End Month</label>
                <Select value={endMonth} onValueChange={setEndMonth}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleApply} className="w-full">
                Apply Range
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
