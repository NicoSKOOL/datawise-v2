import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, MessageSquare, AlertCircle, ExternalLink } from 'lucide-react';
import { fetchReviews, fetchReviewThemes } from '@/lib/local-seo';
import { getLLMConfig } from '@/lib/chat';
import type { ReviewsResponse, ReviewThemesResponse } from '@/types/local-seo';
import HeaderTiles from './reviews/HeaderTiles';
import RatingDistribution from './reviews/RatingDistribution';
import ThemesPanel from './reviews/ThemesPanel';
import ReviewFilters, { DEFAULT_FILTERS, type ReviewFilterState } from './reviews/ReviewFilters';
import ReviewList, { type IndexedReview } from './reviews/ReviewList';

interface ReviewsSectionProps {
  projectId: string;
  placeId: string | null;
  cid: string | null;
  businessName: string | null;
}

function buildGoogleReviewsUrl(placeId: string | null, businessName: string | null): string | null {
  if (placeId) return `https://search.google.com/local/reviews?placeid=${placeId}`;
  if (businessName) return `https://www.google.com/maps/search/${encodeURIComponent(businessName)}`;
  return null;
}

export default function ReviewsSection({ projectId, placeId, cid, businessName }: ReviewsSectionProps) {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themes, setThemes] = useState<ReviewThemesResponse | null>(null);
  const [themesLoading, setThemesLoading] = useState(false);
  const [themesError, setThemesError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReviewFilterState>({ ...DEFAULT_FILTERS });

  const loadThemes = useCallback(async (reviewsData: ReviewsResponse, force = false) => {
    const llmConfig = getLLMConfig();
    if (!llmConfig?.api_key) {
      setThemesError('Add your LLM API key in Settings to see review themes.');
      return;
    }
    setThemesLoading(true);
    setThemesError(null);
    try {
      const result = await fetchReviewThemes(projectId, {
        reviews: reviewsData.reviews.map(r => ({
          rating: r.rating, text: r.text, date: r.date, owner_response: r.owner_response,
        })),
        llm_config: llmConfig,
        force,
      });
      setThemes(result);
    } catch (err) {
      setThemes(null);
      setThemesError(err instanceof Error ? err.message : 'Theme analysis failed. Use Refresh themes to retry.');
    } finally {
      setThemesLoading(false);
    }
  }, [projectId]);

  const loadReviews = useCallback(async () => {
    if (!placeId && !cid && !businessName) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchReviews({
        place_id: placeId || undefined,
        cid: cid || undefined,
        business_name: businessName || undefined,
        depth: 100,
        sort_by: 'newest',
        project_id: projectId,
      });
      setData(result);
      // Themes hydrate after the report renders; never blocking.
      if (result.reviews.length > 0) loadThemes(result);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [placeId, cid, businessName, projectId, loadThemes]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const indexed: IndexedReview[] = useMemo(
    () => (data?.reviews || []).map((review, index) => ({ review, index })),
    [data]
  );

  const responseRate = data && data.reviews.length > 0
    ? Math.round((data.reviews.filter(r => r.owner_response).length / data.reviews.length) * 100)
    : 0;
  const unansweredLowStar = data
    ? data.reviews.filter(r => !r.owner_response && r.rating != null && r.rating <= 3).length
    : 0;

  const filteredReviews = useMemo(() => {
    let list = indexed;
    if (filters.rating === '5') list = list.filter(({ review }) => review.rating === 5);
    else if (filters.rating === '4') list = list.filter(({ review }) => review.rating === 4);
    else if (filters.rating === 'low') list = list.filter(({ review }) => review.rating != null && review.rating <= 3);

    if (filters.response === 'responded') list = list.filter(({ review }) => !!review.owner_response);
    else if (filters.response === 'unanswered') list = list.filter(({ review }) => !review.owner_response);

    if (filters.themeIndex != null && themes) {
      const theme = themes.themes[filters.themeIndex];
      if (theme) {
        const allowed = new Set(theme.review_indexes);
        list = list.filter(({ index }) => allowed.has(index));
      }
    }

    const sorted = [...list];
    if (filters.sort === 'newest') {
      sorted.sort((a, b) => (b.review.date || '').localeCompare(a.review.date || ''));
    } else if (filters.sort === 'oldest') {
      sorted.sort((a, b) => (a.review.date || '').localeCompare(b.review.date || ''));
    } else {
      sorted.sort((a, b) => (a.review.rating ?? 6) - (b.review.rating ?? 6));
    }
    return sorted;
  }, [indexed, filters, themes]);

  if (!placeId && !cid && !businessName) return null;

  const reviewsPageUrl = buildGoogleReviewsUrl(data?.place_id || placeId, businessName);
  const activeThemeName = filters.themeIndex != null && themes ? themes.themes[filters.themeIndex]?.theme ?? null : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Reviews
          </CardTitle>
          <div className="flex items-center gap-2">
            {reviewsPageUrl && (
              <a
                href={reviewsPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-[#005232] hover:underline font-medium"
              >
                View all on Google
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
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
            <HeaderTiles
              data={data}
              responseRate={responseRate}
              unansweredLowStar={unansweredLowStar}
              onUnansweredClick={() => setFilters({ ...filters, rating: 'low', response: 'unanswered' })}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RatingDistribution distribution={data.rating_distribution} />
              <ThemesPanel
                themes={themes}
                loading={themesLoading}
                error={themesError}
                activeThemeIndex={filters.themeIndex}
                onThemeClick={(i) => setFilters({ ...filters, themeIndex: filters.themeIndex === i ? null : i })}
                onRefresh={() => loadThemes(data, true)}
              />
            </div>

            <ReviewFilters filters={filters} activeThemeName={activeThemeName} onChange={setFilters} />

            {(filters.rating !== 'all' || filters.response !== 'all' || filters.themeIndex != null) && (
              <p className="text-xs text-muted-foreground">
                Showing {filteredReviews.length} of {data.reviews.length} reviews
              </p>
            )}

            <ReviewList reviews={filteredReviews} themes={themes?.themes ?? null} reviewsPageUrl={reviewsPageUrl} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
