import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';

interface ProjectLocaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLocationCode?: number | null;
  currentLanguageCode?: string | null;
  keywordCount: number;
  onSave: (params: {
    location_code: number;
    language_code: string;
    reset_history: boolean;
  }) => Promise<void>;
}

export default function ProjectLocaleDialog({
  open, onOpenChange, currentLocationCode, currentLanguageCode, keywordCount, onSave,
}: ProjectLocaleDialogProps) {
  const initialLocation = currentLocationCode ? String(currentLocationCode) : '';
  const initialLanguage = currentLanguageCode || 'en';

  const [location, setLocation] = useState(initialLocation);
  const [language, setLanguage] = useState(initialLanguage);
  const [resetHistory, setResetHistory] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocation(initialLocation);
    setLanguage(initialLanguage);
    setResetHistory(true);
  }, [open, initialLocation, initialLanguage]);

  const changed = location !== initialLocation || language !== initialLanguage;

  const handleSave = async () => {
    if (!location || !changed) return;
    setSaving(true);
    try {
      await onSave({
        location_code: parseInt(location, 10),
        language_code: language,
        reset_history: resetHistory,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change tracking country</DialogTitle>
          <DialogDescription>
            Rankings are checked against this country's Google. Changing it here updates
            the project and all {keywordCount} tracked keyword{keywordCount === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Country</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                <SelectContent className="bg-popover border z-50 max-h-[240px]">
                  {locationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value.toString()}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border z-50 max-h-[240px]">
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {changed && keywordCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
              <Checkbox
                id="reset-history"
                checked={resetHistory}
                onCheckedChange={(value) => setResetHistory(value === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="reset-history" className="text-sm font-medium cursor-pointer">
                  Discard rankings collected under the old country
                </Label>
                <p className="text-xs text-muted-foreground">
                  Positions from a different Google are not comparable to the new ones. Leaving
                  them in place mixes two countries in the same trend chart.
                </p>
              </div>
            </div>
          )}

          {changed && keywordCount > 0 && !resetHistory && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              Past positions will stay on the chart even though they were measured elsewhere.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={handleSave} disabled={saving || !location || !changed}>
            {saving ? 'Saving...' : 'Save country'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
