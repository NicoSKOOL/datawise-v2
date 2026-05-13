import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Copy, ExternalLink, MapPin, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CITATIONS_BY_COUNTRY,
  COUNTRY_FROM_LOCATION_CODE,
  COUNTRY_LABELS,
  type CountryCode,
  type Citation,
} from '@/data/local-citations';
import {
  fetchChecklist, setChecklistItem,
  fetchCustomCitations, createCustomCitation, deleteCustomCitation,
  type CustomCitation,
} from '@/lib/citations';
import type { LocalProject } from '@/types/local-seo';

interface NapState {
  business_name: string;
  address: string;
  phone: string;
  website: string;
  email: string;
  hours: string;
}

const EMPTY_NAP: NapState = {
  business_name: '',
  address: '',
  phone: '',
  website: '',
  email: '',
  hours: '',
};

function napStorageKey(projectId: string) {
  return `datawise.citations.nap.${projectId}`;
}

function collapsedStorageKey(projectId: string) {
  return `datawise.citations.collapsed.${projectId}`;
}

function loadCollapsed(projectId: string): boolean | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(collapsedStorageKey(projectId));
  if (raw === null) return null;
  return raw === '1';
}

function saveCollapsed(projectId: string, collapsed: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(collapsedStorageKey(projectId), collapsed ? '1' : '0');
}

function loadNap(projectId: string, project: LocalProject): NapState {
  if (typeof window === 'undefined') return seedFromProject(project);
  try {
    const raw = window.localStorage.getItem(napStorageKey(projectId));
    if (!raw) return seedFromProject(project);
    return { ...seedFromProject(project), ...(JSON.parse(raw) as Partial<NapState>) };
  } catch {
    return seedFromProject(project);
  }
}

function seedFromProject(project: LocalProject): NapState {
  return {
    ...EMPTY_NAP,
    business_name: project.business_name ?? '',
    website: project.domain ?? '',
  };
}

function saveNap(projectId: string, nap: NapState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(napStorageKey(projectId), JSON.stringify(nap));
}

async function copy(text: string, label: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Copy failed');
  }
}

interface Props {
  project: LocalProject;
}

export default function LocalCitationsSection({ project }: Props) {
  const queryClient = useQueryClient();
  const [nap, setNap] = useState<NapState>(() => loadNap(project.id, project));

  const detectedCountry: CountryCode | null = project.location_code
    ? COUNTRY_FROM_LOCATION_CODE[project.location_code] ?? null
    : null;
  const [country, setCountry] = useState<CountryCode>(detectedCountry ?? 'US');
  const [collapsed, setCollapsedState] = useState<boolean | null>(() => loadCollapsed(project.id));

  // Re-seed NAP, country, collapsed state whenever the project switches.
  useEffect(() => {
    setNap(loadNap(project.id, project));
    if (detectedCountry) setCountry(detectedCountry);
    setCollapsedState(loadCollapsed(project.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const { data: checklist } = useQuery({
    queryKey: ['citation-checklist'],
    queryFn: fetchChecklist,
    staleTime: 60 * 1000,
  });

  const { data: customCitations } = useQuery({
    queryKey: ['custom-citations', project.id],
    queryFn: () => fetchCustomCitations(project.id),
    staleTime: 60 * 1000,
  });

  const completedKeys = useMemo(
    () => new Set((checklist ?? []).map((c) => c.citation_key)),
    [checklist],
  );

  const updateNap = (field: keyof NapState, value: string) => {
    setNap((prev) => {
      const next = { ...prev, [field]: value };
      saveNap(project.id, next);
      return next;
    });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ key, completed }: { key: string; completed: boolean }) =>
      setChecklistItem(key, completed),
    onMutate: async ({ key, completed }) => {
      await queryClient.cancelQueries({ queryKey: ['citation-checklist'] });
      const previous = queryClient.getQueryData<{ citation_key: string; completed_at: string }[]>([
        'citation-checklist',
      ]);
      queryClient.setQueryData(
        ['citation-checklist'],
        (old: { citation_key: string; completed_at: string }[] = []) =>
          completed
            ? [...old.filter((c) => c.citation_key !== key), { citation_key: key, completed_at: new Date().toISOString() }]
            : old.filter((c) => c.citation_key !== key),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['citation-checklist'], ctx.previous);
      toast.error('Could not save progress');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['citation-checklist'] });
    },
  });

  const list = CITATIONS_BY_COUNTRY[country];
  const tier1 = list.filter((c) => c.tier === 'Tier 1');
  const tier2 = list.filter((c) => c.tier === 'Tier 2');
  const customs = customCitations ?? [];
  const customKeys = customs.map((c) => `custom-${c.id}`);
  const totalCount = list.length + customs.length;
  const completedInCountry =
    list.filter((c) => completedKeys.has(c.key)).length +
    customKeys.filter((k) => completedKeys.has(k)).length;
  const progressPct = totalCount > 0 ? Math.round((completedInCountry / totalCount) * 100) : 0;
  const isComplete = totalCount > 0 && completedInCountry === totalCount;
  const countryUnsupported = !!project.location_code && detectedCountry === null;
  // If user hasn't toggled, auto-collapse when 100% done.
  const effectiveCollapsed = collapsed ?? isComplete;

  const toggleCollapsed = () => {
    const next = !effectiveCollapsed;
    setCollapsedState(next);
    saveCollapsed(project.id, next);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" /> Local citations checklist
              {isComplete && (
                <Badge variant="secondary" className="ml-2">Done</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Submit this business to the directories below. Tier 1 first, then Tier 2.
            </CardDescription>
          </div>
          <div className="flex items-start gap-2">
            {!detectedCountry && !effectiveCollapsed && (
              <div className="w-56">
                <Label className="text-xs text-muted-foreground">Country</Label>
                <Select value={country} onValueChange={(v) => setCountry(v as CountryCode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(COUNTRY_LABELS) as CountryCode[]).map((c) => (
                      <SelectItem key={c} value={c}>{COUNTRY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleCollapsed}
              title={effectiveCollapsed ? 'Expand' : 'Minimize'}
              className="mt-5"
            >
              {effectiveCollapsed ? (
                <>Expand <ChevronDown className="ml-1 h-4 w-4" /></>
              ) : (
                <>Minimize <ChevronUp className="ml-1 h-4 w-4" /></>
              )}
            </Button>
          </div>
        </div>
        <div className="mt-4 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {completedInCountry} of {totalCount} complete · {COUNTRY_LABELS[country]}
              {customs.length > 0 && ` · ${customs.length} custom`}
            </span>
            <span className="font-medium">{progressPct}%</span>
          </div>
          <Progress value={progressPct} />
        </div>
      </CardHeader>
      {effectiveCollapsed ? null : (
      <CardContent className="space-y-8">
        {countryUnsupported && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-4 py-3 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              We don't have a curated citation list for your country yet.
            </p>
            <p className="text-amber-800 dark:text-amber-300 mt-1">
              We're showing the United States list as a starting point. The global Tier 1 sites (Google Business Profile,
              Apple Business Connect, Bing Places, Facebook, Trustpilot) still apply anywhere. Use
              <span className="font-medium"> Your custom directories</span> below to add country-specific ones you find.
            </p>
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">Your NAP</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Use these exact values on every directory so Google trusts the data. Saved per project, on this device.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NapField label="Business Name" value={nap.business_name} onChange={(v) => updateNap('business_name', v)} />
            <NapField label="Phone" value={nap.phone} onChange={(v) => updateNap('phone', v)} />
            <NapField label="Address" value={nap.address} onChange={(v) => updateNap('address', v)} className="md:col-span-2" />
            <NapField label="Website" value={nap.website} onChange={(v) => updateNap('website', v)} />
            <NapField label="Email" value={nap.email} onChange={(v) => updateNap('email', v)} />
            <NapField label="Hours" value={nap.hours} onChange={(v) => updateNap('hours', v)} className="md:col-span-2" placeholder="e.g. Mon-Fri 9am-6pm" />
          </div>
        </div>

        <CitationGroup
          title="Tier 1 — Must-Have"
          citations={tier1}
          completedKeys={completedKeys}
          onToggle={(key, completed) => toggleMutation.mutate({ key, completed })}
          nap={nap}
        />
        {tier2.length > 0 && (
          <CitationGroup
            title="Tier 2 — Strongly Recommended"
            citations={tier2}
            completedKeys={completedKeys}
            onToggle={(key, completed) => toggleMutation.mutate({ key, completed })}
            nap={nap}
          />
        )}
        <CustomCitationsSection
          projectId={project.id}
          customs={customs}
          completedKeys={completedKeys}
          onToggleChecklist={(key, completed) => toggleMutation.mutate({ key, completed })}
          nap={nap}
        />
      </CardContent>
      )}
    </Card>
  );
}

function NapField({
  label, value, onChange, placeholder, className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        <Button
          variant="outline"
          size="icon"
          onClick={() => copy(value, label)}
          disabled={!value}
          title={`Copy ${label}`}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CustomCitationsSection({
  projectId, customs, completedKeys, onToggleChecklist, nap,
}: {
  projectId: string;
  customs: CustomCitation[];
  completedKeys: Set<string>;
  onToggleChecklist: (key: string, completed: boolean) => void;
  nap: NapState;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const napReady = !!(nap.business_name && nap.address && nap.phone);

  const createMut = useMutation({
    mutationFn: () => createCustomCitation({ project_id: projectId, name: name.trim(), url: url.trim() }),
    onSuccess: () => {
      setName('');
      setUrl('');
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ['custom-citations', projectId] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not add citation'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCustomCitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-citations', projectId] });
      queryClient.invalidateQueries({ queryKey: ['citation-checklist'] });
    },
  });

  const submit = () => {
    if (!name.trim() || !url.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    createMut.mutate();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your custom directories
        </h3>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add citation
          </Button>
        )}
      </div>
      {adding && (
        <div className="rounded-lg border p-3 mb-3 bg-muted/30 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2">
            <Input
              placeholder="Directory name (e.g. Local Chamber)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="https://example.com/add-listing"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={createMut.isPending}>
              {createMut.isPending ? 'Adding...' : 'Add'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setAdding(false); setName(''); setUrl(''); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {customs.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground italic">
          Found a niche or local directory not on the list above? Add it here.
        </p>
      )}
      <div className="space-y-2">
        {customs.map((c) => {
          const key = `custom-${c.id}`;
          const done = completedKeys.has(key);
          return (
            <div
              key={c.id}
              className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${done ? 'bg-muted/50' : 'bg-card'}`}
            >
              <Checkbox
                checked={done}
                onCheckedChange={(v) => onToggleChecklist(key, !!v)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-medium ${done ? 'line-through text-muted-foreground' : ''}`}>{c.name}</span>
                  <Badge variant="outline" className="text-xs">Custom</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1 truncate">{c.url}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!napReady) {
                    toast.message('Fill out Business Name, Address, and Phone above first.');
                  }
                  window.open(c.url, '_blank', 'noopener,noreferrer');
                }}
              >
                Open <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteMut.mutate(c.id)}
                title="Remove"
                disabled={deleteMut.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CitationGroup({
  title, citations, completedKeys, onToggle, nap,
}: {
  title: string;
  citations: Citation[];
  completedKeys: Set<string>;
  onToggle: (key: string, completed: boolean) => void;
  nap: NapState;
}) {
  const napReady = !!(nap.business_name && nap.address && nap.phone);
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">
        {citations.map((c) => {
          const done = completedKeys.has(c.key);
          return (
            <div
              key={c.key}
              className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${done ? 'bg-muted/50' : 'bg-card'}`}
            >
              <Checkbox
                checked={done}
                onCheckedChange={(v) => onToggle(c.key, !!v)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-medium ${done ? 'line-through text-muted-foreground' : ''}`}>{c.name}</span>
                  <Badge variant="outline" className="text-xs">{c.category}</Badge>
                  <Badge variant="secondary" className="text-xs">{c.cost}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{c.why}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!napReady) {
                    toast.message('Fill out Business Name, Address, and Phone above first.');
                  }
                  window.open(c.url, '_blank', 'noopener,noreferrer');
                }}
              >
                Open <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
