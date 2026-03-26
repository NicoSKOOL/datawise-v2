import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';
import { fetchLocalKeywordSuggestions, type LocalKeywordSuggestionGroup } from '@/lib/local-seo';
import { RefreshCw, ChevronDown, ChevronRight, Check, CheckCircle, XCircle } from 'lucide-react';
import type { GBPProfile } from '@/types/local-seo';

interface LocalAddKeywordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (keywords: string[], locationCode: number, languageCode: string) => Promise<void>;
  category: string | null;
  city: string | null;
  gbpProfile?: GBPProfile | null;
}

function CompactCompleteness({ profile }: { profile: GBPProfile }) {
  const checks = [
    { label: 'Description', ok: !!profile.description, tip: 'Add a keyword-rich 750-char description' },
    { label: 'Phone', ok: !!profile.phone, tip: 'Add a local phone number' },
    { label: 'Website', ok: !!profile.url, tip: 'Link a location-specific page' },
    { label: 'Hours', ok: !!profile.work_time, tip: 'Set business hours' },
    { label: 'Photos', ok: (profile.total_photos ?? 0) > 0, tip: 'Upload 10+ quality photos' },
    { label: 'Claimed', ok: profile.is_claimed === true, tip: 'Claim at business.google.com' },
  ];
  const score = checks.filter(c => c.ok).length;
  const pct = Math.round((score / checks.length) * 100);
  const missing = checks.filter(c => !c.ok);

  return (
    <div className="border rounded-lg p-3 mb-3 bg-muted/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profile Completeness</span>
        <span className={`text-sm font-bold ${pct === 100 ? 'text-green-600' : pct >= 66 ? 'text-yellow-600' : 'text-red-600'}`}>
          {pct}%
        </span>
      </div>
      <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : pct >= 66 ? 'bg-yellow-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {missing.length > 0 && (
        <div className="space-y-1">
          {missing.map(({ label, tip }) => (
            <div key={label} className="flex items-start gap-1.5 text-[11px]">
              <XCircle className="h-3 w-3 text-red-400 shrink-0 mt-px" />
              <span className="text-muted-foreground"><span className="font-medium text-foreground">{label}:</span> {tip}</span>
            </div>
          ))}
        </div>
      )}
      {missing.length === 0 && (
        <span className="flex items-center gap-1 text-[11px] text-green-600">
          <CheckCircle className="h-3 w-3" />
          All profile fields complete
        </span>
      )}
    </div>
  );
}

export default function LocalAddKeywordsDialog({
  open, onOpenChange, onAdd, category, city, gbpProfile,
}: LocalAddKeywordsDialogProps) {
  const [keywordInput, setKeywordInput] = useState('');
  const [location, setLocation] = useState('2840');
  const [language, setLanguage] = useState('en');
  const [adding, setAdding] = useState(false);
  const [suggestions, setSuggestions] = useState<LocalKeywordSuggestionGroup[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // Load suggestions when dialog opens
  useEffect(() => {
    if (!open || !category) return;
    setSuggestions([]);
    setSelected(new Set());
    setOpenGroups(new Set());
    setLoadingSuggestions(true);

    fetchLocalKeywordSuggestions({
      category,
      city: city || undefined,
      location_code: parseInt(location, 10),
      language_code: language,
    })
      .then((data) => {
        setSuggestions(data.suggestions);
        // Auto-open all groups
        setOpenGroups(new Set(data.suggestions.map(g => g.group)));
      })
      .catch(() => setSuggestions([]))
      .finally(() => setLoadingSuggestions(false));
  }, [open, category, city]);

  const toggleKeyword = (kw: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const toggleGroup = (group: LocalKeywordSuggestionGroup) => {
    const allSelected = group.keywords.every(k => selected.has(k.keyword));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of group.keywords) {
        if (allSelected) next.delete(k.keyword);
        else next.add(k.keyword);
      }
      return next;
    });
  };

  const toggleGroupOpen = (groupName: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  };

  const handleAdd = async () => {
    const manualKeywords = keywordInput.split('\n').map(kw => kw.trim()).filter(Boolean);
    const allKeywords = [...new Set([...selected, ...manualKeywords])];
    if (allKeywords.length === 0) return;

    setAdding(true);
    try {
      await onAdd(allKeywords, parseInt(location, 10), language);
      setKeywordInput('');
      setSelected(new Set());
    } finally {
      setAdding(false);
    }
  };

  const totalSelected = selected.size + keywordInput.split('\n').filter(k => k.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Keywords to Track</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 gap-4 py-4 min-h-0">
          {/* Left panel: Suggestions */}
          <div className="flex flex-col min-h-0">
            {gbpProfile && <CompactCompleteness profile={gbpProfile} />}
            <Label className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Suggested Keywords
            </Label>
            <div className="flex-1 overflow-y-auto border rounded-lg p-3 space-y-2 min-h-0">
              {loadingSuggestions ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">Loading suggestions...</span>
                </div>
              ) : suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {category ? 'No suggestions found.' : 'No category available for suggestions.'}
                </p>
              ) : (
                suggestions.map((group) => {
                  const isOpen = openGroups.has(group.group);
                  const allGroupSelected = group.keywords.every(k => selected.has(k.keyword));
                  const someGroupSelected = group.keywords.some(k => selected.has(k.keyword));

                  return (
                    <Collapsible key={group.group} open={isOpen} onOpenChange={() => toggleGroupOpen(group.group)}>
                      <div className="flex items-center justify-between">
                        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors py-1">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {group.group}
                          <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                            {group.keywords.length}
                          </Badge>
                        </CollapsibleTrigger>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleGroup(group); }}
                          className="text-[10px] font-medium text-primary hover:underline px-1"
                        >
                          {allGroupSelected ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                      <CollapsibleContent className="pl-5 space-y-0.5 mt-1">
                        {group.keywords.map((kw) => {
                          const isSelected = selected.has(kw.keyword);
                          return (
                            <button
                              key={kw.keyword}
                              onClick={() => toggleKeyword(kw.keyword)}
                              className={`w-full flex items-center justify-between py-1.5 px-2 rounded text-sm transition-colors ${
                                isSelected
                                  ? 'bg-primary/10 text-primary'
                                  : 'hover:bg-muted/50'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className={`h-4 w-4 rounded border flex items-center justify-center text-xs ${
                                  isSelected ? 'bg-primary border-primary text-white' : 'border-border'
                                }`}>
                                  {isSelected && <Check className="h-3 w-3" />}
                                </span>
                                <span className="truncate">{kw.keyword}</span>
                              </span>
                              {kw.search_volume != null && kw.search_volume > 0 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-2 shrink-0">
                                  {kw.search_volume.toLocaleString()}/mo
                                </Badge>
                              )}
                            </button>
                          );
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })
              )}
            </div>
          </div>

          {/* Right panel: Manual input */}
          <div className="flex flex-col min-h-0 space-y-4">
            <div className="flex-1 min-h-0 flex flex-col">
              <Label className="mb-2">Custom Keywords (one per line)</Label>
              <Textarea
                placeholder={"irish pub downtown\npub quiz night toronto"}
                className="flex-1 min-h-[120px] resize-none"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Location</Label>
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border z-50">
                    {locationOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value.toString()}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border z-50">
                    {languageOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {totalSelected > 0 ? `${totalSelected} keyword${totalSelected !== 1 ? 's' : ''} selected` : 'No keywords selected'}
          </span>
          <div className="flex gap-2">
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleAdd} disabled={adding || totalSelected === 0}>
              {adding ? 'Adding...' : `Add ${totalSelected > 0 ? totalSelected + ' ' : ''}Keywords`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
