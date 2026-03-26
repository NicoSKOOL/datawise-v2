import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Bug, Lightbulb, Trash2, Image } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface FeedbackReport {
  id: string;
  type: 'bug' | 'feature';
  title: string;
  description: string;
  severity: string;
  status: string;
  admin_notes: string | null;
  page_url: string | null;
  browser_info: string | null;
  screenshot_info: string | null;
  created_at: string;
  updated_at: string;
  user_email: string;
  user_name: string | null;
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  closed: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

const severityColors: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

export default function AdminFeedback() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedReport, setSelectedReport] = useState<FeedbackReport | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  const hasScreenshot = (report: FeedbackReport) =>
    report.screenshot_info?.startsWith('__has_screenshot__');

  // Fetch screenshot when a report with one is selected
  useEffect(() => {
    if (!selectedReport || !hasScreenshot(selectedReport)) {
      setScreenshotUrl(null);
      return;
    }
    let revoked = false;
    const token = localStorage.getItem('datawise_session_token');
    fetch(`${API_BASE}/api/feedback/screenshot/${selectedReport.id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.blob();
      })
      .then((blob) => {
        if (!revoked) setScreenshotUrl(URL.createObjectURL(blob));
      })
      .catch(() => setScreenshotUrl(null));
    return () => {
      revoked = true;
      setScreenshotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [selectedReport?.id]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-feedback', statusFilter, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const qs = params.toString();
      return api<{ reports: FeedbackReport[] }>(`/api/admin/feedback${qs ? `?${qs}` : ''}`);
    },
    enabled: isAdmin,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, admin_notes }: { id: string; status?: string; admin_notes?: string }) =>
      api(`/api/admin/feedback/${id}`, { method: 'PATCH', body: { status, admin_notes } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] });
      toast.success('Report updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/admin/feedback/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] });
      setSelectedReport(null);
      toast.success('Report deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Access denied</p>
      </div>
    );
  }

  const reports = data?.reports || [];

  const openDetail = (report: FeedbackReport) => {
    setSelectedReport(report);
    setAdminNotes(report.admin_notes || '');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Feedback Reports</h1>
        <p className="text-muted-foreground">Bug reports and feature requests from users</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="bug">Bugs</SelectItem>
            <SelectItem value="feature">Features</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto text-sm text-muted-foreground self-center">
          {reports.length} report{reports.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : reports.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No feedback reports yet</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="w-20">Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead className="w-24">Severity</TableHead>
                  <TableHead className="w-32">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow
                    key={report.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openDetail(report)}
                  >
                    <TableCell>
                      <Badge variant="secondary" className={statusColors[report.status] || ''}>
                        {report.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {report.type === 'bug' ? (
                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                          <Bug className="h-3.5 w-3.5" /> Bug
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                          <Lightbulb className="h-3.5 w-3.5" /> Feature
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium max-w-xs truncate">
                      <span className="flex items-center gap-1.5">
                        {report.title}
                        {hasScreenshot(report) && <Image className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
                      {report.user_name || report.user_email}
                    </TableCell>
                    <TableCell>
                      {report.type === 'bug' && (
                        <Badge variant="secondary" className={severityColors[report.severity] || ''}>
                          {report.severity}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(report.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {selectedReport && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selectedReport.type === 'bug' ? (
                    <Bug className="h-5 w-5 text-red-500" />
                  ) : (
                    <Lightbulb className="h-5 w-5 text-purple-500" />
                  )}
                  {selectedReport.title}
                </SheetTitle>
                <SheetDescription>
                  From {selectedReport.user_name || selectedReport.user_email} on{' '}
                  {new Date(selectedReport.created_at).toLocaleString()}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                {/* Status + Severity */}
                <div className="flex gap-3">
                  <div className="space-y-1.5 flex-1">
                    <label className="text-sm font-medium">Status</label>
                    <Select
                      value={selectedReport.status}
                      onValueChange={(val) => {
                        updateMutation.mutate({ id: selectedReport.id, status: val });
                        setSelectedReport({ ...selectedReport, status: val });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedReport.type === 'bug' && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Severity</label>
                      <Badge variant="secondary" className={`${severityColors[selectedReport.severity]} block text-center py-1.5`}>
                        {selectedReport.severity}
                      </Badge>
                    </div>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Description</label>
                  <div className="rounded-md border p-3 text-sm whitespace-pre-wrap bg-muted/30">
                    {selectedReport.description}
                  </div>
                </div>

                {/* Screenshot */}
                {hasScreenshot(selectedReport) && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Screenshot</label>
                    {screenshotUrl ? (
                      <a href={screenshotUrl} target="_blank" rel="noopener noreferrer">
                        <img
                          src={screenshotUrl}
                          alt="Bug screenshot"
                          className="w-full rounded-md border object-contain max-h-80 cursor-zoom-in"
                        />
                      </a>
                    ) : (
                      <div className="flex items-center justify-center rounded-md border p-4 text-sm text-muted-foreground">
                        Loading screenshot...
                      </div>
                    )}
                  </div>
                )}

                {/* Additional context text */}
                {selectedReport.screenshot_info && !hasScreenshot(selectedReport) && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Additional Context</label>
                    <div className="rounded-md border p-3 text-sm whitespace-pre-wrap bg-muted/30">
                      {selectedReport.screenshot_info}
                    </div>
                  </div>
                )}

                {/* Page URL */}
                {selectedReport.page_url && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Page URL</label>
                    <p className="text-sm text-muted-foreground break-all">{selectedReport.page_url}</p>
                  </div>
                )}

                {/* Browser info */}
                {selectedReport.browser_info && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Browser</label>
                    <p className="text-xs text-muted-foreground break-all">{selectedReport.browser_info}</p>
                  </div>
                )}

                {/* Admin notes */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Admin Notes</label>
                  <Textarea
                    rows={3}
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Add internal notes about this report..."
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      updateMutation.mutate({ id: selectedReport.id, admin_notes: adminNotes });
                      setSelectedReport({ ...selectedReport, admin_notes: adminNotes });
                    }}
                    disabled={updateMutation.isPending}
                  >
                    Save Notes
                  </Button>
                </div>

                {/* Delete */}
                <div className="pt-4 border-t">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (confirm('Delete this report? This cannot be undone.')) {
                        deleteMutation.mutate(selectedReport.id);
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete Report
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
