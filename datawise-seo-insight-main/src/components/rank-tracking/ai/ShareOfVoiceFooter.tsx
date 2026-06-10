import { Fragment, useState } from 'react';
import type { AIShareOfVoiceRow } from '@/lib/ai-tracking';

export default function ShareOfVoiceFooter({ share, domain }: { share: AIShareOfVoiceRow[]; domain: string }) {
  const [open, setOpen] = useState(false);
  if (!share.length) return null;

  const youIndex = share.findIndex(row => row.is_you);
  const top = share.slice(0, 5);
  if (youIndex >= 5) top.push(share[youIndex]);
  const max = Math.max(...share.map(row => row.citations), 1);

  return (
    <div className="border-t pt-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-bold text-foreground">Most-cited domains across your queries:</span>{' '}
          {top.map((row, i) => (
            <Fragment key={row.domain}>
              {i > 0 && <span> &middot; </span>}
              {row.is_you ? (
                <span className="font-bold text-[#005232]">
                  {row.domain} ({row.citations}, #{share.indexOf(row) + 1} of {share.length})
                </span>
              ) : (
                <span>{row.domain} ({row.citations})</span>
              )}
            </Fragment>
          ))}
        </p>
        <button type="button" className="text-xs font-semibold text-[#005232] whitespace-nowrap" onClick={() => setOpen(v => !v)}>
          {open ? 'Hide leaderboard' : 'Full leaderboard'}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-1.5">
          {share.map(row => (
            <div key={row.domain} className="flex items-center gap-3 text-sm">
              <span className={`w-48 truncate ${row.is_you ? 'font-bold text-[#005232]' : ''}`} title={row.domain}>
                {row.domain}{row.is_you ? ' (you)' : ''}
              </span>
              <div className="flex-1 h-2.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full ${row.is_you ? 'bg-[#005232]' : 'bg-muted-foreground/30'}`}
                  style={{ width: `${Math.max(4, Math.round((row.citations / max) * 100))}%` }}
                />
              </div>
              <span className="w-20 text-right text-xs text-muted-foreground">
                {row.citations} citation{row.citations === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
