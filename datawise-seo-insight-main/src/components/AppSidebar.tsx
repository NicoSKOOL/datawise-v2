import {
  LayoutDashboard,
  MessageSquare,
  Search,
  Users,
  Eye,
  TrendingUp,
  FileText,
  CheckSquare,
  Settings,
  LogOut,
  Shield,
  Bug,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProperty } from '@/contexts/PropertyContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

const mainNavItems = [
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
  },
  {
    title: 'Competitor Analysis',
    url: '/competitor-analysis',
    icon: Users,
  },
  {
    title: 'AI Visibility',
    url: '/ai-visibility',
    icon: Eye,
  },
  {
    title: 'Rank Tracking',
    url: '/rank-tracking',
    icon: TrendingUp,
  },
  {
    title: 'Content Tools',
    url: '/content-tools',
    icon: FileText,
  },
  {
    title: 'Tasks',
    url: '/tasks',
    icon: CheckSquare,
  },
];

const bottomNavItems = [
  {
    title: 'Settings',
    url: '/settings',
    icon: Settings,
  },
];

function cleanDomain(siteUrl: string): string {
  return siteUrl.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/\/+$/, '');
}

export function AppSidebar() {
  const { user, signOut, isAdmin } = useAuth();
  const { properties, selectedPropertyId, setSelectedPropertyId } = useProperty();

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
        {properties.filter((p) => p.is_enabled !== 0).length > 0 && (
          <div className="px-4 pb-3">
            <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select website" />
              </SelectTrigger>
              <SelectContent>
                {properties
                  .filter((prop) => prop.is_enabled !== 0)
                  .map((prop) => (
                  <SelectItem key={prop.id} value={prop.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: prop.color || '#9ca3af' }}
                      />
                      {cleanDomain(prop.site_url)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5 px-2">
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
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
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
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
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                        }`
                      }
                    >
                      <Bug className="h-4 w-4 flex-shrink-0" />
                      <span>Feedback</span>
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
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
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
