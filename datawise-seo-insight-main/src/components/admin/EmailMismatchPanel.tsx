import { useState, useEffect, useCallback, useMemo } from 'react';
import { getEmailMismatches, linkMember, type EmailMismatchResult } from '@/lib/admin';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Link2, Search, X, ArrowRight, AlertCircle } from 'lucide-react';

interface Props {
  /** Reports the match count so the tab badge stays in sync. */
  onCountChange?: (count: number) => void;
  /** Refresh the surrounding member lists after a link lands. */
  onLinked?: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return 'unknown';
  const ms = Date.parse(value.replace(' ', 'T') + (/[Z+]/.test(value) ? '' : 'Z'));
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function memberName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed member';
}

export default function EmailMismatchPanel({ onCountChange, onLinked }: Props) {
  const { toast } = useToast();
  const [data, setData] = useState<EmailMismatchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getEmailMismatches();
      setData(result);
      onCountChange?.(result.matches.length);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load mismatches', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [onCountChange, toast]);

  useEffect(() => { void load(); }, [load]);

  const handleLink = async (args: { userId?: string; loginEmail?: string; memberEmail: string; key: string }) => {
    setLinking(args.key);
    try {
      const result = await linkMember({ userId: args.userId, memberEmail: args.memberEmail });
      const extra = result.removed_orphan_account
        ? ` Removed the unused invite account for ${result.removed_orphan_account}.`
        : '';
      toast({
        title: 'Accounts linked',
        description: `${result.alias_email} now has community access through ${result.member_email}.${extra}`,
      });
      setManualFor(null);
      setManualEmail('');
      await load();
      onLinked?.();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Link failed', description: (err as Error).message });
    } finally {
      setLinking(null);
    }
  };

  const handleManualLink = async (memberEmail: string) => {
    const login = manualEmail.trim().toLowerCase();
    if (!login) return;
    setLinking(`manual:${memberEmail}`);
    try {
      const result = await linkMember({ loginEmail: login, memberEmail });
      toast({ title: 'Accounts linked', description: `${result.alias_email} now has community access.` });
      setManualFor(null);
      setManualEmail('');
      await load();
      onLinked?.();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Link failed', description: (err as Error).message });
    } finally {
      setLinking(null);
    }
  };

  const filteredUnclaimed = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.unclaimed_grants;
    return data.unclaimed_grants.filter(g =>
      g.email.toLowerCase().includes(q) ||
      memberName(g.first_name, g.last_name).toLowerCase().includes(q)
    );
  }, [data, search]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-4 space-y-6">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Scanned {data.blocked_count} free account(s) that used at least {data.min_credits} credit(s) against{' '}
        {data.unclaimed_grants.length} unclaimed member invite(s). Linking records that two addresses are the same
        person, so the grant survives future CSV uploads.
      </div>

      {/* Suggested pairs */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Likely same person ({data.matches.length})</h3>
        {data.matches.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No likely mismatches. Blocked members whose email shares nothing with their Skool name will not appear
            here: pair those by hand below.
          </div>
        ) : (
          data.matches.map(({ account, suggestions }) => (
            <div key={account.id} className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-sm break-all">{account.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {account.name || 'No name'} · {account.credits_used} credits used · joined{' '}
                    {formatDate(account.created_at)}
                  </div>
                </div>
                <Badge variant="destructive" className="flex-shrink-0">Blocked on free</Badge>
              </div>

              {suggestions.map(s => (
                <div
                  key={s.member.email}
                  className="flex flex-col gap-2 rounded-md bg-muted/40 p-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <span className="font-medium break-all">{s.member.email}</span>
                      <span className="text-muted-foreground">
                        ({memberName(s.member.first_name, s.member.last_name)})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {s.reasons.map(r => (
                        <span key={r} className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="flex-shrink-0"
                    disabled={linking !== null}
                    onClick={() => handleLink({
                      userId: account.id,
                      memberEmail: s.member.email,
                      key: `${account.id}:${s.member.email}`,
                    })}
                  >
                    <Link2 className="h-3.5 w-3.5 mr-1.5" />
                    {linking === `${account.id}:${s.member.email}` ? 'Linking...' : 'Link'}
                  </Button>
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      {/* Unclaimed invites, for manual pairing */}
      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold">
            Paid members who never logged in ({data.unclaimed_grants.length})
          </h3>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search name or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 w-56 pl-8 text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {data.unclaimed_grants.length > 0 && (
          <div className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              These invites were never claimed. Some of these people are simply not using the app yet; others are
              signed in under a different address. When one writes in, find them here and link their login email.
            </span>
          </div>
        )}

        <div className="max-h-96 overflow-y-auto rounded-lg border divide-y">
          {filteredUnclaimed.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nothing matches that search.</div>
          ) : (
            filteredUnclaimed.map(g => (
              <div key={g.email} className="p-2.5 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium break-all">{memberName(g.first_name, g.last_name)}</div>
                    <div className="text-xs text-muted-foreground break-all">
                      {g.email} · joined Skool {formatDate(g.joined_date)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0"
                    onClick={() => {
                      setManualFor(manualFor === g.email ? null : g.email);
                      setManualEmail('');
                    }}
                  >
                    <Link2 className="h-3.5 w-3.5 mr-1.5" />
                    Link a login email
                  </Button>
                </div>

                {manualFor === g.email && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      type="email"
                      autoFocus
                      placeholder="The address they actually sign in with..."
                      value={manualEmail}
                      onChange={e => setManualEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && void handleManualLink(g.email)}
                      className="h-8 flex-1 text-sm"
                    />
                    <Button
                      size="sm"
                      disabled={!manualEmail.trim() || linking !== null}
                      onClick={() => void handleManualLink(g.email)}
                    >
                      {linking === `manual:${g.email}` ? 'Linking...' : 'Link'}
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
