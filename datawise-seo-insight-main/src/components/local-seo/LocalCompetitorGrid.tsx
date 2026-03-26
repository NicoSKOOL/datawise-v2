import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Search, Star, MapPin } from 'lucide-react';
import { fetchLocalCompetitors } from '@/lib/local-seo';
import type { LocalCompetitor } from '@/types/local-seo';

interface LocalCompetitorGridProps {
  defaultKeyword?: string;
  locationCode?: number;
  businessPlaceId?: string | null;
}

export default function LocalCompetitorGrid({ defaultKeyword = '', locationCode = 2840, businessPlaceId }: LocalCompetitorGridProps) {
  const [keyword, setKeyword] = useState(defaultKeyword);
  const [competitors, setCompetitors] = useState<LocalCompetitor[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    try {
      const data = await fetchLocalCompetitors({
        keyword: keyword.trim(),
        location_code: locationCode,
      });
      setCompetitors(data.competitors);
      setSearched(true);
    } catch {
      setCompetitors([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Local Competitor Grid
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Enter a keyword (e.g., plumber near me)"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <Button onClick={handleSearch} disabled={loading || !keyword.trim()}>
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {loading && (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && searched && competitors.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No local results found for this keyword.
          </p>
        )}

        {!loading && competitors.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="text-left py-2 px-3 font-medium">#</th>
                  <th className="text-left py-2 px-3 font-medium">Business</th>
                  <th className="text-center py-2 px-3 font-medium">Rating</th>
                  <th className="text-center py-2 px-3 font-medium">Reviews</th>
                  <th className="text-left py-2 px-3 font-medium">Category</th>
                  <th className="text-left py-2 px-3 font-medium">Phone</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((comp) => {
                  const isYou = businessPlaceId && comp.place_id === businessPlaceId;
                  return (
                    <tr
                      key={comp.place_id || comp.position}
                      className={`border-b last:border-b-0 ${isYou ? 'bg-primary/5 font-medium' : 'hover:bg-muted/50'}`}
                    >
                      <td className="py-2.5 px-3 text-sm tabular-nums">{comp.position}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{comp.title}</span>
                          {isYou && <Badge className="text-[10px] px-1.5 py-0">You</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate max-w-[250px]">{comp.address}</p>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {comp.rating != null ? (
                          <div className="flex items-center justify-center gap-1 text-sm">
                            <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                            {comp.rating}
                          </div>
                        ) : '--'}
                      </td>
                      <td className="py-2.5 px-3 text-center text-sm tabular-nums">
                        {comp.reviews_count ?? '--'}
                      </td>
                      <td className="py-2.5 px-3 text-sm text-muted-foreground">
                        {comp.category || '--'}
                      </td>
                      <td className="py-2.5 px-3 text-sm text-muted-foreground">
                        {comp.phone || '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
