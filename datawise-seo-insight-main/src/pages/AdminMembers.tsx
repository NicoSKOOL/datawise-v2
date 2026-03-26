import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { uploadMembers, getCrossReference, revokeAccess, sendInvites, toggleMember, addMember, listUsers, deleteUser } from '@/lib/admin';
import type { AppUser } from '@/lib/admin';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Upload, AlertCircle, RefreshCw, Send, ShieldCheck, ShieldX, Trash2, Search, X, UserPlus } from 'lucide-react';

type UserStatus = 'community' | 'non-member' | 'not-registered' | 'unknown';
type TabValue = 'all' | 'community' | 'non-members' | 'not-registered';

interface UnifiedUser {
  id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  status: UserStatus;
  subscription_tier: string;
  credits_used: number | null;
  created_at: string | null;
  is_admin: number;
  community_tier?: string;
  ltv?: number;
  joined_date?: string;
}

interface ActiveMember {
  id: string;
  email: string;
  name: string;
  subscription_tier: string;
  created_at: string;
  first_name: string;
  last_name: string;
  community_tier: string;
  ltv: number;
  joined_date: string;
}

interface NonMember {
  id: string;
  email: string;
  name: string;
  subscription_tier: string;
  is_community_member: number;
  created_at: string;
}

interface NotRegistered {
  email: string;
  first_name: string;
  last_name: string;
  tier: string;
  ltv: number;
  joined_date: string;
}

export default function AdminMembers() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const [totalCsvMembers, setTotalCsvMembers] = useState(0);
  const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([]);
  const [nonMembers, setNonMembers] = useState<NonMember[]>([]);
  const [notRegistered, setNotRegistered] = useState<NotRegistered[]>([]);
  const [hasData, setHasData] = useState(false);

  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState(false);
  const [sendingInvites, setSendingInvites] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [addingManual, setAddingManual] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await listUsers();
      setAllUsers(data.users);
    } catch {
      // silently fail
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadCrossReference = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCrossReference();
      setTotalCsvMembers(data.total_csv_members);
      setActiveMembers(data.active_members);
      setNonMembers(data.non_members);
      setNotRegistered(data.not_registered);
      setHasData(true);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to load data', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
      // Try loading cross-reference on mount (in case CSV was previously uploaded)
      loadCrossReference();
    }
  }, [isAdmin, loadUsers, loadCrossReference]);

  // Clear selection when switching tabs
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  // Build unified user list
  const activeMemberIds = useMemo(() => new Set(activeMembers.map(m => m.id)), [activeMembers]);
  const nonMemberIds = useMemo(() => new Set(nonMembers.map(m => m.id)), [nonMembers]);
  const activeMemberMap = useMemo(() => {
    const map = new Map<string, ActiveMember>();
    activeMembers.forEach(m => map.set(m.id, m));
    return map;
  }, [activeMembers]);

  const unifiedUsers: UnifiedUser[] = useMemo(() => {
    const rows: UnifiedUser[] = [];

    // Registered users
    for (const u of allUsers) {
      let status: UserStatus = 'unknown';
      let communityTier: string | undefined;
      let ltv: number | undefined;
      let joinedDate: string | undefined;

      if (hasData) {
        if (activeMemberIds.has(u.id)) {
          status = 'community';
          const am = activeMemberMap.get(u.id);
          if (am) {
            communityTier = am.community_tier;
            ltv = am.ltv;
            joinedDate = am.joined_date;
          }
        } else if (nonMemberIds.has(u.id)) {
          status = 'non-member';
        } else {
          // Not in either set (could be admin excluded from queries)
          status = u.is_community_member ? 'community' : 'unknown';
        }
      } else {
        status = u.is_community_member ? 'community' : 'unknown';
      }

      rows.push({
        id: u.id,
        email: u.email,
        name: u.name || '',
        avatar_url: u.avatar_url,
        status,
        subscription_tier: u.subscription_tier,
        credits_used: u.credits_used,
        created_at: u.created_at,
        is_admin: u.is_admin,
        community_tier: communityTier,
        ltv,
        joined_date: joinedDate,
      });
    }

    // Not-registered entries (community CSV members without app accounts)
    if (hasData) {
      for (const nr of notRegistered) {
        rows.push({
          id: null,
          email: nr.email,
          name: [nr.first_name, nr.last_name].filter(Boolean).join(' ') || '',
          avatar_url: null,
          status: 'not-registered',
          subscription_tier: nr.tier || '',
          credits_used: null,
          created_at: null,
          is_admin: 0,
          ltv: nr.ltv,
          joined_date: nr.joined_date,
        });
      }
    }

    return rows;
  }, [allUsers, hasData, activeMemberIds, nonMemberIds, activeMemberMap, notRegistered]);

  // Counts per tab
  const counts = useMemo(() => ({
    all: unifiedUsers.length,
    community: unifiedUsers.filter(r => r.status === 'community').length,
    nonMembers: unifiedUsers.filter(r => r.status === 'non-member').length,
    notRegistered: unifiedUsers.filter(r => r.status === 'not-registered').length,
  }), [unifiedUsers]);

  // Filtered rows
  const filteredUsers = useMemo(() => {
    let rows = unifiedUsers;

    if (activeTab === 'community') rows = rows.filter(r => r.status === 'community');
    else if (activeTab === 'non-members') rows = rows.filter(r => r.status === 'non-member');
    else if (activeTab === 'not-registered') rows = rows.filter(r => r.status === 'not-registered');

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(r => r.email.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    }

    return rows;
  }, [unifiedUsers, activeTab, searchQuery]);

  // Selectable rows (only registered, non-admin users)
  const selectableIds = useMemo(
    () => filteredUsers.filter(r => r.id && r.is_admin !== 1).map(r => r.id!),
    [filteredUsers]
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Handlers
  const handleFileUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast({ variant: 'destructive', title: 'No file selected', description: 'Please select a CSV file.' });
      return;
    }

    setUploading(true);
    try {
      const csvText = await file.text();
      const result = await uploadMembers(csvText);
      toast({ title: 'Upload complete', description: `Imported ${result.imported} community members.` });
      await Promise.all([loadCrossReference(), loadUsers()]);
      setActiveTab('non-members');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Upload failed', description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([loadCrossReference(), loadUsers()]);
  };

  const handleToggleMember = async (userId: string, action: 'grant' | 'revoke') => {
    setTogglingId(userId);
    try {
      await toggleMember(userId, action);
      toast({ title: action === 'grant' ? 'Access granted' : 'Access revoked' });
      await Promise.all([loadUsers(), hasData ? loadCrossReference() : Promise.resolve()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: (err as Error).message });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!window.confirm(`Delete user ${email}? This removes all their data and cannot be undone.`)) return;
    setTogglingId(userId);
    try {
      await deleteUser(userId);
      toast({ title: 'User deleted' });
      await Promise.all([loadUsers(), hasData ? loadCrossReference() : Promise.resolve()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: (err as Error).message });
    } finally {
      setTogglingId(null);
    }
  };

  const handleBulkGrant = async () => {
    if (selectedIds.size === 0) return;
    setBulkAction(true);
    try {
      await Promise.all(Array.from(selectedIds).map(id => toggleMember(id, 'grant')));
      toast({ title: 'Access granted', description: `Granted community access to ${selectedIds.size} user(s).` });
      setSelectedIds(new Set());
      await Promise.all([loadUsers(), hasData ? loadCrossReference() : Promise.resolve()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: (err as Error).message });
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkRevoke = async () => {
    if (selectedIds.size === 0) return;
    setBulkAction(true);
    try {
      await revokeAccess(Array.from(selectedIds));
      toast({ title: 'Access revoked', description: `Revoked access for ${selectedIds.size} user(s).` });
      setSelectedIds(new Set());
      await Promise.all([loadUsers(), hasData ? loadCrossReference() : Promise.resolve()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Revoke failed', description: (err as Error).message });
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} user(s)? This cannot be undone.`)) return;
    setBulkAction(true);
    try {
      await Promise.all(Array.from(selectedIds).map(id => deleteUser(id)));
      toast({ title: 'Users deleted', description: `Deleted ${selectedIds.size} user(s).` });
      setSelectedIds(new Set());
      await Promise.all([loadUsers(), hasData ? loadCrossReference() : Promise.resolve()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete failed', description: (err as Error).message });
    } finally {
      setBulkAction(false);
    }
  };

  const handleSendAllInvites = async () => {
    setSendingInvites(true);
    try {
      const result = await sendInvites();
      toast({ title: 'Invites sent', description: `Sent ${result.sent} invite emails.${result.failed > 0 ? ` ${result.failed} failed.` : ''}` });
      await Promise.all([loadCrossReference(), loadUsers()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Send failed', description: (err as Error).message });
    } finally {
      setSendingInvites(false);
    }
  };

  const handleSendSingleInvite = async (email: string) => {
    try {
      const result = await sendInvites([email]);
      toast({ title: result.sent > 0 ? 'Invite sent' : 'Failed', description: result.sent > 0 ? `Invite sent to ${email}` : 'Could not send invite.' });
      await Promise.all([loadCrossReference(), loadUsers()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Send failed', description: (err as Error).message });
    }
  };

  const handleAddMember = async () => {
    if (!manualEmail.trim()) return;
    setAddingManual(true);
    try {
      const result = await addMember(manualEmail.trim());
      toast({ title: result.status === 'granted' ? 'Access granted' : 'Invite sent', description: result.message });
      setManualEmail('');
      await Promise.all([loadUsers(), hasData ? loadCrossReference() : Promise.resolve()]);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: (err as Error).message });
    } finally {
      setAddingManual(false);
    }
  };

  const statusBadge = (status: UserStatus) => {
    switch (status) {
      case 'community':
        return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-0">Community</Badge>;
      case 'non-member':
        return <Badge variant="destructive">Non-Member</Badge>;
      case 'not-registered':
        return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100 border-0">Not Registered</Badge>;
      default:
        return <Badge variant="secondary">Free</Badge>;
    }
  };

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

  const tabs: { value: TabValue; label: string; count: number; color: string }[] = [
    { value: 'all', label: 'All', count: counts.all, color: '' },
    { value: 'community', label: 'Community', count: counts.community, color: 'bg-green-100 text-green-700' },
    { value: 'non-members', label: 'Non-Members', count: counts.nonMembers, color: 'bg-red-100 text-red-700' },
    { value: 'not-registered', label: 'Not Registered', count: counts.notRegistered, color: 'bg-yellow-100 text-yellow-700' },
  ];

  return (
    <div className="space-y-4">
      {/* Header + Upload + Add Member */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Community Members</h1>
          <p className="text-muted-foreground text-sm">Upload Skool CSV exports, manage access, and track community membership.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading || loadingUsers}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading || loadingUsers ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Upload + Add Member row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex items-center gap-2 flex-1">
          <Upload className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="block w-full max-w-xs text-sm text-muted-foreground
              file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0
              file:text-xs file:font-medium file:bg-primary file:text-primary-foreground
              hover:file:bg-primary/90 file:cursor-pointer"
          />
          <Button size="sm" onClick={handleFileUpload} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            type="email"
            placeholder="Add member by email..."
            value={manualEmail}
            onChange={e => setManualEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddMember()}
            className="h-8 w-56 text-sm"
          />
          <Button size="sm" onClick={handleAddMember} disabled={addingManual || !manualEmail.trim()}>
            {addingManual ? 'Adding...' : 'Add'}
          </Button>
        </div>
      </div>

      {/* Stats row */}
      {hasData && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm">
            <span className="text-muted-foreground">CSV:</span>
            <span className="font-semibold">{totalCsvMembers}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-50 dark:bg-green-950 text-sm">
            <span className="text-green-700 dark:text-green-300">Matched:</span>
            <span className="font-semibold text-green-700 dark:text-green-300">{activeMembers.length}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-50 dark:bg-red-950 text-sm">
            <span className="text-red-700 dark:text-red-300">Non-Members:</span>
            <span className="font-semibold text-red-700 dark:text-red-300">{nonMembers.length}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-yellow-50 dark:bg-yellow-950 text-sm">
            <span className="text-yellow-700 dark:text-yellow-300">Not Registered:</span>
            <span className="font-semibold text-yellow-700 dark:text-yellow-300">{notRegistered.length}</span>
          </div>
        </div>
      )}

      {/* No CSV banner */}
      {!hasData && !loading && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-md bg-muted/50 border border-dashed text-sm text-muted-foreground">
          <Upload className="h-4 w-4" />
          Upload a Skool CSV to see community membership breakdown.
        </div>
      )}

      {/* Tab bar + Search */}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 p-4 pb-0 sm:flex-row sm:items-center sm:justify-between">
            {/* Tabs */}
            <div className="flex items-center gap-1 flex-wrap">
              {tabs.map(tab => (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activeTab === tab.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  <span className={`inline-flex items-center justify-center min-w-[1.25rem] px-1 py-0.5 rounded text-xs font-semibold ${
                    activeTab === tab.value
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : tab.color || 'bg-muted text-muted-foreground'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Search + send invites (on not-registered tab) */}
            <div className="flex items-center gap-2">
              {activeTab === 'not-registered' && notRegistered.length > 0 && (
                <Button size="sm" variant="outline" onClick={handleSendAllInvites} disabled={sendingInvites}>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  {sendingInvites ? 'Sending...' : `Invite All (${notRegistered.length})`}
                </Button>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="h-8 w-48 pl-8 text-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loadingUsers && !allUsers.length ? (
              <div className="flex justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {searchQuery ? 'No users match your search.' : 'No users in this category.'}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      {activeTab !== 'not-registered' && selectableIds.length > 0 && (
                        <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                      )}
                    </TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user, idx) => (
                    <TableRow key={user.id || `nr-${idx}`} className="group">
                      <TableCell className="pl-4">
                        {user.id && user.is_admin !== 1 && (
                          <Checkbox
                            checked={selectedIds.has(user.id)}
                            onCheckedChange={() => toggleSelect(user.id!)}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                              {(user.name || user.email)[0]?.toUpperCase() || '?'}
                            </div>
                          )}
                          <span className="font-medium text-sm">
                            {user.name || 'N/A'}
                            {user.is_admin === 1 && (
                              <Badge variant="outline" className="ml-1.5 text-xs py-0 px-1">Admin</Badge>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell>{statusBadge(user.status)}</TableCell>
                      <TableCell className="text-sm">
                        {user.status === 'community' || user.status === 'not-registered'
                          ? <span className="text-green-600 font-medium">Unlimited</span>
                          : user.credits_used != null ? user.credits_used : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : user.joined_date || '-'}
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        {user.is_admin !== 1 && (
                          <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                            {user.status === 'not-registered' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7"
                                onClick={() => handleSendSingleInvite(user.email)}
                              >
                                <Send className="h-3 w-3 mr-1" />
                                Invite
                              </Button>
                            ) : (
                              <>
                                {(user.status === 'non-member' || user.status === 'unknown') && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7 text-green-600 hover:text-green-700"
                                    disabled={togglingId === user.id}
                                    onClick={() => handleToggleMember(user.id!, 'grant')}
                                  >
                                    <ShieldCheck className="h-3 w-3 mr-1" />
                                    Grant
                                  </Button>
                                )}
                                {user.status === 'community' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7 text-red-600 hover:text-red-700"
                                    disabled={togglingId === user.id}
                                    onClick={() => handleToggleMember(user.id!, 'revoke')}
                                  >
                                    <ShieldX className="h-3 w-3 mr-1" />
                                    Revoke
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs h-7 text-destructive hover:text-destructive"
                                  disabled={togglingId === user.id}
                                  onClick={() => handleDeleteUser(user.id!, user.email)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-background border rounded-lg shadow-lg px-5 py-3 flex items-center gap-3">
          <span className="text-sm font-medium whitespace-nowrap">{selectedIds.size} selected</span>
          <div className="h-4 w-px bg-border" />
          <Button size="sm" onClick={handleBulkGrant} disabled={bulkAction}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
            Grant
          </Button>
          <Button size="sm" variant="destructive" onClick={handleBulkRevoke} disabled={bulkAction}>
            <ShieldX className="h-3.5 w-3.5 mr-1.5" />
            Revoke
          </Button>
          <Button size="sm" variant="outline" onClick={handleBulkDelete} disabled={bulkAction}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete
          </Button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
