import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

interface OutOfCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OutOfCreditsDialog({ open, onOpenChange }: OutOfCreditsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-yellow-500" />
            You've Used All 5 Free Tools!
          </DialogTitle>
          <DialogDescription>
            Thanks for trying out DataWise! Join the AI Ranking community on Skool for unlimited access to all tools.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-4">
          <Button asChild>
            <a
              href="https://www.skool.com/ai-ranking/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Join AI Ranking Community
            </a>
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
