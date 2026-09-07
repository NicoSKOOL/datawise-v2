import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plug, Loader2, Trash2, Copy, Check, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  useMcpTokens, useMcpUsage, createMcpToken, revokeMcpToken, claudeCodeCommand,
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
        Use DataWise data (keyword research, competitors, backlinks, rank tracking, AI visibility, Search Console) from Claude Code and other MCP clients. Create a personal token, paste it into your client, and the assistant can call DataWise on your behalf.
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

      <Tabs defaultValue="claude-code">
        <TabsList>
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="other">Other MCP clients</TabsTrigger>
        </TabsList>
        <TabsContent value="claude-code" className="space-y-2 text-sm">
          <p>Run this once in your terminal, replacing the placeholder with a token from above:</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{claudeCodeCommand('<your-token>')}</pre>
          <p className="text-muted-foreground">Then type <code>/mcp</code> in Claude Code to confirm the connection, and ask for something like "use datawise to find keyword ideas for local seo services".</p>
        </TabsContent>
        <TabsContent value="other" className="space-y-2 text-sm">
          <p>Server URL: <code>{MCP_SERVER_URL}</code> (Streamable HTTP).</p>
          <p>Send the header <code>Authorization: Bearer &lt;your-token&gt;</code>. Sign-in with your DataWise account for ChatGPT and claude.ai is coming next.</p>
        </TabsContent>
      </Tabs>

      <Dialog open={reveal !== null} onOpenChange={(open) => { if (!open) setReveal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your new token</DialogTitle>
            <DialogDescription>This is the only time DataWise will show it. Store it somewhere safe.</DialogDescription>
          </DialogHeader>
          {reveal && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted p-2 text-xs">{reveal.token}</code>
                <CopyButton text={reveal.token} />
              </div>
              <div>
                <Label className="text-xs">Claude Code command</Label>
                <div className="mt-1 flex items-start gap-2">
                  <pre className="flex-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{claudeCodeCommand(reveal.token)}</pre>
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
