import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Star, MapPin, Phone, Globe, Clock, CheckCircle, XCircle, HelpCircle } from 'lucide-react';
import { fetchGBPProfile } from '@/lib/local-seo';
import type { GBPProfile } from '@/types/local-seo';

interface GBPProfileCardProps {
  placeId: string | null;
  businessName: string | null;
  locationCode?: number;
}

function CompletenessScore({ profile }: { profile: GBPProfile }) {
  // 'unknown' means the API couldn't determine the value (null) - don't penalize
  const checks: Array<{ label: string; status: 'ok' | 'missing' | 'unknown'; fix: string }> = [
    {
      label: 'Description',
      status: profile.description && profile.description !== profile.address ? 'ok' : 'missing',
      fix: 'Add a 750-character business description with your primary keywords and services. Include your city/neighborhood to boost local relevance.',
    },
    {
      label: 'Phone',
      status: profile.phone ? 'ok' : 'missing',
      fix: 'Add a local phone number (not toll-free). Google prioritizes local area codes for local pack rankings.',
    },
    {
      label: 'Website',
      status: profile.url ? 'ok' : 'missing',
      fix: 'Link your website. Use a location-specific landing page (e.g. /melbourne) rather than your homepage for stronger local signals.',
    },
    {
      label: 'Hours',
      status: profile.work_time ? 'ok' : 'missing',
      fix: 'Set your business hours including special hours for holidays. Profiles with hours get more engagement and rank higher in "open now" searches.',
    },
    {
      label: 'Photos',
      status: (profile.total_photos ?? 0) > 0 ? 'ok' : 'missing',
      fix: 'Upload at least 10 high-quality photos (exterior, interior, products, team). Businesses with 100+ photos get 520% more calls than average.',
    },
    {
      label: 'Claimed',
      status: profile.is_claimed === true ? 'ok' : profile.is_claimed === false ? 'missing' : 'unknown',
      fix: 'Claim and verify your listing at business.google.com. Unclaimed profiles cannot be optimized and are vulnerable to competitor edits.',
    },
  ];

  const verifiable = checks.filter(c => c.status !== 'unknown');
  const score = verifiable.filter(c => c.status === 'ok').length;
  const pct = verifiable.length > 0 ? Math.round((score / verifiable.length) * 100) : 100;
  const missing = checks.filter(c => c.status === 'missing');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground uppercase tracking-wider">Profile Completeness</span>
        <span className={`font-bold ${pct === 100 ? 'text-green-600' : pct >= 66 ? 'text-yellow-600' : 'text-red-600'}`}>{pct}%</span>
      </div>
      <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : pct >= 66 ? 'bg-yellow-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-1">
        {checks.map(({ label, status }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs">
            {status === 'ok'
              ? <CheckCircle className="h-3 w-3 text-green-500" />
              : status === 'unknown'
                ? <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
                : <XCircle className="h-3 w-3 text-red-400" />
            }
            <span className={status === 'ok' ? 'text-foreground' : status === 'unknown' ? 'text-muted-foreground/60' : 'text-muted-foreground'}>
              {label}{status === 'unknown' ? ' (unverified)' : ''}
            </span>
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recommendations</p>
          {missing.map(({ label, fix }) => (
            <div key={label} className="flex gap-2 text-xs">
              <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">{label}:</span>{' '}
                <span className="text-muted-foreground">{fix}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GBPProfileCard({ placeId, businessName, locationCode }: GBPProfileCardProps) {
  const [profile, setProfile] = useState<GBPProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async () => {
    if (!placeId && !businessName) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGBPProfile({
        place_id: placeId || undefined,
        business_name: businessName || undefined,
        location_code: locationCode,
      });
      setProfile(data);
    } catch (err) {
      setProfile(null);
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (placeId || businessName) loadProfile();
  }, [placeId, businessName]);

  if (!placeId && !businessName) return null;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Google Business Profile</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex items-start gap-2 text-sm text-red-600">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No profile data available.</p>
          )}
          <Button variant="outline" size="sm" className="mt-2" onClick={loadProfile}>
            {error ? 'Retry' : 'Load Profile'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{profile.title}</CardTitle>
            {profile.category && (
              <Badge variant="secondary" className="mt-1">{profile.category}</Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadProfile}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rating */}
        {profile.rating != null && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
              <span className="text-2xl font-bold">{profile.rating}</span>
            </div>
            <span className="text-sm text-muted-foreground">
              ({profile.reviews_count?.toLocaleString() ?? 0} reviews)
            </span>
          </div>
        )}

        {/* Rating Distribution */}
        {profile.rating_distribution && (
          <div className="space-y-1">
            {[5, 4, 3, 2, 1].map((stars) => {
              const count = profile.rating_distribution?.[stars] ?? 0;
              const total = profile.reviews_count || 1;
              const pct = Math.round((count / total) * 100);
              return (
                <div key={stars} className="flex items-center gap-2 text-xs">
                  <span className="w-3 text-right">{stars}</span>
                  <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                  <div className="flex-1 bg-muted h-1.5 rounded-full overflow-hidden">
                    <div className="bg-yellow-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right text-muted-foreground">{pct}%</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Details */}
        <div className="space-y-2 text-sm">
          {profile.address && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <span>{profile.address}</span>
            </div>
          )}
          {profile.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{profile.phone}</span>
            </div>
          )}
          {profile.url && (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <a href={profile.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                {profile.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </a>
            </div>
          )}
        </div>

        {/* Completeness */}
        <CompletenessScore profile={profile} />
      </CardContent>
    </Card>
  );
}
