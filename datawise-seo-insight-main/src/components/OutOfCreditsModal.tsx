import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink, Sparkles } from 'lucide-react';

interface OutOfCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OutOfCreditsModal({ open, onOpenChange }: OutOfCreditsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <DialogTitle className="text-2xl">You've Used All 5 Free Tools!</DialogTitle>
          </div>
          <DialogDescription className="text-base space-y-4 pt-2">
            <p>
              Great job exploring our SEO tools! You've completed your free trial.
            </p>
            <p className="font-semibold text-foreground">
              Join the AI Ranking Community on Skool for unlimited access to all tools.
            </p>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-4">
          <Button 
            size="lg"
            className="w-full"
            onClick={() => window.open('https://www.skool.com/ai-ranking', '_blank')}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Join AI Ranking Community
          </Button>
          <Button 
            variant="outline" 
            size="lg"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
