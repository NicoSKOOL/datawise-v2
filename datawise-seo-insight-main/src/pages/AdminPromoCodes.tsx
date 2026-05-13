import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchPromoCodes,
  createPromoCode,
  togglePromoCode,
  fetchPromoRedemptions,
  type PromoCode,
  type PromoRedemption,
  type PromoConversionSummary,
} from '@/lib/admin';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { AlertCircle, Plus, RefreshCw, Power, PowerOff, ChevronDown, ChevronUp, Loader2, Ticket, Users, TrendingUp, MousePointerClick, UserPlus } from 'lucide-react';

export default function AdminPromoCodes() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [organic, setOrganic] = useState<PromoConversionSummary>({ conversion_count: 0, total_ltv: 0 });
  const [promoTotal, setPromoTotal] = useState<PromoConversionSummary>({ conversion_count: 0, total_ltv: 0 });
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Create form
  const [formCode, setFormCode] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formDuration, setFormDuration] = useState('48');
  const [formMaxRedemptions, setFormMaxRedemptions] = useState('');
  const [formExpiresAt, setFormExpiresAt] = useState('');

  // Expanded row for redemptions
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [redemptions, setRedemptions] = useState<PromoRedemption[]>([]);
  const [loadingRedemptions, setLoadingRedemptions] = useState(false);

  const loadPromoCodes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPromoCodes();
      setPromoCodes(data.promo_codes);
      setOrganic(data.organic);
      setPromoTotal(data.promo_total);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to load promo codes', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) loadPromoCodes();
  }, [isAdmin, loadPromoCodes]);

  const handleCreate = async () => {
    if (!formCode.trim() || !formLabel.trim()) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Code and label are required.' });
      return;
    }
    setCreating(true);
    try {
      await createPromoCode({
        code: formCode.trim().toUpperCase(),
        label: formLabel.trim(),
        duration_hours: parseInt(formDuration) || 48,
        max_redemptions: formMaxRedemptions ? parseInt(formMaxRedemptions) : undefined,
        expires_at: formExpiresAt || undefined,
      });
      toast({ title: 'Promo code created', description: `Code "${formCode.toUpperCase()}" is now active.` });
      setCreateOpen(false);
      resetForm();
      await loadPromoCodes();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setFormCode('');
    setFormLabel('');
    setFormDuration('48');
    setFormMaxRedemptions('');
    setFormExpiresAt('');
  };

  const handleToggle = async (id: string) => {
    setTogglingId(id);
    try {
      await togglePromoCode(id);
      await loadPromoCodes();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: (err as Error).message });
    } finally {
      setTogglingId(null);
    }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setRedemptions([]);
      return;
    }
    setExpandedId(id);
    setLoadingRedemptions(true);
    try {
      const data = await fetchPromoRedemptions(id);
      setRedemptions(data.redemptions);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: (err as Error).message });
    } finally {
      setLoadingRedemptions(false);
    }
  };

  const formatLtv = (n: number) => {
    if (!n) return '$0';
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${Math.round(n)}`;
  };

  const conversionRateColor = (rate: number) => {
    if (rate >= 10) return 'text-green-600 dark:text-green-400';
    if (rate >= 3) return 'text-amber-600 dark:text-amber-400';
    return 'text-muted-foreground';
  };

  const totalConversions = promoTotal.conversion_count + organic.conversion_count;
  const totalLtv = promoTotal.total_ltv + organic.total_ltv;
  const totalLinkSessions = promoCodes.reduce((sum, pc) => sum + (pc.link_visit_sessions || 0), 0);
  const totalAttributedSignups = promoCodes.reduce((sum, pc) => sum + (pc.attributed_signup_count || 0), 0);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold">Access Denied</h2>
          <p className="text-muted-foreground">You do not have admin access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Promo Codes</h1>
          <p className="text-muted-foreground text-sm">Create and manage promotional access codes.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={loadPromoCodes} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create Promo Code
          </Button>
        </div>
      </div>

      {/* Conversion summary: organic vs promo-driven */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <MousePointerClick className="h-3.5 w-3.5" />
            Promo link sessions
          </div>
          <p className="text-2xl font-bold">{totalLinkSessions}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Tracked from promo link visits</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <UserPlus className="h-3.5 w-3.5" />
            Promo signups
          </div>
          <p className="text-2xl font-bold">{totalAttributedSignups}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Signed up with a promo code</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Ticket className="h-3.5 w-3.5" />
            Promo-driven conversions
          </div>
          <p className="text-2xl font-bold">{promoTotal.conversion_count}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatLtv(promoTotal.total_ltv)} LTV</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Users className="h-3.5 w-3.5" />
            Organic conversions
          </div>
          <p className="text-2xl font-bold">{organic.conversion_count}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatLtv(organic.total_ltv)} LTV (no promo code)</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <TrendingUp className="h-3.5 w-3.5" />
            Total conversions
          </div>
          <p className="text-2xl font-bold text-primary">{totalConversions}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatLtv(totalLtv)} LTV combined</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading && !promoCodes.length ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : promoCodes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No promo codes yet. Create one to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Code</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Link Sessions</TableHead>
                    <TableHead>Signups</TableHead>
                    <TableHead>Redemptions</TableHead>
                    <TableHead>Conversions</TableHead>
                    <TableHead>LTV</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promoCodes.map((pc) => (
                    <React.Fragment key={pc.id}>
                      <TableRow className="group cursor-pointer" onClick={() => handleExpand(pc.id)}>
                        <TableCell className="pl-4">
                          {expandedId === pc.id ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <code className="px-2 py-0.5 rounded bg-muted text-sm font-mono font-medium">{pc.code}</code>
                        </TableCell>
                        <TableCell className="text-sm">{pc.label}</TableCell>
                        <TableCell className="text-sm">{pc.duration_hours}h</TableCell>
                        <TableCell className="text-sm">
                          <span className="font-medium">{pc.link_visit_sessions || 0}</span>
                          {(pc.link_pageviews || 0) > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {pc.link_pageviews} views
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{pc.attributed_signup_count || 0}</TableCell>
                        <TableCell className="text-sm">
                          {pc.redemption_count}{pc.max_redemptions ? ` / ${pc.max_redemptions}` : ''}
                          {pc.redemption_count > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {pc.active_redemption_count || 0} active · {pc.expired_redemption_count || 0} expired
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {pc.redemption_count > 0 ? (
                            <span className={conversionRateColor((pc.conversion_count / pc.redemption_count) * 100)}>
                              <span className="font-semibold">{pc.conversion_count}</span>
                              <span className="text-muted-foreground"> ({((pc.conversion_count / pc.redemption_count) * 100).toFixed(0)}%)</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {pc.avg_days_to_convert != null && pc.conversion_count > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {pc.avg_days_to_convert.toFixed(1)}d avg
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {pc.total_ltv > 0 ? (
                            <span className="font-medium">{formatLtv(pc.total_ltv)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {pc.is_active ? (
                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-0">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                          {pc.expires_at && new Date(pc.expires_at) < new Date() && (
                            <Badge variant="destructive" className="ml-1">Expired</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(pc.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={togglingId === pc.id}
                            onClick={() => handleToggle(pc.id)}
                          >
                            {pc.is_active ? (
                              <><PowerOff className="h-3 w-3 mr-1" />Deactivate</>
                            ) : (
                              <><Power className="h-3 w-3 mr-1" />Activate</>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>

                      {/* Expanded redemptions row */}
                      {expandedId === pc.id && (
                        <TableRow key={`${pc.id}-redemptions`}>
                          <TableCell colSpan={12} className="bg-muted/30 p-4">
                            {loadingRedemptions ? (
                              <div className="flex items-center gap-2 justify-center py-4 text-muted-foreground text-sm">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading redemptions...
                              </div>
                            ) : redemptions.length === 0 ? (
                              <p className="text-center text-sm text-muted-foreground py-4">No redemptions yet.</p>
                            ) : (
                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                                  <Users className="h-4 w-4" />
                                  Redemptions ({redemptions.length})
                                </div>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>User</TableHead>
                                      <TableHead>Email</TableHead>
                                      <TableHead>Activated</TableHead>
                                      <TableHead>Expires</TableHead>
                                      <TableHead>Status</TableHead>
                                      <TableHead>Converted</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {redemptions.map((r) => (
                                      <TableRow key={r.id}>
                                        <TableCell className="text-sm">{r.user_name || 'N/A'}</TableCell>
                                        <TableCell className="text-sm">{r.user_email}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                          {new Date(r.activated_at).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                          {new Date(r.expires_at).toLocaleString()}
                                        </TableCell>
                                        <TableCell>
                                          {r.is_expired ? (
                                            <Badge variant="secondary">Expired</Badge>
                                          ) : (
                                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-0">Active</Badge>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {r.converted && r.converted_at ? (
                                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">
                                              Converted {new Date(r.converted_at).toLocaleDateString()}
                                            </Badge>
                                          ) : (
                                            <span className="text-muted-foreground text-xs">—</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Promo Code Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5" />
              Create Promo Code
            </DialogTitle>
            <DialogDescription>
              Create a new promotional code that grants temporary unlimited access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input
                placeholder="e.g. LAUNCH2026"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                className="uppercase font-mono"
              />
              <p className="text-xs text-muted-foreground">Will be auto-uppercased. Users enter this to redeem.</p>
            </div>

            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                placeholder="e.g. Launch Week Promo"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Internal label shown to admins and in the user's settings.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Duration (hours)</Label>
                <Input
                  type="number"
                  value={formDuration}
                  onChange={(e) => setFormDuration(e.target.value)}
                  min="1"
                />
              </div>
              <div className="space-y-2">
                <Label>Max Redemptions</Label>
                <Input
                  type="number"
                  placeholder="Unlimited"
                  value={formMaxRedemptions}
                  onChange={(e) => setFormMaxRedemptions(e.target.value)}
                  min="1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Code Expires At (optional)</Label>
              <Input
                type="datetime-local"
                value={formExpiresAt}
                onChange={(e) => setFormExpiresAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">After this date, the code can no longer be redeemed. Leave blank for no expiry.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !formCode.trim() || !formLabel.trim()}>
              {creating ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Creating...</>
              ) : 'Create Code'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
