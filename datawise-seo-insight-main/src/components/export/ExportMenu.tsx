import { Download, FileText, FileType2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useExport } from './useExport';
import type { ReportPayload } from '@/lib/export';

interface ExportMenuProps {
  surface: string;
  buildPayload: () => ReportPayload | Promise<ReportPayload>;
  identifier?: string | (() => string | undefined);
  disabled?: boolean;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'default' | 'secondary' | 'ghost';
  label?: string;
}

export function ExportMenu({
  surface,
  buildPayload,
  identifier,
  disabled,
  size = 'sm',
  variant = 'outline',
  label = 'Export',
}: ExportMenuProps) {
  const { run, busy } = useExport({ surface, buildPayload, identifier });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled || busy !== null}>
          {busy ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {busy ? `Generating ${busy.toUpperCase()}…` : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => run('pdf')} disabled={busy !== null}>
          <FileType2 className="h-4 w-4 mr-2" />
          Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('docx')} disabled={busy !== null}>
          <FileText className="h-4 w-4 mr-2" />
          Export as DOCX
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
