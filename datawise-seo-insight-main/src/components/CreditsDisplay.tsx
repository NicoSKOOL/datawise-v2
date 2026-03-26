import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';

export function CreditsDisplay() {
  const { isPro, isCommunityMember, creditsRemaining, creditsLimit } = useAuth();

  if (isCommunityMember || isPro) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Unlimited</span>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1.5">
      <Sparkles className="h-3.5 w-3.5" />
      <span>{creditsRemaining}/{creditsLimit} credits</span>
    </Badge>
  );
}
