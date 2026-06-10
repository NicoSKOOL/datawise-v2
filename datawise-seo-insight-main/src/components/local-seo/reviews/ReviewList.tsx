import { Badge } from '@/components/ui/badge';
import { Star, AlertCircle, ExternalLink } from 'lucide-react';
import type { ReviewItem, ReviewTheme } from '@/types/local-seo';

export interface IndexedReview {
  review: ReviewItem;
  index: number; // original index in the fetched array, matches theme review_indexes
}

interface ReviewListProps {
  reviews: IndexedReview[];
  themes: ReviewTheme[] | null;
  reviewsPageUrl: string | null;
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-200'}`} />
      ))}
    </div>
  );
}

// Severity left border: red 1 star, orange 2, amber 3.
function severityBorder(rating: number | null): string {
  if (rating == null) return '';
  if (rating <= 1) return 'border-l-4 border-l-red-500';
  if (rating <= 2) return 'border-l-4 border-l-orange-500';
  if (rating <= 3) return 'border-l-4 border-l-amber-500';
  return '';
}

function relativeDate(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`;
}

export default function ReviewList({ reviews, themes, reviewsPageUrl }: ReviewListProps) {
  if (reviews.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No reviews match the current filters.</p>;
  }

  const themeLabelsFor = (index: number): string[] =>
    (themes || []).filter(t => t.review_indexes.includes(index)).map(t => t.theme);

  return (
    <div className="space-y-3 max-h-[600px] overflow-y-auto">
      {reviews.map(({ review, index }) => {
        const needsResponse = !review.owner_response && review.rating != null && review.rating <= 3;
        const reviewLink = review.review_url || reviewsPageUrl;
        const labels = themeLabelsFor(index);

        return (
          <div key={index} className={`border rounded-lg p-4 space-y-2 bg-white ${severityBorder(review.rating)}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{review.author}</span>
                {review.is_local_guide && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Local Guide</Badge>
                )}
                {review.date && <span className="text-xs text-muted-foreground">{relativeDate(review.date)}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StarRating rating={review.rating} />
                {reviewLink && (
                  <a
                    href={reviewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-[#005232] transition-colors"
                    title="View on Google"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>

            {review.text && <p className="text-sm text-foreground">{review.text}</p>}

            {labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {labels.map((label) => (
                  <span key={label} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#005232]/10 text-[#005232]">
                    {label}
                  </span>
                ))}
              </div>
            )}

            {review.owner_response && (
              <div className="bg-muted rounded-md p-3 mt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Owner response</p>
                <p className="text-sm">{review.owner_response}</p>
              </div>
            )}

            {needsResponse && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Needs response</span>
                </div>
                {reviewLink && (
                  <a
                    href={reviewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#005232] hover:underline font-medium"
                  >
                    Reply on Google
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
