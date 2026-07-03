import { useState } from 'react';
import { Copy, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { generateSeoMeta, type Post } from '@/lib/content-writer';

function CharCount({ value, limit }: { value: string; limit: number }) {
  const over = value.length > limit;
  return (
    <span className={`text-[10px] tabular-nums ${over ? 'text-destructive' : 'text-muted-foreground'}`}>
      {value.length}/{limit}
    </span>
  );
}

export default function SeoMetaCard({ post, onGenerated, disabled }: {
  post: Post;
  onGenerated: () => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      await generateSeoMeta(post.id);
      onGenerated();
      toast({ title: 'Title and meta generated' });
    } catch (err) {
      toast({ title: 'Generation failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-3">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">SEO title and meta description</CardTitle>
        <Button variant="outline" size="sm" className="gap-1" onClick={run} disabled={disabled || busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {post.seo_title ? 'Regenerate' : 'Generate'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {post.seo_title ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium leading-snug">{post.seo_title}</p>
                <CharCount value={post.seo_title} limit={60} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => copy('Title', post.seo_title || '')}><Copy className="h-3 w-3" /></Button>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-muted-foreground leading-snug">{post.seo_meta_description}</p>
                <CharCount value={post.seo_meta_description || ''} limit={155} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => copy('Meta description', post.seo_meta_description || '')}><Copy className="h-3 w-3" /></Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Generate a title tag (60 characters, keyword plus benefit) and meta description (155 characters) from the draft.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
