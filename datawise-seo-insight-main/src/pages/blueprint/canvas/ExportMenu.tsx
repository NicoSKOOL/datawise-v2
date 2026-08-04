import { useState } from 'react';
import { Download, FileCode, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getSessionToken } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

type ExportFormat = 'html' | 'csv';

// Plain fetch (not the shared api() helper) because a successful response
// here is a file blob, not JSON, and the download needs the Bearer header
// that a bare <a href> can't carry.
async function downloadBlueprintExport(revisionId: string, format: ExportFormat): Promise<void> {
  const res = await fetch(
    `${import.meta.env.VITE_API_URL}/api/blueprint/v1/blueprint-revisions/${revisionId}/export?format=${format}`,
    { headers: { Authorization: `Bearer ${getSessionToken()}` }, credentials: 'omit' }
  );
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (format === 'html') {
    window.open(url, '_blank');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blueprint.csv';
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ExportMenu(props: { revisionId: string }) {
  const { revisionId } = props;
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  async function handleExport(format: ExportFormat) {
    setBusy(format);
    try {
      await downloadBlueprintExport(revisionId, format);
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not export the blueprint.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy !== null}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('html')} disabled={busy !== null}>
          <FileCode className="mr-2 h-4 w-4" />
          Export as HTML
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('csv')} disabled={busy !== null}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export as CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
