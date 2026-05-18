import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowRight, Globe } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useProperty } from '@/contexts/PropertyContext';
import { createManualProperty } from '@/lib/gsc';

function normalizeDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

// Tier 0: no website on the account yet. One field, framed as the value
// unlock. Creates a manual property, which immediately moves the user forward.
export default function AddWebsiteCard() {
  const { addProperty } = useProperty();
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const domain = normalizeDomain(value);
    if (!domain || !domain.includes('.')) {
      toast({ title: 'Enter a valid website', description: 'For example: yourbusiness.com', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const result = await createManualProperty(`https://${domain}`);
      addProperty(result.property);
      toast({
        title: 'Website added',
        description: result.connectedViaGsc
          ? 'We found this site in your Search Console too.'
          : 'Connect Search Console next to unlock your full command center.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      toast({ title: 'Could not add website', description: message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Globe className="h-5 w-5" />
        </div>
        <CardTitle className="text-lg">Add your website</CardTitle>
        <CardDescription>
          See your rankings, traffic and quick wins. Start by telling us which site you work on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="text"
            inputMode="url"
            placeholder="yourbusiness.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
            className="sm:max-w-sm"
            aria-label="Your website domain"
          />
          <Button type="submit" disabled={submitting} className="gap-1.5">
            {submitting ? 'Adding...' : 'Continue'}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
