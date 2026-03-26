import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";
import { Globe } from "lucide-react";

interface LocationSelectorProps {
  locationCode: number | null;
  languageCode: string | null;
  onLocationChange: (locationCode: number, locationName: string) => void;
  onLanguageChange: (languageCode: string) => void;
  disabled?: boolean;
}

export function LocationSelector({
  locationCode,
  languageCode,
  onLocationChange,
  onLanguageChange,
  disabled = false
}: LocationSelectorProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium flex items-center gap-2">
        <Globe className="h-4 w-4" />
        Location & Language
      </label>
      <div className="flex gap-2">
        <Select
          value={locationCode?.toString() || ""}
          onValueChange={(value) => {
            const location = locationOptions.find(l => l.value === parseInt(value));
            if (location) {
              onLocationChange(location.value, location.label);
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select location" />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            {locationOptions.map((location) => (
              <SelectItem key={location.value} value={location.value.toString()}>
                {location.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={languageCode || ""}
          onValueChange={onLanguageChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            {languageOptions.map((language) => (
              <SelectItem key={language.value} value={language.value}>
                {language.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
