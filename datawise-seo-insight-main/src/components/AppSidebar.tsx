import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  MessageSquare,
  Search,
  Users,
  Eye,
  TrendingUp,
  FileText,
  ClipboardCheck,
  Link2,
  Map,
  Settings,
  LogOut,
  Shield,
  Bug,
  Ticket,
  ChevronRight,
  BarChart3,
  Activity,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProperty } from '@/contexts/PropertyContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { AddWebsiteDialog } from '@/components/AddWebsiteDialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { deleteManualProperty, type GSCProperty } from '@/lib/gsc';

interface SubItem {
  label: string;
  // Either a `tab` (legacy: appended as ?tab= on the parent's url) or a
  // dedicated `url` (sub-item is its own page). At least one must be set.
  tab?: string;
  url?: string;
}

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems?: SubItem[];
  // Additional path prefixes that should mark this item as active. Useful
  // for grouped nav items where the parent's url is a redirect to one of
  // the sub-items but the others still belong under the same expanded set.
  matchPrefixes?: string[];
}

const mainNavItems: NavItem[] = [
  {
    title: 'Dashboard',
    url: '/',
    icon: LayoutDashboard,
  },
  {
    title: 'SEO Assistant',
    url: '/seo-assistant',
    icon: MessageSquare,
  },
  {
    title: 'Keyword Research',
    url: '/keyword-research',
    icon: Search,
    subItems: [
      { label: 'Overview', tab: 'overview' },
      { label: 'Related', tab: 'related' },
      { label: 'Suggestions', tab: 'suggestions' },
      { label: 'Ideas', tab: 'ideas' },
      { label: 'Difficulty', tab: 'difficulty' },
      { label: 'People Also Ask', tab: 'people-also-ask' },
      { label: 'Fan-out Queries', tab: 'fan-out' },
    ],
  },
  {
    title: 'Competitor Analysis',
    url: '/competitor-analysis',
    icon: Users,
    subItems: [
      { label: 'Domain Rank', tab: 'domain-rank' },
      { label: 'Ranked Keywords', tab: 'ranked-keywords' },
      { label: 'Gap Analysis', tab: 'gap-analysis' },
      { label: 'Traffic', tab: 'traffic' },
      { label: 'Competitors', tab: 'competitors' },
    ],
  },
  {
    title: 'AI Visibility',
    url: '/ai-visibility',
    icon: Eye,
    subItems: [
      { label: 'Performance', tab: 'performance' },
      { label: 'Instant Check', tab: 'ai-overview' },
      { label: 'Brand Tracker', tab: 'brand-tracker' },
    ],
  },
  {
    title: 'Rank Tracking',
    url: '/rank-tracking',
    icon: TrendingUp,
    subItems: [
      { label: 'Site Rankings', tab: 'gsc' },
      { label: 'Tracked Keywords', tab: 'tracked' },
      { label: 'Local Pack', tab: 'local' },
    ],
  },
  {
    title: 'Site Audit',
    url: '/site-audit',
    icon: ClipboardCheck,
    subItems: [
      { label: 'Audits', tab: 'audits' },
      { label: 'Meta Checker', tab: 'meta-checker' },
    ],
  },
  {
    title: 'Backlinks',
    url: '/backlinks',
    icon: Link2,
  },
  // Content suite: planner → writer → tools mirrors the workflow (plan
  // keywords, write posts, refresh existing pages). Clicking the parent
  // lands on Planner; the parent stays expanded whenever any of the
  // three child pages is active so the user can hop between them.
  {
    title: 'Content',
    url: '/content-planner',
    icon: FileText,
    matchPrefixes: ['/content-planner', '/content-writer', '/content-tools'],
    subItems: [
      { label: 'Planner', url: '/content-planner' },
      { label: 'Writer', url: '/content-writer' },
      { label: 'Tools', url: '/content-tools' },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  {
    title: 'Settings',
    url: '/settings',
    icon: Settings,
  },
  {
    title: 'Roadmap',
    url: '/roadmap',
    icon: Map,
  },
];

const activeClass = 'bg-primary/10 text-primary font-medium border-l-[3px] border-primary rounded-l-none';
const inactiveClass = 'text-sidebar-foreground hover:bg-sidebar-accent/50';

function cleanDomain(siteUrl: string): string {
  return siteUrl.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/\/+$/, '');
}

function NavItemWithSubs({ item }: { item: NavItem }) {
  const location = useLocation();
  const navigate = useNavigate();
  // For grouped nav items the parent's url is just where a parent click
  // lands — other sub-items live at different prefixes. matchPrefixes lets
  // us mark the parent as active for any of those.
  const activePrefixes = item.matchPrefixes ?? [item.url];
  const isActive = item.url === '/'
    ? location.pathname === '/'
    : activePrefixes.some((p) => location.pathname.startsWith(p));
  const currentTab = new URLSearchParams(location.search).get('tab');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <NavLink
          to={item.url}
          end={item.url === '/'}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            isActive ? activeClass : inactiveClass
          }`}
        >
          <item.icon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{item.title}</span>
          {item.subItems && (
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isActive ? 'rotate-90' : ''}`} />
          )}
        </NavLink>
      </SidebarMenuButton>
      {item.subItems && isActive && (
        <div className="ml-7 mt-0.5 mb-1 space-y-0.5 border-l-2 border-border pl-3">
          {item.subItems.map((sub) => {
            // Sub-items can either point to a dedicated url (its own page)
            // or to a tab on the parent's page. The active check, target,
            // and key all branch on which mode the sub-item is using.
            const target = sub.url ?? `${item.url}?tab=${sub.tab}`;
            const isSubActive = sub.url
              ? location.pathname.startsWith(sub.url)
              : (!currentTab ? sub === item.subItems![0] : currentTab === sub.tab);
            return (
              <button
                key={sub.url ?? sub.tab ?? sub.label}
                onClick={() => navigate(target)}
                className={`block w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors ${
                  isSubActive
                    ? 'text-primary font-medium bg-primary/5'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {sub.label}
              </button>
            );
          })}
        </div>
      )}
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const { user, signOut, isAdmin } = useAuth();
  const { properties, selectedPropertyId, setSelectedPropertyId, removeProperty, selectedProperty } = useProperty();
  const [addWebsiteOpen, setAddWebsiteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<GSCProperty | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  async function performDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteManualProperty(confirmDelete.id);
      removeProperty(confirmDelete.id);
      qc.invalidateQueries({ queryKey: ['planner-keywords', confirmDelete.id] });
      qc.invalidateQueries({ queryKey: ['planner-clusters', confirmDelete.id] });
      toast({ title: 'Website removed', description: cleanDomain(confirmDelete.site_url) });
      setConfirmDelete(null);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to delete',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sidebar className="w-64 border-r">
      <SidebarContent className="pt-4">
        {/* Brand */}
        <div className="px-4 pb-4 mb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">DW</span>
            </div>
            <span className="text-lg font-semibold text-foreground">DataWise</span>
          </div>
        </div>

        {/* Property Selector */}
        <div className="px-4 pb-3 space-y-2">
          {properties.filter((p) => p.is_enabled !== 0).length > 0 && (
            <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
              <SelectTrigger className="h-9 text-sm">
                {/* Custom trigger content — bypasses SelectValue so the dropdown's
                    inline trash icon doesn't leak into the closed-state display. */}
                <span className="flex items-center gap-2 min-w-0">
                  {selectedProperty ? (
                    <>
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: selectedProperty.color || '#9ca3af' }}
                      />
                      <span className="truncate">{cleanDomain(selectedProperty.site_url)}</span>
                      {selectedProperty.kind === 'manual' && (
                        <span
                          title="Manually added (not connected to GSC)"
                          className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded bg-muted text-muted-foreground border flex-shrink-0"
                        >
                          M
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Select website</span>
                  )}
                </span>
              </SelectTrigger>
              <SelectContent>
                {properties
                  .filter((prop) => prop.is_enabled !== 0)
                  .sort((a, b) => cleanDomain(a.site_url).localeCompare(cleanDomain(b.site_url)))
                  .map((prop) => (
                  <SelectItem key={prop.id} value={prop.id}>
                    <span className="flex items-center gap-2 w-full">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: prop.color || '#9ca3af' }}
                      />
                      <span className="truncate">{cleanDomain(prop.site_url)}</span>
                      {prop.kind === 'manual' && (
                        <>
                          <span
                            title="Manually added (not connected to GSC)"
                            className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded bg-muted text-muted-foreground border flex-shrink-0 ml-auto"
                          >
                            M
                          </span>
                          <span
                            role="button"
                            aria-label={`Remove ${cleanDomain(prop.site_url)}`}
                            tabIndex={0}
                            className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors flex-shrink-0"
                            // Radix Select.Item activates on pointerUp; we have to suppress
                            // every event it listens on or the click also selects the property.
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              e.nativeEvent.stopImmediatePropagation();
                            }}
                            onPointerUp={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              e.nativeEvent.stopImmediatePropagation();
                              setConfirmDelete(prop);
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                e.preventDefault();
                                setConfirmDelete(prop);
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </span>
                        </>
                      )}
                    </span>
                  </SelectItem>
                ))}
                {/* The M badge's hover tooltip is undiscoverable; new users
                    asked what "the green dot and M" mean (bug ad5f9478). */}
                {properties.some((p) => p.is_enabled !== 0 && p.kind === 'manual') && (
                  <div className="border-t mt-1 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                    M = site added manually (no Search Console data). Dot = the site's color in charts.
                  </div>
                )}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs justify-start gap-1.5"
            onClick={() => setAddWebsiteOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add a website
          </Button>
        </div>
        <AddWebsiteDialog open={addWebsiteOpen} onOpenChange={setAddWebsiteOpen} />

        <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o && !deleting) setConfirmDelete(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this website?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDelete && (
                  <>
                    This will permanently delete <span className="font-mono">{cleanDomain(confirmDelete.site_url)}</span> along with all of its Content Planner keywords and clusters. Site Audit history (run by domain) is kept. This cannot be undone.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); performDelete(); }}
                disabled={deleting}
                className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5 px-2">
              {mainNavItems.map((item) => (
                <NavItemWithSubs key={item.title} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin Navigation */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-0.5 px-2">
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin/members"
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive ? activeClass : inactiveClass
                        }`
                      }
                    >
                      <Shield className="h-4 w-4 flex-shrink-0" />
                      <span>Members</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin/feedback"
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive ? activeClass : inactiveClass
                        }`
                      }
                    >
                      <Bug className="h-4 w-4 flex-shrink-0" />
                      <span>Feedback</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin/promo-codes"
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive ? activeClass : inactiveClass
                        }`
                      }
                    >
                      <Ticket className="h-4 w-4 flex-shrink-0" />
                      <span>Promo Codes</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin/analytics"
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive ? activeClass : inactiveClass
                        }`
                      }
                    >
                      <BarChart3 className="h-4 w-4 flex-shrink-0" />
                      <span>Analytics</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin/activity"
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive ? activeClass : inactiveClass
                        }`
                      }
                    >
                      <Activity className="h-4 w-4 flex-shrink-0" />
                      <span>Activity</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin/content-writer-prompts"
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive ? activeClass : inactiveClass
                        }`
                      }
                    >
                      <FileText className="h-4 w-4 flex-shrink-0" />
                      <span>Writer Prompts</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/blueprint"
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive ? activeClass : inactiveClass
                        }`
                      }
                    >
                      <Map className="h-4 w-4 flex-shrink-0" />
                      <span>Blueprint</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Bottom Navigation */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5 px-2">
              {bottomNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive ? activeClass : inactiveClass
                        }`
                      }
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t space-y-3">
        {user && (
          <div className="flex items-center gap-3">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <span className="text-xs font-medium">
                  {user.name?.charAt(0) || user.email.charAt(0)}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        )}
        <Button
          onClick={signOut}
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs text-muted-foreground"
        >
          <LogOut className="h-3 w-3 mr-2" />
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
