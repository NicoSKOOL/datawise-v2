import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Globe } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// One-time "what's new" announcement for the multi-language content feature.
// Shows once per browser, then never again (dismissal writes the seen flag).
// Bump the version suffix to re-announce a future feature.
const SEEN_KEY = 'datawise_whatsnew_languages_v1';

const LANGUAGES = [
  'English (US)',
  'English (UK)',
  'Spanish (Spain)',
  'Spanish (Latin America)',
  'French',
  'German',
  'Italian',
  'Portuguese (Portugal)',
  'Portuguese (Brazil)',
  'Dutch',
  'Japanese',
];

export function AnnouncementDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      // storage disabled (private mode) — just don't show it
    }
  }, []);

  const markSeen = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {
      // best-effort
    }
  };

  const dismiss = () => {
    markSeen();
    setOpen(false);
  };

  const goToWriter = () => {
    markSeen();
    setOpen(false);
    navigate('/content-writer');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <span className="mx-auto inline-block rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-primary">
            New feature
          </span>
          <DialogTitle className="mt-2 text-2xl">Write your content in 10 languages</DialogTitle>
        </DialogHeader>

        <p className="text-center text-sm leading-relaxed text-muted-foreground">
          Pick an output language and DataWise writes natively in it, not a rough translation,
          while keeping your brand voice, structure, and citations intact.
        </p>

        <div className="my-1 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-4">
          {LANGUAGES.map((lang) => (
            <div key={lang} className="flex items-center gap-2 text-sm text-foreground">
              <Check className="h-4 w-4 shrink-0 text-primary" />
              <span>{lang}</span>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Available in Content Writer (set it at the Research step), Content Revival, the Meta
          rewriter, Content Planner, and the SEO Assistant chat. Regional variants like Spain vs.
          Latin American Spanish are handled properly.
        </p>

        <DialogFooter className="mt-2 sm:justify-center">
          <Button variant="ghost" onClick={dismiss}>Maybe later</Button>
          <Button onClick={goToWriter}>Try it in Content Writer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
