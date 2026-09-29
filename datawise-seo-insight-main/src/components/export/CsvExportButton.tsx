import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadCsv } from '@/lib/planner-export';

interface CsvExportButtonProps {
  /** Builds the file. May fetch more rows than the table shows. */
  build: () => Promise<{ filename: string; csv: string; rows: number }>;
  label?: string;
  disabled?: boolean;
}

export function CsvExportButton({ build, label = 'Export CSV', disabled }: CsvExportButtonProps) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const { filename, csv, rows } = await build();
      if (!rows) {
        toast.info('Nothing to export');
        return;
      }
      downloadCsv(filename, csv);
      toast.success(`Exported ${rows} ${rows === 1 ? 'row' : 'rows'}`);
    } catch (err) {
      toast.error('Export failed', { description: (err as Error)?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={run} disabled={disabled || busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}
