# DataForSEO Local SEO API Reference Guide

## Overview
This document provides a comprehensive reference for DataForSEO's API endpoints supporting local SEO operations. Each endpoint is mapped to specific use cases with full technical specifications, required parameters, and integration patterns compatible with the existing `workers/src/dataforseo/client.ts` architecture.

---

## 1. Local Pack & Local Finder SERP Results

### Endpoint: `/serp/google/local_finder/`
**Purpose**: Track Google Local Pack (3-pack) search results for location-based queries

**Full API Path**: `POST https://api.dataforseo.com/v3/serp/google/local_finder/`

**Use Cases**:
- Monitor keyword rankings in local 3-pack results
- Track competitor positions in local search results
- Identify local pack inclusion for service area keywords
- Monitor rating and review count changes in SERP
- Track business visibility across geographic regions

**Request Body Structure** (POST):
```json
{
  "keyword": "string (required)",
  "location_code": "integer (optional, e.g., 2840 for United States)",
  "language_code": "string (optional, e.g., 'en')",
  "device": "string (optional: 'mobile' | 'desktop')",
  "depth": "integer (optional, default: 10, max: 700)",
  "tag": "string (optional, custom identifier)",
  "priority": "integer (optional: -2 (low) to 2 (high))",
  "os": "string (optional: 'windows' | 'macos' | 'android' | 'ios')"
}
```

**Response Data Structure**:
```json
{
  "tasks": [
    {
      "result": [
        {
          "keyword": "string",
          "location_code": "integer",
          "se_results_count": "integer",
          "items": [
            {
              "rank_group": "integer",
              "rank_absolute": "integer",
              "position": "string",
              "title": "string",
              "business_name": "string",
              "phone": "string",
              "address": "string",
              "url": "string",
              "type": "string (local)",
              "rating": "number",
              "review_count": "integer",
              "hours": "object | string",
              "lat": "number",
              "lng": "number",
              "featured_snippet": "boolean",
              "description": "string"
            }
          ]
        }
      ]
    }
  ]
}
```

**Required Parameters**:
- `keyword` (string): The search query to track
- Location targeting (choose one):
  - `location_code`: DataForSEO location ID (e.g., 2840 for USA)
  - `latitude` + `longitude`: GPS coordinates for precise location targeting
  - `location_name`: City/region name

**Delivery Methods**:
- **Live** (real-time): Immediate results, higher cost (~0.05 credits)
- **Standard** (queued): Batch processing, lower cost (~0.02 credits), ~1-5 minute delay

**Location Targeting Capabilities**:
- Country level (location_code)
- City/region level (location_name)
- Exact GPS coordinates (latitude/longitude)
- ZIP code support (via location_code)

**Credit Cost**: ~0.02-0.05 per request (Standard vs Live)

**Integration Pattern** (using `dataforseoRequest()`):
```typescript
const endpoint = '/serp/google/local_finder/';
const body = [
  {
    keyword: 'plumbing services near me',
    location_code: 2840,
    language_code: 'en',
    device: 'mobile'
  }
];
const response = await dataforseoRequest(env, endpoint, body);
const items = extractItems(response); // Returns array of local pack results
```

---

## 2. Google Maps SERP Results

### Endpoint: `/serp/google/maps/`
**Purpose**: Retrieve and track Google Maps search results and map pack visibility

**Full API Path**: `POST https://api.dataforseo.com/v3/serp/google/maps/`

**Use Cases**:
- Monitor business rankings in Google Maps search results
- Track map pack visibility for location-based queries
- Monitor competitor map positions
- Track map review ratings and counts
- Identify map pack inclusion vs local finder only
- Monitor business information accuracy in Maps SERP

**Request Body Structure** (POST):
```json
{
  "keyword": "string (required)",
  "location_code": "integer (optional)",
  "language_code": "string (optional)",
  "device": "string (optional: 'mobile' | 'desktop')",
  "depth": "integer (optional, default: 10)",
  "tag": "string (optional)",
  "priority": "integer (optional: -2 to 2)",
  "zoom": "integer (optional, default: 13, range: 0-21)"
}
```

**Response Data Structure**:
```json
{
  "tasks": [
    {
      "result": [
        {
          "keyword": "string",
          "location_code": "integer",
          "items": [
            {
              "rank_group": "integer",
              "rank_absolute": "integer",
              "position": "string",
              "title": "string",
              "business_name": "string",
              "address": "string",
              "phone": "string",
              "type": "string (local)",
              "url": "string",
              "rating": "number",
              "review_count": "integer",
              "lat": "number",
              "lng": "number",
              "hours": "object",
              "description": "string",
              "website": "string"
            }
          ]
        }
      ]
    }
  ]
}
```

**Required Parameters**:
- `keyword` (string): Search query
- Location targeting (choose one):
  - `location_code`: DataForSEO location ID
  - `latitude` + `longitude`: GPS coordinates
  - `location_name`: City/region name

**Optional Parameters**:
- `zoom`: Map zoom level (0-21, default 13); higher zoom = tighter geographic radius
- `device`: Mobile vs desktop results
- `depth`: Number of results to retrieve (max 700)

**Delivery Methods**:
- **Live**: Real-time retrieval
- **Standard**: Queued batch processing

**Location Targeting Capabilities**:
- Precise GPS coordinates (latitude/longitude)
- City/region level (location_name)
- Country level (location_code)
- Zoom-based radius control for narrow/broad geographic coverage

**Credit Cost**: ~0.02-0.05 per request

**Integration Pattern** (using `dataforseoRequest()`):
```typescript
const endpoint = '/serp/google/maps/';
const body = [
  {
    keyword: 'restaurants downtown',
    latitude: 40.7128,
    longitude: -74.0060,
    language_code: 'en',
    zoom: 14
  }
];
const response = await dataforseoRequest(env, endpoint, body);
const items = extractItems(response); // Returns map pack results
```

---

## 3. Google Business Profile (GBP) / My Business Info

### Endpoint: `/business_data/google/my_business_info/`
**Purpose**: Retrieve and track Google Business Profile data including hours, categories, contact info, and metrics

**Full API Path**: `POST https://api.dataforseo.com/v3/business_data/google/my_business_info/`

**Use Cases**:
- Monitor business profile completeness and accuracy
- Track service category assignments and primary category
- Monitor business hours and special hours (holidays)
- Track contact information (phone, website, email)
- Monitor service area definitions
- Track GBP attribute changes (outdoor seating, delivery, etc.)
- Monitor profile completion score and recommendations

**Request Body Structure** (POST):
```json
{
  "business_name": "string (required for name-based lookup)",
  "location": "string (optional: city, state or full address)",
  "google_business_id": "string (optional: GBP ID for direct lookup)",
  "type": "string (optional: 'hotel' | 'restaurant' | etc.)"
}
```

**Response Data Structure**:
```json
{
  "tasks": [
    {
      "result": [
        {
          "business_name": "string",
          "business_id": "string",
          "address": "string",
          "phone": "string",
          "website": "string",
          "lat": "number",
          "lng": "number",
          "rating": "number",
          "review_count": "integer",
          "reviews_url": "string",
          "type": "string",
          "service_type": "string",
          "categories": ["string"],
          "primary_category": "string",
          "hours": {
            "monday": "string",
            "tuesday": "string",
            "wednesday": "string",
            "thursday": "string",
            "friday": "string",
            "saturday": "string",
            "sunday": "string"
          },
          "special_hours": [
            {
              "date": "string",
              "hours": "string"
            }
          ],
          "service_area": ["string"],
          "attributes": [
            {
              "name": "string",
              "value": "string | boolean"
            }
          ],
          "completion_percentage": "integer",
          "photos_count": "integer",
          "posts_count": "integer",
          "description": "string",
          "verified": "boolean",
          "certified": "boolean"
        }
      ]
    }
  ]
}
```

**Required Parameters** (at least one lookup method):
- `business_name` + `location`: Name-based lookup
- `google_business_id`: Direct GBP ID lookup (most accurate)

**Optional Parameters**:
- `type`: Business type for filtering (helps when multiple businesses share same name)

**Credit Cost**: ~0.01 per request

**Key GBP Data Fields**:
- **Profile Information**: Name, address, phone, website, description
- **Service Categories**: Primary and secondary service categories
- **Hours**: Regular operating hours + special hours for holidays
- **Service Areas**: Geographic regions where services are offered
- **Attributes**: Business features (outdoor seating, delivery, curbside, WiFi, etc.)
- **Ratings & Reviews**: Aggregate rating and total review count
- **Media**: Photos and posts counts
- **Verification**: Profile verification status and certification details
- **Completion**: Profile completeness score

**Integration Pattern** (using `dataforseoRequest()`):
```typescript
const endpoint = '/business_data/google/my_business_info/';
const body = [
  {
    business_name: 'Joe\'s Plumbing',
    location: 'San Francisco, CA'
  }
];
const response = await dataforseoRequest(env, endpoint, body);
const gbpData = extractResult(response); // Returns GBP profile data
```

---

## 4. Google Reviews

### Endpoint: `/business_data/google/reviews/`
**Purpose**: Retrieve and track Google review data with aggregation across platforms

**Full API Path**: `POST https://api.dataforseo.com/v3/business_data/google/reviews/`

**Use Cases**:
- Monitor review volume and rating trends
- Track review sentiment across platforms
- Monitor competitor review activity
- Identify low-rating review patterns
- Track review response metrics
- Monitor review highlights and common themes
- Identify review spike events

**Request Body Structure** (POST):
```json
{
  "business_name": "string (required for name-based lookup)",
  "location": "string (optional: city, state or full address)",
  "google_business_id": "string (optional: GBP ID for direct lookup)",
  "sort_by": "string (optional: 'most_recent' | 'rating_high' | 'rating_low' | 'most_helpful')",
  "depth": "integer (optional, default: 10, max: 100)"
}
```

**Response Data Structure**:
```json
{
  "tasks": [
    {
      "result": [
        {
          "business_name": "string",
          "business_id": "string",
          "rating": "number",
          "review_count": "integer",
          "reviews_distribution": {
            "1": "integer",
            "2": "integer",
            "3": "integer",
            "4": "integer",
            "5": "integer"
          },
          "review_highlights": [
            {
              "name": "string (e.g., 'Cleanliness')",
              "count": "integer"
            }
          ],
          "items": [
            {
              "reviewer_name": "string",
              "review_text": "string",
              "rating": "integer (1-5)",
              "review_datetime": "string (ISO 8601)",
              "helpful_count": "integer",
              "response_text": "string (business owner response)",
              "response_datetime": "string (ISO 8601)",
              "source": "string (google | trustpilot | tripadvisor | yelp)"
            }
          ]
        }
      ]
    }
  ]
}
```

**Required Parameters** (at least one lookup method):
- `business_name` + `location`: Name-based lookup
- `google_business_id`: Direct GBP ID lookup

**Optional Parameters**:
- `sort_by`: Review sort order (most_recent, rating_high, rating_low, most_helpful)
- `depth`: Number of reviews to retrieve (default 10, max 100)

**Multi-Platform Aggregation**:
- Google reviews (primary)
- Trustpilot integration
- Tripadvisor integration
- Yelp integration
- Source field indicates which platform each review originated from

**Credit Cost**: ~0.02 per request

**Key Review Metrics**:
- **Aggregate Rating**: Overall star rating (1-5)
- **Review Count**: Total review volume
- **Distribution**: Review count breakdown by star rating
- **Highlights**: Common themes/aspects mentioned in reviews (Cleanliness, Service, Value, etc.)
- **Individual Reviews**: Full review text, rating, date, reviewer name, helpful count
- **Response Metrics**: Business owner response presence and response date
- **Source Tracking**: Identifies which platform each review comes from

**Integration Pattern** (using `dataforseoRequest()`):
```typescript
const endpoint = '/business_data/google/reviews/';
const body = [
  {
    business_name: 'Joe\'s Plumbing',
    location: 'San Francisco, CA',
    sort_by: 'most_recent',
    depth: 50
  }
];
const response = await dataforseoRequest(env, endpoint, body);
const reviewData = extractResult(response); // Returns review aggregate data
const reviews = extractItems(response); // Returns individual review items
```

---

## 5. DataForSEO Labs Endpoints for Local Research & Competitor Discovery

### Endpoint: `/dataforseo_labs/google/keyword_ideas/`
**Purpose**: Generate keyword ideas with local intent detection for location-based research

**Full API Path**: `POST https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/`

**Use Cases**:
- Discover local keywords with geographic intent ("near me", city-specific queries)
- Identify service-location keyword variations
- Research seasonal local keyword demand
- Identify competitor keyword strategies
- Find long-tail local search opportunities
- Analyze keyword difficulty by location

**Request Body Structure** (POST):
```json
{
  "keyword": "string (required: seed keyword)",
  "location": "string (optional: target location for local intent detection)",
  "language": "string (optional: 'en' for English)",
  "search_intent": "string (optional: 'local' | 'commercial' | 'informational')"
}
```

**Response Data Structure**:
```json
{
  "tasks": [
    {
      "result": [
        {
          "keyword": "string",
          "location": "string",
          "search_volume": "integer (monthly)",
          "keyword_difficulty": "integer (0-100)",
          "cpc": "number (cost per click estimate)",
          "search_intent": "string (local | commercial | informational)",
          "competition": "number (0-1)",
          "local_intent_score": "number (0-1, indicates geographic specificity)"
        }
      ]
    }
  ]
}
```

**Required Parameters**:
- `keyword` (string): Seed keyword for idea generation

**Optional Parameters**:
- `location`: Target location for local intent analysis
- `search_intent`: Filter by intent type (local, commercial, informational)

**Credit Cost**: ~0.1-0.2 per request

**Local Research Insights**:
- **Local Intent Score**: 0-1 indicating how location-specific a keyword is
- **Search Volume**: Monthly search volume by location
- **Keyword Difficulty**: 0-100 scale indicating SERP difficulty
- **Search Intent Classification**: Identifies local vs commercial vs informational queries

**Integration Pattern** (using `dataforseoRequest()`):
```typescript
const endpoint = '/dataforseo_labs/google/keyword_ideas/';
const body = [
  {
    keyword: 'plumbing',
    location: 'San Francisco, CA',
    search_intent: 'local'
  }
];
const response = await dataforseoRequest(env, endpoint, body);
const keywordIdeas = extractItems(response); // Returns local keyword suggestions
```

---

### Endpoint: `/dataforseo_labs/google/competitor_keywords/`
**Purpose**: Identify competitor keywords and market gaps for local SEO strategies

**Full API Path**: `POST https://api.dataforseo.com/v3/dataforseo_labs/google/competitor_keywords/`

**Use Cases**:
- Identify competitor keyword strategies
- Find keyword gaps (keywords competitors rank for but you don't)
- Discover common keywords across local competitors
- Analyze local competitor dominance by keyword
- Identify unique competitor keyword opportunities
- Benchmark against local market leaders

**Request Body Structure** (POST):
```json
{
  "domain": "string (required: competitor domain)",
  "location": "string (optional: target location)",
  "limit": "integer (optional, default: 100, max: 10000)"
}
```

**Response Data Structure**:
```json
{
  "tasks": [
    {
      "result": [
        {
          "keyword": "string",
          "search_volume": "integer",
          "keyword_difficulty": "integer (0-100)",
          "cpc": "number",
          "position": "integer (competitor's SERP position)",
          "traffic_estimation": "integer (estimated monthly traffic)",
          "local_intent_score": "number (0-1)"
        }
      ]
    }
  ]
}
```

**Required Parameters**:
- `domain` (string): Competitor website domain

**Optional Parameters**:
- `location`: Geographic location for local keyword analysis
- `limit`: Number of keywords to return (default 100, max 10000)

**Credit Cost**: ~0.3-0.5 per request (higher due to data intensity)

**Competitor Intelligence**:
- **Keyword Coverage**: Keywords competitor ranks for
- **Position Data**: Competitor's current ranking position
- **Traffic Estimation**: Estimated monthly organic traffic per keyword
- **Local Intent Filtering**: Filter competitor keywords by local intent score
- **Gap Analysis**: Identify keywords where competitor ranks but you don't

**Integration Pattern** (using `dataforseoRequest()`):
```typescript
const endpoint = '/dataforseo_labs/google/competitor_keywords/';
const body = [
  {
    domain: 'competitor-plumbing.com',
    location: 'San Francisco, CA',
    limit: 500
  }
];
const response = await dataforseoRequest(env, endpoint, body);
const competitorKeywords = extractItems(response); // Returns competitor keyword data
```

---

## Integration with Existing DataForSEO Client

All endpoints follow the standardized pattern established in `workers/src/dataforseo/client.ts`:

```typescript
// Import client utilities
import { 
  dataforseoRequest, 
  extractResult, 
  extractItems 
} from '../dataforseo/client';

// Example: Local pack tracking with batch support
async function trackLocalPack(
  env: Env,
  keywords: string[],
  locationCode: number
): Promise<any[]> {
  const body = keywords.map(keyword => ({
    keyword,
    location_code: locationCode,
    device: 'mobile',
    depth: 10
  }));
  
  const response = await dataforseoRequest(
    env,
    '/serp/google/local_finder/',
    body
  );
  
  return extractItems(response);
}

// Example: GBP profile monitoring
async function getGBPProfile(
  env: Env,
  businessName: string,
  location: string
): Promise<any> {
  const response = await dataforseoRequest(
    env,
    '/business_data/google/my_business_info/',
    [{ business_name: businessName, location }]
  );
  
  return extractResult(response);
}

// Example: Review monitoring with multi-platform aggregation
async function getBusinessReviews(
  env: Env,
  businessName: string,
  location: string
): Promise<any> {
  const response = await dataforseoRequest(
    env,
    '/business_data/google/reviews/',
    [{
      business_name: businessName,
      location,
      sort_by: 'most_recent',
      depth: 50
    }]
  );
  
  return {
    aggregate: extractResult(response),
    reviews: extractItems(response)
  };
}
```

---

## Batch Request Optimization

All endpoints support batch requests in a single POST call:

```typescript
// Single request with multiple tasks (up to 100)
const body = [
  { keyword: 'plumbing near me', location_code: 2840 },
  { keyword: 'emergency plumbing', location_code: 2840 },
  { keyword: 'drain cleaning', location_code: 2840 }
  // Up to 100 tasks per request
];

const response = await dataforseoRequest(
  env,
  '/serp/google/local_finder/',
  body
);

// Results array contains response for each task in same order
const results = response.tasks.map(task => extractResult(task));
```

---

## Rate Limiting & Credit Management

- **Rate Limit**: Up to 2000 API calls per minute
- **Batch Limit**: Maximum 100 tasks per POST request
- **Credit Costs**:
  - Local Finder/Maps (Standard): ~0.02 credits
  - Local Finder/Maps (Live): ~0.05 credits
  - GBP Info: ~0.01 credits
  - Reviews: ~0.02 credits
  - Labs Keyword Ideas: ~0.1-0.2 credits
  - Labs Competitor Keywords: ~0.3-0.5 credits

---

## Location Targeting Summary

| Method | Precision | Use Case | Example |
|--------|-----------|----------|---------|
| `location_code` | Country/region | Broad market analysis | 2840 (USA) |
| `location_name` | City/region | City-level tracking | "San Francisco, CA" |
| `latitude` + `longitude` | Exact GPS | Precise local analysis | 40.7128, -74.0060 |
| `zoom` (Maps only) | Radius via zoom level | Map-based radius control | 14 (tight urban radius) |

---

## Next Steps for Implementation

1. **Local Pack Tracking Module**: Implement continuous monitoring of keyword rankings in Google Local Pack using `/serp/google/local_finder/` with batch requests for multiple keywords
2. **GBP Audit System**: Build profile completeness monitoring using `/business_data/google/my_business_info/` to identify data gaps and optimization opportunities
3. **Review Intelligence**: Integrate `/business_data/google/reviews/` for review volume tracking, sentiment analysis, and competitor review benchmarking
4. **Local Keyword Research**: Implement `/dataforseo_labs/google/keyword_ideas/` with local intent filtering for service-location keyword discovery
5. **Competitor Analysis**: Use `/dataforseo_labs/google/competitor_keywords/` for gap analysis and local market opportunity identification

