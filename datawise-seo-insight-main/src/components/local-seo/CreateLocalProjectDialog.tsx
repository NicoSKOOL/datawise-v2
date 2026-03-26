import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, MapPin, Star, RefreshCw, Check, Link2, AlertCircle } from 'lucide-react';
import { searchBusinesses, resolveGBPUrl } from '@/lib/local-seo';
import { locationOptions } from '@/lib/dataForSeoLocations';
import type { BusinessSearchResult } from '@/types/local-seo';

interface CreateLocalProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (params: {
    name: string;
    business_name: string;
    place_id?: string;
    cid?: string;
    domain?: string;
    location_code?: number;
  }) => Promise<void>;
}

export default function CreateLocalProjectDialog({ open, onOpenChange, onCreate }: CreateLocalProjectDialogProps) {
  const [step, setStep] = useState<'find' | 'confirm'>('find');
  const [tab, setTab] = useState<'search' | 'url'>('search');
  const [query, setQuery] = useState('');
  const [locationCode, setLocationCode] = useState('2036');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<BusinessSearchResult[]>([]);
  const [selected, setSelected] = useState<BusinessSearchResult | null>(null);
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  // URL import state
  const [gbpUrl, setGbpUrl] = useState('');
  const [resolving, setResolving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setResults([]);
    try {
      const data = await searchBusinesses(query.trim(), parseInt(locationCode, 10));
      setResults(data.businesses);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleResolveUrl = async () => {
    if (!gbpUrl.trim()) return;
    setResolving(true);
    setUrlError(null);
    try {
      const business = await resolveGBPUrl(gbpUrl.trim());
      setSelected(business);
      setProjectName(business.title);
      setStep('confirm');
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Could not resolve URL. Make sure it is a Google Maps business link.');
    } finally {
      setResolving(false);
    }
  };

  const handleSelect = (business: BusinessSearchResult) => {
    setSelected(business);
    setProjectName(business.title);
    setStep('confirm');
  };

  const handleCreate = async () => {
    if (!selected || !projectName.trim()) return;
    setCreating(true);
    try {
      await onCreate({
        name: projectName.trim(),
        business_name: selected.title,
        place_id: selected.place_id || undefined,
        cid: selected.cid || undefined,
        domain: selected.url ? new URL(selected.url).hostname.replace(/^www\./, '') : undefined,
        location_code: parseInt(locationCode, 10),
      });
      handleReset();
      onOpenChange(false);
    } finally {
      setCreating(false);
    }
  };

  const handleReset = () => {
    setStep('find');
    setTab('search');
    setQuery('');
    setLocationCode('2036');
    setResults([]);
    setSelected(null);
    setProjectName('');
    setGbpUrl('');
    setUrlError(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) handleReset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Local Project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 'find' ? 'Find Your Business' : 'Confirm Project'}
          </DialogTitle>
        </DialogHeader>

        {step === 'find' && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'search' | 'url')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="search" className="flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" />
                Search
              </TabsTrigger>
              <TabsTrigger value="url" className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                Paste URL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="space-y-4 mt-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Country</Label>
                <Select value={locationCode} onValueChange={setLocationCode}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border z-50 max-h-[200px]">
                    {locationOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value.toString()}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., Joe's Plumbing Austin TX"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button onClick={handleSearch} disabled={searching || !query.trim()}>
                  {searching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>

              {results.length > 0 && (
                <div className="max-h-[340px] overflow-y-auto space-y-2">
                  {results.map((biz, i) => (
                    <Card
                      key={biz.place_id || i}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => handleSelect(biz)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{biz.title}</p>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{biz.address}</span>
                            </div>
                            {biz.category && (
                              <p className="text-xs text-muted-foreground mt-0.5">{biz.category}</p>
                            )}
                          </div>
                          {biz.rating != null && (
                            <div className="flex items-center gap-1 text-xs shrink-0">
                              <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                              <span className="font-medium">{biz.rating}</span>
                              {biz.reviews_count != null && (
                                <span className="text-muted-foreground">({biz.reviews_count})</span>
                              )}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {searching && (
                <div className="flex justify-center py-6">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </TabsContent>

            <TabsContent value="url" className="space-y-4 mt-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Google Maps URL</Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Paste the Google Maps link for your business. Supports full URLs and short links (maps.app.goo.gl).
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://maps.app.goo.gl/... or https://google.com/maps/place/..."
                    value={gbpUrl}
                    onChange={(e) => { setGbpUrl(e.target.value); setUrlError(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleResolveUrl()}
                  />
                  <Button onClick={handleResolveUrl} disabled={resolving || !gbpUrl.trim()}>
                    {resolving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  </Button>
                </div>
                {urlError && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-red-600">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{urlError}</span>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {step === 'confirm' && selected && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="font-medium text-sm">{selected.title}</span>
                </div>
                <p className="text-xs text-muted-foreground">{selected.address}</p>
                {selected.rating != null && (
                  <div className="flex items-center gap-1 text-xs mt-1">
                    <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                    <span>{selected.rating}</span>
                    {selected.reviews_count != null && (
                      <span className="text-muted-foreground">({selected.reviews_count} reviews)</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <div>
              <Label htmlFor="local-project-name">Project Name</Label>
              <Input
                id="local-project-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'confirm' && (
            <Button variant="outline" onClick={() => setStep('find')}>Back</Button>
          )}
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          {step === 'confirm' && (
            <Button onClick={handleCreate} disabled={creating || !projectName.trim()}>
              {creating ? 'Creating...' : 'Create Project'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
