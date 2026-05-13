import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { exportReport, type ReportPayload, type ExportFormat } from '@/lib/export';

interface UseExportArgs {
  surface: string;
  buildPayload: () => ReportPayload | Promise<ReportPayload>;
  identifier?: string | (() => string | undefined);
}

export function useExport({ surface, buildPayload, identifier }: UseExportArgs) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const run = useCallback(
    async (format: ExportFormat) => {
      if (busy) return;
      setBusy(format);
      try {
        const payload = await buildPayload();
        const id =
          typeof identifier === 'function' ? identifier() : identifier;
        await exportReport(payload, format, { surface, identifier: id });
        toast({
          title: `${format.toUpperCase()} exported`,
          description: 'Your report has been downloaded.',
        });
      } catch (err) {
        console.error('[export] failed', err);
        toast({
          title: 'Export failed',
          description: err instanceof Error ? err.message : 'Unexpected error',
          variant: 'destructive',
        });
      } finally {
        setBusy(null);
      }
    },
    [busy, buildPayload, identifier, surface, toast]
  );

  return { run, busy };
}
