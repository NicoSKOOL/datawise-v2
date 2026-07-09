import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';

interface AddKeywordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (keywords: string[], locationCode: number, languageCode: string, device: 'desktop' | 'mobile') => Promise<void>;
}

export default function AddKeywordsDialog({ open, onOpenChange, onAdd }: AddKeywordsDialogProps) {
  const [keywordInput, setKeywordInput] = useState('');
  const [location, setLocation] = useState('2840');
  const [language, setLanguage] = useState('en');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [adding, setAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const firstCsvField = (line: string): string => {
    const quoted = line.match(/^\s*"((?:[^"]|"")*)"/);
    if (quoted) return quoted[1].replace(/""/g, '"').trim();
    return line.split(',')[0].trim();
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    const imported = text
      .split(/\r?\n/)
      .map(firstCsvField)
      .filter(Boolean);
    if (imported.length && /^keywords?$/i.test(imported[0])) imported.shift();
    if (imported.length === 0) return;
    const existing = new Set(
      keywordInput.split('\n').map((kw) => kw.trim().toLowerCase()).filter(Boolean),
    );
    const fresh = imported.filter((kw) => !existing.has(kw.toLowerCase()));
    if (fresh.length === 0) return;
    setKeywordInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${fresh.join('\n')}` : fresh.join('\n')));
  };

  const handleAdd = async () => {
    const keywordList = keywordInput.split('\n').map((kw) => kw.trim()).filter(Boolean);
    if (keywordList.length === 0) return;
    setAdding(true);
    try {
      await onAdd(keywordList, parseInt(location, 10), language, device);
      setKeywordInput('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Keywords to Track</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Keywords (one per line)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3" />
                Import CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={handleFileImport}
              />
            </div>
            <Textarea
              placeholder={"seo tools\nkeyword research\nrank tracker"}
              rows={6}
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border z-50">
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
                <SelectContent className="bg-popover border z-50">
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Device</Label>
            <Select value={device} onValueChange={(value) => setDevice(value === 'mobile' ? 'mobile' : 'desktop')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border z-50">
                <SelectItem value="desktop">Desktop</SelectItem>
                <SelectItem value="mobile">Mobile</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Positions are checked on this device's Google results. Add the same keyword twice to track both.
            </p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={handleAdd} disabled={adding || !keywordInput.trim()}>
            {adding ? 'Adding...' : 'Add Keywords'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
