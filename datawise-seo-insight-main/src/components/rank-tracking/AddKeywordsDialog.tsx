import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';

interface AddKeywordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (keywords: string[], locationCode: number, languageCode: string) => Promise<void>;
}

export default function AddKeywordsDialog({ open, onOpenChange, onAdd }: AddKeywordsDialogProps) {
  const [keywordInput, setKeywordInput] = useState('');
  const [location, setLocation] = useState('2840');
  const [language, setLanguage] = useState('en');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const keywordList = keywordInput.split('\n').map((kw) => kw.trim()).filter(Boolean);
    if (keywordList.length === 0) return;
    setAdding(true);
    try {
      await onAdd(keywordList, parseInt(location, 10), language);
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
            <Label>Keywords (one per line)</Label>
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
