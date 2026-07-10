export interface ProductLimits {
  maxServices: number;
  maxServiceAreas: number;
  defaultMaxRecommendedPages: number;
  maxRecommendedPages: number;
  maxSeedQueries: number;
}

// V1 boundary from the handoff README: up to 10 services and 5 service areas.
export const V1_LIMITS: ProductLimits = {
  maxServices: 10,
  maxServiceAreas: 5,
  defaultMaxRecommendedPages: 30,
  maxRecommendedPages: 150,
  maxSeedQueries: 200, // one Keyword Ideas task accepts up to 200 seeds
};
