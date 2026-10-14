import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LLM_MENTIONS_LOCALES, findLocale, normalizeMarket, type LlmMarket } from '@/lib/llm-mentions-locales';

// Location + language picker limited to pairs the LLM Mentions index covers.
// Changing the location snaps the language to one that location supports.
export function MarketSelect({
  value,
  onChange,
  idPrefix,
}: {
  value: LlmMarket;
  onChange: (next: LlmMarket) => void;
  idPrefix: string;
}) {
  const languages = findLocale(value.locationCode)?.languages ?? [];

  return (
    <div className="flex gap-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-location`}>Market</Label>
        <Select
          value={String(value.locationCode)}
          onValueChange={(v) => onChange(normalizeMarket(Number(v), value.languageCode))}
        >
          <SelectTrigger id={`${idPrefix}-location`} className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LLM_MENTIONS_LOCALES.map((l) => (
              <SelectItem key={l.code} value={String(l.code)}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-language`}>Language</Label>
        <Select
          value={value.languageCode}
          onValueChange={(v) => onChange(normalizeMarket(value.locationCode, v))}
          disabled={languages.length < 2}
        >
          <SelectTrigger id={`${idPrefix}-language`} className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languages.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
