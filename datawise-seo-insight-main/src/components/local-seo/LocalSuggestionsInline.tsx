import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RefreshCw, ChevronDown, ChevronRight, Check, Sparkles } from 'lucide-react';
import { fetchLocalKeywordSuggestions, type LocalKeywordSuggestionGroup } from '@/lib/local-seo';

interface LocalSuggestionsInlineProps {
  category: string | null;
  city: string | null;
  locationCode: number;
  languageCode?: string;
  onAdd: (keywords: string[], locationCode: number, languageCode: string) => Promise<void>;
  onOpenManual: () => void;
}

export default function LocalSuggestionsInline({
  category, city, locationCode, languageCode = 'en', onAdd, onOpenManual,
}: LocalSuggestionsInlineProps) {
  const [suggestions, setSuggestions] = useState<LocalKeywordSuggestionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!category) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    fetchLocalKeywordSuggestions({
      category,
      city: city || undefined,
      location_code: locationCode,
      language_code: languageCode,
    })
      .then((data) => {
        setSuggestions(data.suggestions);
        setOpenGroups(new Set(data.suggestions.map((g) => g.group)));
      })
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [category, city, locationCode, languageCode]);

  const toggleKeyword = (kw: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const toggleGroup = (group: LocalKeywordSuggestionGroup) => {
    const allSelected = group.keywords.every((k) => selected.has(k.keyword));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of group.keywords) {
        if (allSelected) next.delete(k.keyword);
        else next.add(k.keyword);
      }
      return next;
    });
  };

  const toggleGroupOpen = (name: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAdd = async () => {
    const keywords = Array.from(selected);
    if (keywords.length === 0) return;
    setAdding(true);
    try {
      await onAdd(keywords, locationCode, languageCode);
      setSelected(new Set());
    } finally {
      setAdding(false);
    }
  };

  if (!category) {
    return (
      <div className="text-center py-12 text-muted-foreground px-4">
        <p className="mb-1">No category on the linked profile.</p>
        <p className="text-sm mb-3">Add keywords manually to start tracking local pack rankings.</p>
        <Button variant="outline" size="sm" onClick={onOpenManual}>
          Add Keywords
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium">Suggested for {category}{city ? ` in ${city}` : ''}</p>
          <p className="text-xs text-muted-foreground">
            Pick the keywords you want to track. We'll check them against the Local Pack on every rank check.
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-3 space-y-2 max-h-[360px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm">Loading suggestions...</span>
          </div>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No suggestions found for this category.</p>
        ) : (
          suggestions.map((group) => {
            const isOpen = openGroups.has(group.group);
            const allGroupSelected = group.keywords.every((k) => selected.has(k.keyword));
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
                          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`h-4 w-4 rounded border flex items-center justify-center text-xs ${
                            isSelected ? 'bg-primary border-primary text-white' : 'border-border'
                          }`}>
                            {isSelected && <Check className="h-3 w-3" />}
                          </span>
                          <span className="truncate text-left">{kw.keyword}</span>
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

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={onOpenManual}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Or add custom keywords
        </button>
        <Button onClick={handleAdd} disabled={adding || selected.size === 0}>
          {adding ? 'Adding...' : selected.size > 0 ? `Track ${selected.size} keyword${selected.size === 1 ? '' : 's'}` : 'Track keywords'}
        </Button>
      </div>
    </div>
  );
}
