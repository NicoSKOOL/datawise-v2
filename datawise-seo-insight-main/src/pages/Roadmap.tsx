import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Hammer, Sparkles, Lightbulb } from 'lucide-react';

interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  shipped_at: string | null;
  created_at: string;
}

interface RoadmapResponse {
  planned: RoadmapItem[];
  in_progress: RoadmapItem[];
  shipped: RoadmapItem[];
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Section({
  title,
  icon: Icon,
  accent,
  badgeClass,
  items,
  emptyMessage,
  showShippedDate,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  badgeClass: string;
  items: RoadmapItem[];
  emptyMessage: string;
  showShippedDate?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <Badge variant="secondary" className={`${badgeClass} ml-1`}>
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="flex flex-col">
              <CardContent className="p-4 space-y-2 flex-1">
                <h3 className="font-medium leading-snug">{item.title}</h3>
                {item.description && (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {item.description}
                  </p>
                )}
                {showShippedDate && item.shipped_at && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Shipped {formatDate(item.shipped_at)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Roadmap() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['roadmap'],
    queryFn: () => api<RoadmapResponse>('/api/roadmap'),
  });

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Roadmap</h1>
        <p className="text-muted-foreground max-w-2xl">
          What we're building next, what's in progress, and what's shipped. Most of these items come
          straight from your feedback. Have an idea? Use the spider button in the bottom right of
          any page to send it in.
        </p>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading roadmap...</div>
      )}
      {error && (
        <div className="text-sm text-destructive">
          Failed to load roadmap: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <Section
            title="In progress"
            icon={Hammer}
            accent="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
            badgeClass="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
            items={data.in_progress}
            emptyMessage="Nothing in progress right now. Check the planned list below."
          />
          <Section
            title="Planned"
            icon={Lightbulb}
            accent="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            badgeClass="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
            items={data.planned}
            emptyMessage="No planned items yet."
          />
          <Section
            title="Shipped"
            icon={CheckCircle2}
            accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            badgeClass="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300"
            items={data.shipped}
            emptyMessage="Recent releases will show up here."
            showShippedDate
          />
        </div>
      )}

      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground flex items-start gap-3">
        <Sparkles className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
        <div>
          <p className="font-medium text-foreground">Have an idea?</p>
          <p>
            Click the spider icon in the bottom-right of any page and choose &quot;Feature
            Request.&quot; Your suggestion will show up here as soon as we plan it.
          </p>
        </div>
      </div>
    </div>
  );
}
