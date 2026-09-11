import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plug, Loader2, Trash2, Copy, Check, KeyRound, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  useMcpTokens, useMcpUsage, createMcpToken, revokeMcpToken, claudeCodeCommand,
  useMcpGrants, revokeMcpGrant, MCP_GRANTS_KEY, claudeCodeOauthCommand,
  MCP_SERVER_URL, MCP_TOKENS_KEY, MCP_USAGE_KEY, type McpUsage,
} from '@/lib/mcp';

const DENIAL_COPY: Record<NonNullable<McpUsage['denial']>, string> = {
  not_member: 'MCP access is included with AI Ranking Skool membership and DataWise Pro.',
  early_access: 'The MCP server is in early access. Your account is not on the list yet.',
  paused: 'The MCP server is paused for maintenance. Check back shortly.',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
    </Button>
  );
}

export function McpAccessCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: tokens = [], isLoading: tokensLoading } = useMcpTokens();
  const { data: usage } = useMcpUsage();
  const { data: grants = [], isLoading: grantsLoading, isError: grantsError } = useMcpGrants();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const handleDisconnect = async (id: string, clientName: string) => {
    setDisconnectingId(id);
    try {
      await revokeMcpGrant(id);
      queryClient.invalidateQueries({ queryKey: MCP_GRANTS_KEY });
      toast({ title: `${clientName} disconnected` });
    } catch (err) {
      toast({ title: 'Could not disconnect', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDisconnectingId(null);
    }
  };

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ name: string; token: string } | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: MCP_TOKENS_KEY });
    queryClient.invalidateQueries({ queryKey: MCP_USAGE_KEY });
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await createMcpToken(name.trim());
      setReveal({ name: created.name, token: created.token });
      setName('');
      refresh();
    } catch (err) {
      toast({ title: 'Could not create token', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await revokeMcpToken(id);
      refresh();
      toast({ title: 'Token revoked' });
    } catch (err) {
      toast({ title: 'Could not revoke token', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setRevokingId(null);
    }
  };

  const atLimit = usage ? tokens.length >= usage.max_tokens : false;
  const capLabel = usage?.cap_usd == null ? 'unlimited' : `$${usage.cap_usd.toFixed(2)}`;

  return (
    <div id="mcp" className="scroll-mt-20 rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5" />
        <h2 className="text-lg font-semibold">MCP & AI assistants</h2>
        {usage && (usage.access
          ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-0">Enabled</Badge>
          : <Badge variant="secondary">Not available</Badge>)}
      </div>
      <p className="text-sm text-muted-foreground">
        Use your DataWise data (keyword research, People Also Ask, competitors, backlinks, rank tracking, AI visibility, Search Console, Local Pack audits) from ChatGPT, claude.ai, Claude Desktop, Claude Code and other MCP clients. Add the DataWise connector in the app, sign in with this account, click Allow. Personal tokens are for tools that cannot sign in.
      </p>

      {usage && !usage.access && usage.denial && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{DENIAL_COPY[usage.denial]}</div>
      )}

      {usage && usage.access && (
        <p className="text-sm">
          Today: <span className="font-medium">${usage.spent_usd.toFixed(2)}</span> of {capLabel} daily data budget, {usage.calls} calls. Resets at 00:00 UTC, no rollover.
        </p>
      )}

      <div className="space-y-2">
        <Label className="flex items-center gap-1"><Link2 className="h-4 w-4" /> Connected apps</Label>
        {grantsLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : grantsError ? (
          <p className="text-sm text-destructive">Could not load connected apps. Reload the page to try again.</p>
        ) : grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No apps connected yet. Follow the steps below for your assistant.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{g.client_name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">connected {new Date(g.created_at).toLocaleDateString()}, read-only</span>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={disconnectingId === g.id} onClick={() => handleDisconnect(g.id, g.client_name)} aria-label={`Disconnect ${g.client_name}`}>
                  {disconnectingId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-1"><KeyRound className="h-4 w-4" /> Personal tokens</Label>
        {tokensLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-2 text-muted-foreground">dwmcp_…{t.token_suffix}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    created {new Date(t.created_at).toLocaleDateString()}{t.last_used_at ? `, last used ${new Date(t.last_used_at).toLocaleDateString()}` : ', never used'}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={revokingId === t.id} onClick={() => handleRevoke(t.id)} aria-label={`Revoke ${t.name}`}>
                  {revokingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            placeholder='Token name, e.g. "Claude Code laptop"'
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); } }}
            disabled={creating || atLimit || !usage?.access}
            maxLength={60}
          />
          <Button type="button" onClick={handleCreate} disabled={creating || atLimit || !name.trim() || !usage?.access}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create token'}
          </Button>
        </div>
        {atLimit && <p className="text-xs text-muted-foreground">You have the maximum of {usage?.max_tokens} tokens. Revoke one to create another.</p>}
      </div>

      <Tabs defaultValue="claude">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="claude">claude.ai and Claude Desktop</TabsTrigger>
          <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="other">Other MCP clients</TabsTrigger>
        </TabsList>
        <TabsContent value="claude" className="space-y-2 text-sm">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open Settings, then Connectors, and choose Add custom connector.</li>
            <li>Name: <code>DataWise</code>. Remote MCP server URL: <code>{MCP_SERVER_URL}</code>. Click Continue.</li>
            <li>A DataWise tab opens. Sign in if asked, then click Allow.</li>
          </ol>
          <p className="text-muted-foreground">In a chat, enable DataWise under the tools menu and ask for something like "use DataWise to find keyword ideas for local seo services".</p>
        </TabsContent>
        <TabsContent value="chatgpt" className="space-y-2 text-sm">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open Settings, then Connectors, then Advanced, and turn on Developer mode.</li>
            <li>Back in Connectors choose Create. Name: <code>DataWise</code>. MCP server URL: <code>{MCP_SERVER_URL}</code>. Authentication: OAuth. Click Create.</li>
            <li>A DataWise tab opens. Sign in if asked, then click Allow.</li>
          </ol>
          <p className="text-muted-foreground">In a chat, open the plus menu, choose Developer mode, and tick DataWise. Requires a paid ChatGPT plan.</p>
        </TabsContent>
        <TabsContent value="claude-code" className="space-y-2 text-sm">
          <p>Run this once in your terminal, then type <code>/mcp</code> in Claude Code and choose Authenticate. Your browser opens DataWise: sign in if asked and click Allow.</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{claudeCodeOauthCommand()}</pre>
          <p className="text-muted-foreground">Prefer a token (for servers or scripts)? Create one above and run:</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{claudeCodeCommand('<your-token>')}</pre>
        </TabsContent>
        <TabsContent value="other" className="space-y-2 text-sm">
          <p>Server URL: <code>{MCP_SERVER_URL}</code> (Streamable HTTP). Clients that support OAuth sign in with your DataWise account automatically.</p>
          <p>Clients that only accept a static header: create a personal token above and send <code>Authorization: Bearer &lt;your-token&gt;</code>.</p>
        </TabsContent>
      </Tabs>

      <Dialog open={reveal !== null} onOpenChange={(open) => { if (!open) setReveal(null); }}>
        <DialogContent className="max-w-full overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy your new token</DialogTitle>
            <DialogDescription>This is the only time DataWise will show it. Store it somewhere safe.</DialogDescription>
          </DialogHeader>
          {reveal && (
            <div className="min-w-0 w-full space-y-3">
              <div className="min-w-0 flex items-center gap-2">
                <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{reveal.token}</code>
                <CopyButton text={reveal.token} />
              </div>
              <div className="min-w-0">
                <Label className="text-xs">Claude Code command</Label>
                <div className="mt-1 min-w-0 flex items-start gap-2">
                  <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{claudeCodeCommand(reveal.token)}</pre>
                  <CopyButton text={claudeCodeCommand(reveal.token)} />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
