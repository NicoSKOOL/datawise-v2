import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link2, Loader2, RefreshCw, Trash2, CheckCircle, Key, Eye, EyeOff, Check } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { connectGSC, getGSCProperties, syncGSCProperty, disconnectGSC, updateGSCProperty, refreshGSCProperties, type GSCProperty } from '@/lib/gsc';
import { getLLMConfig, saveLLMConfig, clearLLMConfig, type LLMConfig } from '@/lib/chat';
import { useToast } from '@/hooks/use-toast';

const LLM_PROVIDERS = [
  { value: 'openai', label: 'OpenAI (GPT-4o-mini)', hint: 'Cheapest good option (~$0.15/1M tokens)' },
  { value: 'claude', label: 'Anthropic (Claude)', hint: 'Best reasoning quality' },
  { value: 'gemini', label: 'Google (Gemini Flash)', hint: 'Free tier available' },
  { value: 'openrouter', label: 'OpenRouter', hint: 'Access all models with one key' },
] as const;

const OPENROUTER_MODELS = [
  // Premium
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'premium', input: '$3.00', output: '$15.00', context: '1M', why: 'Best for nuanced SEO analysis and content strategy' },
  { id: 'openai/gpt-5.3-chat', name: 'GPT-5.3', tier: 'premium', input: '$1.75', output: '$14.00', context: '128K', why: 'Strong general reasoning, good for chat' },
  // Budget
  { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano', tier: 'budget', input: '$0.10', output: '$0.40', context: '1M', why: '1M context at near-zero cost, great for bulk SEO tasks' },
  { id: 'openai/gpt-5-nano', name: 'GPT-5 Nano', tier: 'budget', input: '$0.05', output: '$0.40', context: '400K', why: 'Cheapest GPT-5 family model, good for high-volume work' },
  { id: 'qwen/qwen3-235b-a22b-2507', name: 'Qwen3 235B', tier: 'budget', input: '$0.07', output: '$0.10', context: '262K', why: 'Best quality-per-dollar, strong reasoning' },
  // Free
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', tier: 'free', input: 'FREE', output: 'FREE', context: '65K', why: 'Solid 70B model, good instruction following' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1', tier: 'free', input: 'FREE', output: 'FREE', context: '128K', why: 'Free with 128K context, great for longer reports' },
  { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B', tier: 'free', input: 'FREE', output: 'FREE', context: '131K', why: 'Google\'s free model, good at structured analysis' },
] as const;

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  premium: { label: 'Premium', color: 'text-amber-600 dark:text-amber-400' },
  budget: { label: 'Budget', color: 'text-blue-600 dark:text-blue-400' },
  free: { label: 'Free', color: 'text-green-600 dark:text-green-400' },
};

export default function SettingsPage() {
  const { user, isPro, isCommunityMember } = useAuth();
  const { toast } = useToast();
  const [connected, setConnected] = useState(false);
  const [properties, setProperties] = useState<GSCProperty[]>([]);
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

  // LLM config (BYOK)
  const [llmProvider, setLlmProvider] = useState<string>('openai');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState<string>('');
  const [showKey, setShowKey] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);

  useEffect(() => {
    const config = getLLMConfig();
    if (config) {
      setLlmProvider(config.provider);
      setLlmApiKey(config.api_key);
      setLlmModel(config.model || '');
      setLlmSaved(true);
    }
  }, []);

  const handleSaveLLM = () => {
    if (!llmApiKey.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please enter an API key' });
      return;
    }
    const config: LLMConfig = { provider: llmProvider as LLMConfig['provider'], api_key: llmApiKey.trim() };
    if (llmProvider === 'openrouter' && llmModel) {
      config.model = llmModel;
    }
    saveLLMConfig(config);
    setLlmSaved(true);
    toast({ title: 'Saved', description: 'LLM configuration saved locally (never sent to our servers).' });
  };

  const handleClearLLM = () => {
    clearLLMConfig();
    setLlmApiKey('');
    setLlmModel('');
    setLlmSaved(false);
    toast({ title: 'Cleared', description: 'API key removed.' });
  };

  useEffect(() => {
    loadGSCStatus();

    // Check for GSC callback params
    const params = new URLSearchParams(window.location.search);
    if (params.get('gsc_connected') === 'true') {
      toast({ title: 'GSC Connected', description: 'Google Search Console connected successfully.' });
      window.history.replaceState({}, '', '/settings');
    }
    if (params.get('gsc_error')) {
      toast({ variant: 'destructive', title: 'GSC Connection Failed', description: `Error: ${params.get('gsc_error')}` });
      window.history.replaceState({}, '', '/settings');
    }
  }, []);

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
      toast({ title: 'Sync Complete', description: `Synced ${result.rows_synced} rows from ${result.property}` });
      loadGSCStatus();
    } catch {
      toast({ variant: 'destructive', title: 'Sync Failed', description: 'Could not sync GSC data. Try reconnecting.' });
    } finally {
      setSyncing(null);
    }
  };

  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshProperties = async () => {
    setRefreshing(true);
    try {
      const data = await refreshGSCProperties();
      setProperties(data.properties || []);
      toast({ title: 'Properties Refreshed', description: 'Your GSC property list has been updated.' });
    } catch {
      toast({ variant: 'destructive', title: 'Refresh Failed', description: 'Could not refresh properties. Try reconnecting.' });
    } finally {
      setRefreshing(false);
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
                <h3 className="text-sm font-medium text-muted-foreground">Your Properties</h3>
                <p className="text-xs text-muted-foreground">Toggle properties on/off for the SEO Assistant dropdown. Assign colors to identify conversations.</p>
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

            <div className="flex items-center gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={handleRefreshProperties} disabled={refreshing}>
                {refreshing ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
                {refreshing ? 'Refreshing...' : 'Refresh Properties'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleConnect}>
                <Link2 className="h-3 w-3 mr-1.5" />
                Reconnect
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={handleDisconnect}>
                <Trash2 className="h-3 w-3 mr-1.5" />
                Disconnect
              </Button>
            </div>
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

      {/* LLM API Key (BYOK) */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <h2 className="text-lg font-semibold">AI Chat Model</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Bring your own API key to power the SEO Assistant chat. Your key is stored locally in your browser and never sent to our servers.
        </p>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={llmProvider} onValueChange={(v) => { setLlmProvider(v); setLlmSaved(false); if (v === 'openrouter' && !llmModel) setLlmModel(OPENROUTER_MODELS[0].id); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LLM_PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <div>
                      <span>{p.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={llmApiKey}
                onChange={(e) => { setLlmApiKey(e.target.value); setLlmSaved(false); }}
                placeholder={
                  llmProvider === 'openai' ? 'sk-...' :
                  llmProvider === 'claude' ? 'sk-ant-...' :
                  llmProvider === 'openrouter' ? 'sk-or-...' :
                  'AIza...'
                }
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

          {llmProvider === 'openrouter' && (
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={llmModel || OPENROUTER_MODELS[0].id} onValueChange={(v) => { setLlmModel(v); setLlmSaved(false); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['premium', 'budget', 'free'] as const).map((tier) => {
                    const tierInfo = TIER_LABELS[tier];
                    const models = OPENROUTER_MODELS.filter((m) => m.tier === tier);
                    return models.map((m, i) => (
                      <SelectItem key={m.id} value={m.id}>
                        <div className="flex items-center gap-2">
                          {i === 0 && (
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${tierInfo.color}`}>
                              {tierInfo.label}
                            </span>
                          )}
                          {i > 0 && <span className="text-[10px] w-[52px]" />}
                          <span className="font-medium">{m.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {m.tier === 'free' ? 'FREE' : `${m.input}/${m.output}`}
                          </span>
                          <span className="text-xs text-muted-foreground/60">{m.context}</span>
                        </div>
                      </SelectItem>
                    ));
                  }).flat()}
                </SelectContent>
              </Select>
              {llmModel && (
                <p className="text-xs text-muted-foreground">
                  {OPENROUTER_MODELS.find((m) => m.id === llmModel)?.why || OPENROUTER_MODELS[0].why}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSaveLLM} disabled={!llmApiKey.trim() || llmSaved} size="sm">
              {llmSaved ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1.5" />
                  Saved
                </>
              ) : 'Save Key'}
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
    </div>
  );
}
