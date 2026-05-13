import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link2, Loader2, RefreshCw, Trash2, CheckCircle, Key, Eye, EyeOff, Check, Globe, Ticket } from 'lucide-react';
import { redeemPromoCode } from '@/lib/promo';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { connectGSC, getGSCProperties, syncGSCProperty, disconnectGSC, updateGSCProperty, refreshGSCProperties, type GSCProperty } from '@/lib/gsc';
import { connectBWT, getBWTProperties, disconnectBWT } from '@/lib/bwt';
import { getStoredLLMConfig, saveLLMConfig, clearLLMConfig, type LLMConfig } from '@/lib/chat';
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_MODELS, OPENROUTER_PROVIDER_GROUPS, isApprovedOpenRouterModel } from '@/lib/ai-models';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import claudeLogo from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
import openaiLogo from '@lobehub/icons-static-svg/icons/openai.svg?url';
import deepseekLogo from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import moonshotLogo from '@lobehub/icons-static-svg/icons/moonshot.svg?url';

function providerLogo(provider: string): string {
  if (provider === 'deepseek') return deepseekLogo;
  if (provider === 'moonshotai') return moonshotLogo;
  if (provider === 'anthropic') return claudeLogo;
  if (provider === 'openai') return openaiLogo;
  return openaiLogo;
}

export default function SettingsPage() {
  const { user, isPro, isCommunityMember, promoActive, promoExpiresAt, promoLabel, refreshUser, refreshPromoStatus } = useAuth();
  const { toast } = useToast();
  const [connected, setConnected] = useState(false);
  const [properties, setProperties] = useState<GSCProperty[]>([]);
  const [bwtConnected, setBwtConnected] = useState(false);
  const [bwtProperties, setBwtProperties] = useState<GSCProperty[]>([]);
  const [bwtLoading, setBwtLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const PROPERTY_COLORS = [
    { value: '#6366f1', label: 'Indigo' },
    { value: '#f43f5e', label: 'Rose' },
    { value: '#10b981', label: 'Emerald' },
    { value: '#f59e0b', label: 'Amber' },
    { value: '#3b82f6', label: 'Blue' },
    { value: '#8b5cf6', label: 'Violet' },
    { value: '#ec4899', label: 'Pink' },
    { value: '#14b8a6', label: 'Teal' },
  ];

  // Promo code
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoRedeeming, setPromoRedeeming] = useState(false);
  const [promoError, setPromoError] = useState('');

  const handleRedeemPromo = async () => {
    if (!promoCodeInput.trim()) return;
    setPromoRedeeming(true);
    setPromoError('');
    try {
      const result = await redeemPromoCode(promoCodeInput.trim());
      toast({
        title: 'Promo activated!',
        description: `You have unlimited access until ${new Date(result.expires_at).toLocaleString()}.`,
      });
      setPromoCodeInput('');
      await Promise.all([refreshUser(), refreshPromoStatus()]);
    } catch (err) {
      setPromoError((err as Error).message || 'Invalid or expired promo code.');
    } finally {
      setPromoRedeeming(false);
    }
  };

  // LLM config (BYOK)
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState<string>(DEFAULT_OPENROUTER_MODEL);
  const [legacyProvider, setLegacyProvider] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);

  // User defaults (location/language)
  const [defaultLocation, setDefaultLocation] = useState(String(user?.default_location_code ?? 2840));
  const [defaultLanguage, setDefaultLanguage] = useState(user?.default_language_code ?? 'en');
  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(true);

  useEffect(() => {
    if (user) {
      setDefaultLocation(String(user.default_location_code ?? 2840));
      setDefaultLanguage(user.default_language_code ?? 'en');
      setDefaultsSaved(true);
    }
  }, [user]);

  const handleSaveDefaults = async () => {
    setDefaultsSaving(true);
    try {
      await api('/auth/defaults', {
        method: 'PATCH',
        body: {
          default_location_code: parseInt(defaultLocation),
          default_language_code: defaultLanguage,
        },
      });
      setDefaultsSaved(true);
      toast({ title: 'Saved', description: 'Default location and language updated.' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save defaults.' });
    } finally {
      setDefaultsSaving(false);
    }
  };

  useEffect(() => {
    const config = getStoredLLMConfig();
    if (config?.provider && config.provider !== 'openrouter') {
      setLegacyProvider(config.provider);
      setLlmApiKey('');
      setLlmModel(DEFAULT_OPENROUTER_MODEL);
      setLlmSaved(false);
      return;
    }
    if (config?.provider === 'openrouter' && config.api_key) {
      setLegacyProvider(null);
      setLlmApiKey(config.api_key);
      setLlmModel(isApprovedOpenRouterModel(config.model) ? config.model : DEFAULT_OPENROUTER_MODEL);
      setLlmSaved(true);
    }
  }, []);

  const handleSaveLLM = () => {
    if (!llmApiKey.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please enter an API key' });
      return;
    }
    const config: LLMConfig = {
      provider: 'openrouter',
      api_key: llmApiKey.trim(),
      model: isApprovedOpenRouterModel(llmModel) ? llmModel : DEFAULT_OPENROUTER_MODEL,
    };
    saveLLMConfig(config);
    setLegacyProvider(null);
    setLlmSaved(true);
    toast({ title: 'Saved', description: 'OpenRouter configuration saved locally.' });
  };

  const handleClearLLM = () => {
    clearLLMConfig();
    setLlmApiKey('');
    setLlmModel(DEFAULT_OPENROUTER_MODEL);
    setLegacyProvider(null);
    setLlmSaved(false);
    toast({ title: 'Cleared', description: 'API key removed.' });
  };

  useEffect(() => {
    loadGSCStatus();
    loadBWTStatus();

    const params = new URLSearchParams(window.location.search);
    if (params.get('gsc_connected') === 'true') {
      toast({ title: 'GSC Connected', description: 'Google Search Console connected successfully.' });
      window.history.replaceState({}, '', '/settings');
    }
    if (params.get('gsc_error')) {
      toast({ variant: 'destructive', title: 'GSC Connection Failed', description: `Error: ${params.get('gsc_error')}` });
      window.history.replaceState({}, '', '/settings');
    }
    if (params.get('bwt_connected') === 'true') {
      toast({ title: 'Bing Connected', description: 'Bing Webmaster Tools connected successfully.' });
      window.history.replaceState({}, '', '/settings');
    }
    if (params.get('bwt_error')) {
      toast({ variant: 'destructive', title: 'Bing Connection Failed', description: `Error: ${params.get('bwt_error')}` });
      window.history.replaceState({}, '', '/settings');
    }
  }, []);

  const loadBWTStatus = async () => {
    try {
      const data = await getBWTProperties();
      setBwtConnected(data.connected);
      setBwtProperties(data.properties || []);
    } catch (err) {
      console.error('Failed to load BWT status', err);
    } finally {
      setBwtLoading(false);
    }
  };

  const handleBWTConnect = async () => {
    try {
      const data = await connectBWT();
      window.location.href = data.url;
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to start Bing connection' });
    }
  };

  const handleBWTDisconnect = async () => {
    try {
      await disconnectBWT();
      setBwtConnected(false);
      setBwtProperties([]);
      toast({ title: 'Disconnected', description: 'Bing Webmaster Tools disconnected.' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to disconnect Bing' });
    }
  };

  const loadGSCStatus = async () => {
    try {
      const data = await getGSCProperties();
      setConnected(data.connected);
      setProperties(data.properties || []);
    } catch {
      // Not connected
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const data = await connectGSC();
      window.location.href = data.url;
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to start GSC connection' });
    }
  };

  const handleSync = async (propertyId: string) => {
    setSyncing(propertyId);
    try {
      const result = await syncGSCProperty(propertyId);
      const clicks = result.total_clicks ?? 0;
      const impressions = result.total_impressions ?? 0;
      if (clicks === 0 && impressions === 0) {
        toast({
          variant: 'destructive',
          title: 'No data found',
          description: `Google returned ${result.rows_synced} rows but every day is 0 clicks / 0 impressions. Likely the wrong property variant — try the sc-domain or www variant.`,
        });
      } else {
        toast({ title: 'Sync Complete', description: `${clicks.toLocaleString()} clicks · ${impressions.toLocaleString()} impressions over 90 days from ${result.property}` });
      }
      loadGSCStatus();
    } catch {
      toast({ variant: 'destructive', title: 'Sync Failed', description: 'Could not sync GSC data. Try reconnecting.' });
    } finally {
      setSyncing(null);
    }
  };

  const [refreshingList, setRefreshingList] = useState(false);
  const handleRefreshList = async () => {
    setRefreshingList(true);
    try {
      const before = properties.length;
      const result = await refreshGSCProperties();
      const after = result.count;
      const diff = after - before;
      toast({
        title: 'Property list refreshed',
        description: diff > 0
          ? `${diff} new ${diff === 1 ? 'property' : 'properties'} found in Google Search Console.`
          : `${after} ${after === 1 ? 'property' : 'properties'} — no new ones found.`,
      });
      loadGSCStatus();
    } catch {
      toast({ variant: 'destructive', title: 'Refresh failed', description: 'Could not pull property list from Google. Try reconnecting.' });
    } finally {
      setRefreshingList(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectGSC();
      setConnected(false);
      setProperties([]);
      toast({ title: 'Disconnected', description: 'Google Search Console disconnected.' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to disconnect' });
    }
  };

  const handleColorChange = async (propertyId: string, color: string) => {
    try {
      await updateGSCProperty(propertyId, { color });
      setProperties((prev) => prev.map((p) => p.id === propertyId ? { ...p, color } : p));
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update color' });
    }
  };

  const handleToggleEnabled = async (propertyId: string, enabled: boolean) => {
    try {
      await updateGSCProperty(propertyId, { is_enabled: enabled });
      setProperties((prev) => prev.map((p) => p.id === propertyId ? { ...p, is_enabled: enabled ? 1 : 0 } : p));
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update property' });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account, connections, and billing</p>
      </div>

      {/* Profile */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Profile</h2>
        <div className="flex items-center gap-4">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-16 h-16 rounded-full" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <span className="text-xl font-medium">{user?.name?.charAt(0)}</span>
            </div>
          )}
          <div>
            <p className="font-medium">{user?.name}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Default Location & Language */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Default Location & Language</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Set your default country and language. All keyword research, competitor analysis, and SERP tools will use these defaults.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Country</Label>
            <Select value={defaultLocation} onValueChange={(v) => { setDefaultLocation(v); setDefaultsSaved(false); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {locationOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Language</Label>
            <Select value={defaultLanguage} onValueChange={(v) => { setDefaultLanguage(v); setDefaultsSaved(false); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languageOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={handleSaveDefaults} disabled={defaultsSaved || defaultsSaving} size="sm">
          {defaultsSaving ? (
            <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Saving...</>
          ) : defaultsSaved ? (
            <><CheckCircle className="h-3 w-3 mr-1.5" />Saved</>
          ) : 'Save Defaults'}
        </Button>
      </div>

      {/* Subscription */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Subscription</h2>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            isPro ? 'bg-primary/10 text-primary' :
            isCommunityMember ? 'bg-green-500/10 text-green-600' :
            'bg-muted text-muted-foreground'
          }`}>
            {isCommunityMember ? 'Community' : isPro ? 'Pro' : 'Free'}
          </span>
        </div>
        {!isPro && !isCommunityMember && (
          <Button className="mt-2">Upgrade to Pro</Button>
        )}
      </div>

      {/* Google Search Console */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Google Search Console</h2>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Checking connection...</span>
          </div>
        ) : connected ? (
          <>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Connected</span>
            </div>

            {properties.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">Your Properties</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshList}
                    disabled={refreshingList}
                  >
                    {refreshingList ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    <span className="ml-1.5">{refreshingList ? 'Refreshing...' : 'Refresh from Google'}</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Toggle properties on/off for the SEO Assistant dropdown. Assign colors to identify conversations.
                  Click <span className="font-medium">Refresh from Google</span> after adding or verifying a new property variant in Search Console.
                </p>
                {properties.map((prop) => {
                  const propColor = prop.color || '#6366f1';
                  const isEnabled = prop.is_enabled !== 0;
                  return (
                    <div key={prop.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-opacity ${!isEnabled ? 'opacity-50' : ''}`}>
                      {/* Color picker */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className="w-6 h-6 rounded-full flex-shrink-0 ring-2 ring-offset-2 ring-offset-background ring-transparent hover:ring-border transition-all"
                            style={{ backgroundColor: propColor }}
                            title="Change color"
                          />
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="start">
                          <div className="grid grid-cols-4 gap-1.5">
                            {PROPERTY_COLORS.map((c) => (
                              <button
                                key={c.value}
                                onClick={() => handleColorChange(prop.id, c.value)}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
                                style={{ backgroundColor: c.value }}
                                title={c.label}
                              >
                                {propColor === c.value && <Check className="h-4 w-4 text-white" />}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>

                      {/* Property info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{prop.site_url.replace(/^(sc-domain:|https?:\/\/)/, '')}</p>
                        <p className="text-xs text-muted-foreground">
                          {prop.last_synced_at ? `Last synced: ${new Date(prop.last_synced_at).toLocaleDateString()}` : 'Not synced yet'}
                        </p>
                      </div>

                      {/* Enable/disable toggle */}
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) => handleToggleEnabled(prop.id, checked)}
                        aria-label={`${isEnabled ? 'Disable' : 'Enable'} property`}
                      />

                      {/* Sync button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync(prop.id)}
                        disabled={syncing === prop.id}
                      >
                        {syncing === prop.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        <span className="ml-1.5">{syncing === prop.id ? 'Syncing...' : 'Sync'}</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <Button variant="ghost" size="sm" className="text-destructive" onClick={handleDisconnect}>
              <Trash2 className="h-3 w-3 mr-1.5" />
              Disconnect GSC
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Connect your GSC account to unlock the SEO Assistant and dashboard metrics.
            </p>
            <Button variant="outline" onClick={handleConnect} className="gap-2">
              <Link2 className="h-4 w-4" />
              Connect Google Search Console
            </Button>
          </>
        )}
      </div>

      {/* Bing Webmaster Tools */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Bing Webmaster Tools</h2>
          <p className="text-xs text-muted-foreground">
            Bing powers ChatGPT search, Copilot, and DuckDuckGo. Connecting BWT shows your visibility on the AI search surface, not just Google.
          </p>
        </div>

        {bwtLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Checking connection...</span>
          </div>
        ) : bwtConnected ? (
          <>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Connected</span>
            </div>

            {bwtProperties.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Your Bing Properties</h3>
                {bwtProperties.map((prop) => (
                  <div key={prop.id} className="flex items-center gap-3 p-3 rounded-lg border">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {prop.site_url.replace(/^https?:\/\//, '')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {prop.site_group_id && properties.some((g) => g.site_group_id === prop.site_group_id)
                          ? 'Auto-paired with your GSC property'
                          : 'Bing-only site'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button variant="ghost" size="sm" className="text-destructive" onClick={handleBWTDisconnect}>
              <Trash2 className="h-3 w-3 mr-1.5" />
              Disconnect Bing
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Connect Bing Webmaster Tools to combine Google + Bing data on your dashboards.
            </p>
            <Button variant="outline" onClick={handleBWTConnect} className="gap-2">
              <Link2 className="h-4 w-4" />
              Connect Bing Webmaster Tools
            </Button>
          </>
        )}
      </div>

      {/* LLM API Key (BYOK) */}
      <div id="llm" className="scroll-mt-20 rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <h2 className="text-lg font-semibold">OpenRouter AI Key</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Bring your own OpenRouter key. DataWise uses tested routing: Sonar Pro for search-grounded work and your selected OpenRouter model for assistant and writer analysis.
        </p>

        <div className="space-y-3">
          {legacyProvider && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Your browser still has an old {legacyProvider} key saved. The app now routes user-facing AI through OpenRouter only, so reconnect with an OpenRouter key.
            </div>
          )}

          <div className="space-y-2">
            <Label>OpenRouter API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={llmApiKey}
                onChange={(e) => { setLlmApiKey(e.target.value); setLlmSaved(false); }}
                placeholder="sk-or-..."
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Default analysis and writer model</Label>
            <Select value={llmModel || DEFAULT_OPENROUTER_MODEL} onValueChange={(v) => { setLlmModel(v); setLlmSaved(false); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="min-w-[360px]">
                {OPENROUTER_PROVIDER_GROUPS.map((provider, providerIndex) => {
                  const models = OPENROUTER_MODELS.filter((model) => model.provider === provider.id);
                  if (!models.length) return null;
                  return (
                    <SelectGroup key={provider.id}>
                      {providerIndex > 0 ? <SelectSeparator /> : null}
                      <SelectLabel className="flex items-center gap-2 pl-8 text-xs uppercase tracking-wide text-muted-foreground">
                        <img src={providerLogo(provider.id)} alt="" className="h-3.5 w-3.5" />
                        {provider.name}
                      </SelectLabel>
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            {m.id === DEFAULT_OPENROUTER_MODEL && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                                Default
                              </span>
                            )}
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                              {m.tier}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {m.input}/{m.output}
                            </span>
                            <span className="text-xs text-muted-foreground/60">{m.context}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {OPENROUTER_MODELS.find((m) => m.id === llmModel)?.why || OPENROUTER_MODELS[0].why}
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSaveLLM} disabled={!llmApiKey.trim() || llmSaved} size="sm">
              {llmSaved ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1.5" />
                  Saved
                </>
              ) : 'Save Settings'}
            </Button>
            {llmSaved && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={handleClearLLM}>
                <Trash2 className="h-3 w-3 mr-1.5" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Promo Code */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Ticket className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Promo Code</h2>
        </div>

        {promoActive ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-0">Active</Badge>
              {promoLabel && <span className="text-sm font-medium">{promoLabel}</span>}
            </div>
            {promoExpiresAt && (
              <p className="text-sm text-muted-foreground">
                Expires: {new Date(promoExpiresAt).toLocaleString()}
              </p>
            )}
            <p className="text-sm text-green-600 font-medium">
              You have unlimited access while this promo is active.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter a promo code to unlock temporary unlimited access.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Enter promo code"
                value={promoCodeInput}
                onChange={(e) => {
                  setPromoCodeInput(e.target.value.toUpperCase());
                  setPromoError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleRedeemPromo()}
                className="max-w-xs uppercase"
              />
              <Button onClick={handleRedeemPromo} disabled={promoRedeeming || !promoCodeInput.trim()} size="sm">
                {promoRedeeming ? (
                  <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Applying...</>
                ) : 'Apply'}
              </Button>
            </div>
            {promoError && (
              <p className="text-xs text-destructive">{promoError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
