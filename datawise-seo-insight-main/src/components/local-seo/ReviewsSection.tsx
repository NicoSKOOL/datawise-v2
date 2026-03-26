import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Star, MessageSquare, AlertCircle, ExternalLink } from 'lucide-react';
import { fetchReviews } from '@/lib/local-seo';
import type { ReviewItem, ReviewsResponse } from '@/types/local-seo';

interface ReviewsSectionProps {
  placeId: string | null;
  cid: string | null;
  businessName: string | null;
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-200'}`}
        />
      ))}
    </div>
  );
}

function buildGoogleReviewsUrl(placeId: string | null, businessName: string | null): string | null {
  if (placeId) return `https://search.google.com/local/reviews?placeid=${placeId}`;
  if (businessName) return `https://www.google.com/maps/search/${encodeURIComponent(businessName)}`;
  return null;
}

function ReviewCard({ review, reviewsPageUrl }: { review: ReviewItem; reviewsPageUrl: string | null }) {
  const needsResponse = !review.owner_response && (review.rating != null && review.rating <= 3);
  const reviewLink = review.review_url || reviewsPageUrl;

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{review.author}</span>
          {review.is_local_guide && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Local Guide</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StarRating rating={review.rating} />
          {reviewLink && (
            <a
              href={reviewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors"
              title="View on Google"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {review.date && (
        <p className="text-xs text-muted-foreground">
          {new Date(review.date).toLocaleDateString()}
        </p>
      )}

      {review.text && (
        <p className="text-sm text-foreground">{review.text}</p>
      )}

      {review.owner_response && (
        <div className="bg-muted rounded-md p-3 mt-2">
          <p className="text-xs font-medium text-muted-foreground mb-1">Owner Response</p>
          <p className="text-sm">{review.owner_response}</p>
        </div>
      )}

      {needsResponse && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-amber-600">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>Needs response</span>
          </div>
          {reviewLink && (
            <a
              href={reviewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline font-medium"
            >
              Reply on Google
            </a>
          )}
        </div>
      )}
    </div>
  );
}

type ResponseFilter = 'all' | 'responded' | 'not_responded';
type StarFilter = 'all' | '5' | '4' | '3' | '2' | '1';

export default function ReviewsSection({ placeId, cid, businessName }: ReviewsSectionProps) {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('newest');
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all');
  const [starFilter, setStarFilter] = useState<StarFilter>('all');

  const loadReviews = async () => {
    if (!placeId && !cid && !businessName) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchReviews({
        place_id: placeId || undefined,
        cid: cid || undefined,
        business_name: businessName || undefined,
        depth: 20,
        sort_by: sortBy,
      });
      setData(result);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReviews();
  }, [placeId, cid, businessName, sortBy]);

  const filteredReviews = useMemo(() => {
    if (!data) return [];
    let reviews = data.reviews;

    if (responseFilter === 'responded') {
      reviews = reviews.filter(r => !!r.owner_response);
    } else if (responseFilter === 'not_responded') {
      reviews = reviews.filter(r => !r.owner_response);
    }

    if (starFilter !== 'all') {
      const starVal = parseInt(starFilter, 10);
      reviews = reviews.filter(r => r.rating === starVal);
    }

    return reviews;
  }, [data, responseFilter, starFilter]);

  if (!placeId && !cid && !businessName) return null;

  const responseRate = data
    ? Math.round((data.reviews.filter(r => r.owner_response).length / Math.max(data.reviews.length, 1)) * 100)
    : 0;

  const reviewsPageUrl = buildGoogleReviewsUrl(data?.place_id || placeId, businessName);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Reviews
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="highest_rating">Highest</SelectItem>
                <SelectItem value="lowest_rating">Lowest</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadReviews}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <div className="text-center py-4">
            {error ? (
              <div className="flex items-center justify-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No review data available.</p>
            )}
            <Button variant="outline" size="sm" className="mt-2" onClick={loadReviews}>
              {error ? 'Retry' : 'Load Reviews'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-4 pb-4 border-b">
              <div>
                <p className="text-xs text-muted-foreground">Overall Rating</p>
                <div className="flex items-center gap-1 mt-1">
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  <span className="text-lg font-bold">{data.rating ?? '--'}</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Reviews</p>
                <p className="text-lg font-bold mt-1">{data.reviews_count}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Response Rate</p>
                <p className="text-lg font-bold mt-1">{responseRate}%</p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <span className="text-xs font-medium text-muted-foreground">Filter:</span>
              <Select value={responseFilter} onValueChange={(v) => setResponseFilter(v as ResponseFilter)}>
                <SelectTrigger className="h-7 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Responses</SelectItem>
                  <SelectItem value="responded">Responded</SelectItem>
                  <SelectItem value="not_responded">Not Responded</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1">
                {(['all', '5', '4', '3', '2', '1'] as StarFilter[]).map((val) => (
                  <button
                    key={val}
                    onClick={() => setStarFilter(val)}
                    className={`flex items-center gap-0.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                      starFilter === val
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                    }`}
                  >
                    {val === 'all' ? 'All' : (
                      <>
                        {val}
                        <Star className="h-2.5 w-2.5 fill-current" />
                      </>
                    )}
                  </button>
                ))}
              </div>

              {reviewsPageUrl && (
                <a
                  href={reviewsPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                >
                  View All on Google
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {/* Filtered count */}
            {(responseFilter !== 'all' || starFilter !== 'all') && (
              <p className="text-xs text-muted-foreground">
                Showing {filteredReviews.length} of {data.reviews.length} reviews
              </p>
            )}

            {/* Review list */}
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {filteredReviews.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No reviews match the current filters.</p>
              ) : (
                filteredReviews.map((review, i) => (
                  <ReviewCard key={i} review={review} reviewsPageUrl={reviewsPageUrl} />
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
