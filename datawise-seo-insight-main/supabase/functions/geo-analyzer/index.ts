import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeoAnalysisRequest {
  url: string;
  businessName?: string;
  targetLocation?: string;
  primaryService?: string;
}

interface ElementScore {
  id: number;
  name: string;
  category: string;
  score: number;
  maxScore: number;
  status: "critical" | "important" | "optimize" | "excellent";
  finding: string;
  recommendation: string;
  example: string;
  impact: string;
}

interface CategoryScore {
  score: number;
  max: number;
  percentage: number;
}

interface SchemaAnalysis {
  present: boolean;
  complete: boolean;
  missing: string[];
}

interface ExtractedSchemas {
  jsonLd: any[];
  types: string[];
  html: string;
}

// Extract JSON-LD schemas directly from HTML and return the HTML for further analysis
async function extractJsonLdSchemas(url: string): Promise<ExtractedSchemas> {
  try {
    console.log(`[GEO Analyzer] Fetching HTML for schema extraction: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GEO-Analyzer/1.0; +https://lovable.dev)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    
    if (!response.ok) {
      console.log(`[GEO Analyzer] Failed to fetch HTML: ${response.status}`);
      return { jsonLd: [], types: [], html: '' };
    }
    
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    if (!doc) {
      console.log(`[GEO Analyzer] Failed to parse HTML`);
      return { jsonLd: [], types: [], html };
    }
    
    const schemas: any[] = [];
    const types: string[] = [];
    
    // Extract JSON-LD from <script type="application/ld+json"> tags
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    console.log(`[GEO Analyzer] Found ${jsonLdScripts.length} JSON-LD scripts`);
    
    for (const script of Array.from(jsonLdScripts)) {
      try {
        const content = (script as any).textContent?.trim();
        if (content) {
          const data = JSON.parse(content);
          schemas.push(data);
          
          // Extract types from @graph array or direct @type
          if (data['@graph'] && Array.isArray(data['@graph'])) {
            for (const item of data['@graph']) {
              if (item['@type']) {
                const itemTypes = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
                types.push(...itemTypes);
              }
            }
          } else if (data['@type']) {
            const dataTypes = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
            types.push(...dataTypes);
          }
        }
      } catch (e) {
        console.log('[GEO Analyzer] Error parsing JSON-LD:', e);
      }
    }
    
    const uniqueTypes = [...new Set(types)];
    console.log(`[GEO Analyzer] Extracted schema types: ${uniqueTypes.join(', ')}`);
    
    return { jsonLd: schemas, types: uniqueTypes, html };
  } catch (error) {
    console.error('[GEO Analyzer] Error fetching HTML for schemas:', error);
    return { jsonLd: [], types: [], html: '' };
  }
}

// Find schema item by type in JSON-LD data
function findSchemaByType(schemas: any[], targetTypes: string[]): any {
  for (const schema of schemas) {
    // Check @graph array
    if (schema['@graph'] && Array.isArray(schema['@graph'])) {
      for (const item of schema['@graph']) {
        const itemType = item['@type'];
        const itemTypes = Array.isArray(itemType) ? itemType : [itemType];
        if (itemTypes.some(t => targetTypes.some(target => 
          t?.toLowerCase().includes(target.toLowerCase())
        ))) {
          return item;
        }
      }
    }
    // Check direct @type
    const schemaType = schema['@type'];
    const schemaTypes = Array.isArray(schemaType) ? schemaType : [schemaType];
    if (schemaTypes.some(t => targetTypes.some(target => 
      t?.toLowerCase().includes(target.toLowerCase())
    ))) {
      return schema;
    }
  }
  return null;
}

// Find aggregateRating in any schema
function findAggregateRating(schemas: any[]): any {
  for (const schema of schemas) {
    // Check @graph array
    if (schema['@graph'] && Array.isArray(schema['@graph'])) {
      for (const item of schema['@graph']) {
        if (item.aggregateRating) {
          return item.aggregateRating;
        }
        if (item['@type']?.toLowerCase().includes('aggregaterating')) {
          return item;
        }
      }
    }
    // Check direct aggregateRating property
    if (schema.aggregateRating) {
      return schema.aggregateRating;
    }
    if (schema['@type']?.toLowerCase().includes('aggregaterating')) {
      return schema;
    }
  }
  return null;
}

// Pattern detection for template titles
function detectTemplateTitle(title: string, targetLocation?: string): { score: number; finding: string } {
  if (!title) return { score: 0, finding: "No title tag found" };
  
  const templatePatterns = [
    /^[\w\s]+ (?:in|for|near) [\w\s,]+$/i,
    /^[\w\s]+ - [\w\s,]+$/,
    /^[\w\s]+ \| [\w\s]+$/,
    /^[\w\s]+ Services? (?:in|for) [\w\s]+$/i,
  ];
  
  const isTemplate = templatePatterns.some(p => p.test(title));
  
  // Check for neighborhood/specialty mentions (better)
  const neighborhoodPatterns = /(?:downtown|north|south|east|west|midtown|uptown|bay|heights|village|park|hill)/i;
  const hasNeighborhood = neighborhoodPatterns.test(title);
  
  // Check for specialty mentions
  const specialtyPatterns = /(?:emergency|24\/7|same[- ]day|certified|licensed|expert|specialist|brownstone|commercial|residential)/i;
  const hasSpecialty = specialtyPatterns.test(title);
  
  if (isTemplate && !hasNeighborhood && !hasSpecialty) {
    return { 
      score: 3, 
      finding: `Template pattern detected: "${title}"` 
    };
  } else if (hasNeighborhood || hasSpecialty) {
    return { 
      score: 8, 
      finding: `Unique title with ${hasNeighborhood ? 'neighborhood' : 'specialty'} mention: "${title}"` 
    };
  } else if (title.length > 30 && title.length < 60) {
    return { 
      score: 6, 
      finding: `Semi-unique title: "${title}"` 
    };
  }
  
  return { score: 5, finding: `Basic title: "${title}"` };
}

// H1 analysis
function analyzeH1(h1Tags: string[], title: string): { score: number; finding: string } {
  if (!h1Tags || h1Tags.length === 0) {
    return { score: 0, finding: "No H1 heading found" };
  }
  
  const h1 = h1Tags[0];
  
  // Check if H1 is same as title
  if (h1.toLowerCase().trim() === title?.toLowerCase().trim()) {
    return { score: 3, finding: "H1 is identical to title tag - missing opportunity for keyword variation" };
  }
  
  // Check for template patterns
  const templatePatterns = [
    /^[\w\s]+ (?:in|for) [\w\s]+$/i,
    /^(?:best|top|professional) [\w\s]+ (?:in|for|near) [\w\s]+$/i,
  ];
  
  const isTemplate = templatePatterns.some(p => p.test(h1));
  
  if (isTemplate) {
    return { score: 4, finding: `H1 uses template pattern: "${h1}"` };
  }
  
  // Check for local specifics
  const hasLocalDetail = /(?:street|avenue|ave|blvd|road|rd|neighborhood|district|area|community)/i.test(h1);
  
  if (hasLocalDetail) {
    return { score: 9, finding: `H1 includes local details: "${h1}"` };
  }
  
  return { score: 6, finding: `H1 is differentiated from title: "${h1}"` };
}

// Intro paragraph analysis for local references
function analyzeIntroContent(content: string, targetLocation?: string): { score: number; finding: string } {
  if (!content || content.length < 100) {
    return { score: 0, finding: "Insufficient intro content found" };
  }
  
  const intro = content.substring(0, 1500); // First ~200-300 words
  
  // Look for specific local signals
  const streetPatterns = /\d+\s+(?:[\w]+\s+)?(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|place|pl)\b/gi;
  const streets = intro.match(streetPatterns) || [];
  
  const landmarkPatterns = /(?:near|by|across from|next to)\s+(?:the\s+)?[\w\s]+(?:park|station|center|mall|hospital|school|university|church|museum)/gi;
  const landmarks = intro.match(landmarkPatterns) || [];
  
  const neighborhoodPatterns = /(?:downtown|midtown|uptown|north|south|east|west|central)\s+[\w]+|[\w]+\s+(?:heights|hills|park|village|district|neighborhood)/gi;
  const neighborhoods = intro.match(neighborhoodPatterns) || [];
  
  const totalLocalRefs = streets.length + landmarks.length + neighborhoods.length;
  
  if (totalLocalRefs >= 3) {
    return { 
      score: 9, 
      finding: `Strong local signals: ${streets.length} street refs, ${landmarks.length} landmarks, ${neighborhoods.length} neighborhoods` 
    };
  } else if (totalLocalRefs >= 1) {
    return { 
      score: 6, 
      finding: `Some local signals found: ${totalLocalRefs} local references in intro` 
    };
  } else if (targetLocation && intro.toLowerCase().includes(targetLocation.toLowerCase())) {
    return { 
      score: 4, 
      finding: "Only city name mentioned, no specific local details" 
    };
  }
  
  return { score: 2, finding: "No local references found in intro content" };
}

// Content uniqueness estimation
function analyzeContentUniqueness(wordCount: number, content: string): { score: number; finding: string } {
  if (!wordCount || wordCount < 100) {
    return { score: 2, finding: `Very thin content: only ${wordCount || 0} words` };
  }
  
  // Check for boilerplate patterns
  const boilerplatePatterns = [
    /we (are|have been) serving/gi,
    /call us today/gi,
    /contact us (for|to)/gi,
    /years of experience/gi,
    /trusted (by|in)/gi,
    /professional (services?|team)/gi,
  ];
  
  let boilerplateCount = 0;
  boilerplatePatterns.forEach(p => {
    const matches = content.match(p);
    if (matches) boilerplateCount += matches.length;
  });
  
  const boilerplateRatio = boilerplateCount / (wordCount / 100);
  
  if (wordCount >= 800 && boilerplateRatio < 0.5) {
    return { score: 9, finding: `Strong unique content: ${wordCount} words with low boilerplate` };
  } else if (wordCount >= 500 && boilerplateRatio < 1) {
    return { score: 7, finding: `Good content depth: ${wordCount} words` };
  } else if (wordCount >= 300) {
    return { score: 5, finding: `Moderate content: ${wordCount} words` };
  }
  
  return { score: 3, finding: `Thin content: ${wordCount} words with potential boilerplate` };
}

// Team member/expert detection
function detectTeamMember(content: string): { score: number; finding: string } {
  // Look for patterns indicating named team members
  const namePatterns = [
    /(?:meet|about)\s+(?:dr\.?|mr\.?|ms\.?|mrs\.?)?\s*[A-Z][a-z]+\s+[A-Z][a-z]+/gi,
    /(?:owner|founder|ceo|manager|technician|specialist|expert)\s*[:\-]?\s*[A-Z][a-z]+\s+[A-Z][a-z]+/gi,
    /[A-Z][a-z]+\s+[A-Z][a-z]+,?\s+(?:licensed|certified|master|lead|senior)/gi,
  ];
  
  let foundNames: string[] = [];
  namePatterns.forEach(p => {
    const matches = content.match(p);
    if (matches) foundNames.push(...matches);
  });
  
  // Check for credentials
  const credentialPatterns = /(?:licensed|certified|insured|bonded|master\s+\w+|journeyman|\d+\+?\s+years)/gi;
  const credentials = content.match(credentialPatterns) || [];
  
  // Check for local credentials
  const localCredentials = /(?:state|city|county|[A-Z]{2})\s+licen[sc]ed/gi;
  const hasLocalCreds = localCredentials.test(content);
  
  if (foundNames.length > 0 && hasLocalCreds) {
    return { score: 9, finding: `Named expert with local credentials: ${foundNames[0]}` };
  } else if (foundNames.length > 0 && credentials.length > 0) {
    return { score: 7, finding: `Named team member with credentials found` };
  } else if (credentials.length > 0) {
    return { score: 5, finding: `Credentials mentioned but no named individuals` };
  }
  
  return { score: 2, finding: "No team members or experts identified on page" };
}

// Testimonial analysis - improved to detect section headings and common patterns
function analyzeTestimonials(content: string, html?: string): { score: number; finding: string } {
  // First, check for testimonial/review section indicators in both content and HTML
  const sectionPatterns = [
    /what\s+(?:our\s+)?customers?\s+say/gi,
    /customer\s+(?:reviews?|testimonials?|feedback)/gi,
    /(?:reviews?|testimonials?)\s+from\s+(?:our\s+)?(?:customers?|clients?)/gi,
    /hear\s+from\s+(?:our\s+)?(?:customers?|clients?)/gi,
    /(?:client|customer)\s+(?:stories|experiences)/gi,
    /what\s+(?:people|others)\s+(?:are\s+)?say(?:ing)?/gi,
    /trusted\s+by/gi,
    /happy\s+customers?/gi,
  ];
  
  const combinedContent = html ? `${content} ${html}` : content;
  let hasTestimonialSection = sectionPatterns.some(p => p.test(combinedContent));
  
  // Check for testimonial widget/carousel classes in HTML
  if (html) {
    const widgetPatterns = [
      /class="[^"]*(?:testimonial|review|feedback)[^"]*"/gi,
      /class="[^"]*(?:carousel|slider)[^"]*"/gi,
      /data-widget_type="[^"]*(?:testimonial|review)[^"]*"/gi,
      /id="[^"]*(?:testimonial|review)[^"]*"/gi,
    ];
    if (widgetPatterns.some(p => p.test(html))) {
      hasTestimonialSection = true;
    }
  }
  
  // Look for review/testimonial patterns
  const reviewPatterns = [
    /"[^"]{20,}"/g, // Quoted text
    /★+|⭐+/g, // Star ratings
    /\d\.?\d?\s*(?:out of|\/)\s*5/gi, // X out of 5 ratings
    /'[^']{30,}'/g, // Single-quoted text (alternative quote style)
  ];
  
  let hasQuotes = false;
  let hasRatings = false;
  
  reviewPatterns.forEach((p, i) => {
    if (combinedContent.match(p)) {
      if (i === 0 || i === 3) hasQuotes = true;
      else hasRatings = true;
    }
  });
  
  // Check for full names vs initials
  const fullNamePattern = /[A-Z][a-z]+\s+[A-Z][a-z]{2,}/g;
  const initialPattern = /[A-Z][a-z]+\s+[A-Z]\./g;
  
  const fullNames = combinedContent.match(fullNamePattern) || [];
  const initials = combinedContent.match(initialPattern) || [];
  
  // Check for location mentions in reviews
  const locationInReview = /(?:from|in|resident of)\s+[\w\s]+(?:street|neighborhood|area|city)/gi;
  const hasLocationInReview = locationInReview.test(combinedContent);
  
  // Check for dates
  const datePatterns = /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/gi;
  const hasDates = datePatterns.test(combinedContent);
  
  // Strong testimonials with full details
  if (hasTestimonialSection && hasQuotes && fullNames.length > 2 && hasLocationInReview && hasDates) {
    return { score: 9, finding: `Strong testimonials: Section found with full names, locations and dates` };
  } else if (hasTestimonialSection && hasQuotes && fullNames.length > 0) {
    return { score: 7, finding: `Testimonials section found with customer quotes and names` };
  } else if (hasTestimonialSection && (hasQuotes || hasRatings)) {
    return { score: 6, finding: `Testimonials section found with reviews/ratings present` };
  } else if (hasTestimonialSection) {
    return { score: 5, finding: `Testimonial section detected (e.g., "What Our Customers Say")` };
  } else if (hasQuotes && fullNames.length > 0) {
    return { score: 5, finding: `Testimonials with full names but missing section heading` };
  } else if (hasQuotes && initials.length > 0) {
    return { score: 4, finding: `Reviews found but using initials only (e.g., "John D.")` };
  } else if (hasRatings) {
    return { score: 3, finding: `Only star ratings displayed, no actual testimonial content` };
  }
  
  return { score: 1, finding: "No testimonials or reviews detected on page" };
}

// Case study detection
function detectCaseStudies(content: string): { score: number; finding: string } {
  // Look for project/case study patterns
  const casePatterns = [
    /(?:project|case study|recent work|completed|job)[\s\S]{0,50}(?:\d+\s*(?:square|sq\.?)\s*(?:feet|ft)|bathroom|kitchen|basement|roof|hvac)/gi,
    /(?:before|after)\s+(?:and|&)\s+(?:before|after)/gi,
    /project\s+(?:gallery|portfolio|showcase)/gi,
  ];
  
  let hasCaseStudies = false;
  casePatterns.forEach(p => {
    if (p.test(content)) hasCaseStudies = true;
  });
  
  // Look for specific addresses
  const addressPattern = /\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr)/gi;
  const addresses = content.match(addressPattern) || [];
  
  // Look for metrics
  const metricsPattern = /(?:saved|reduced|increased|improved)\s+(?:by\s+)?\$?\d+[%\w]*/gi;
  const metrics = content.match(metricsPattern) || [];
  
  if (hasCaseStudies && addresses.length > 0 && metrics.length > 0) {
    return { score: 9, finding: `Detailed case studies with specific addresses and metrics` };
  } else if (hasCaseStudies && (addresses.length > 0 || metrics.length > 0)) {
    return { score: 6, finding: `Case studies found with some specific details` };
  } else if (hasCaseStudies) {
    return { score: 4, finding: `Generic project mentions without specific details` };
  }
  
  return { score: 1, finding: "No case studies or project examples found" };
}

// Service area details analysis
function analyzeServiceArea(content: string): { score: number; finding: string } {
  // Generic patterns (bad)
  const genericPatterns = [
    /and\s+surrounding\s+areas?/gi,
    /and\s+nearby\s+(?:cities|areas|towns)/gi,
    /greater\s+[\w]+\s+area/gi,
  ];
  
  const isGeneric = genericPatterns.some(p => p.test(content));
  
  // Look for specific streets
  const streetPattern = /(?:street|st|avenue|ave|boulevard|blvd|road|rd|highway|hwy)\b/gi;
  const streets = content.match(streetPattern) || [];
  
  // Look for landmarks
  const landmarkPattern = /(?:near|by|close to)\s+(?:the\s+)?[\w\s]+(?:park|station|mall|hospital|school|university|museum|center)/gi;
  const landmarks = content.match(landmarkPattern) || [];
  
  // Look for transit
  const transitPattern = /(?:subway|metro|bus|train|station|line|route)\s+[\w\d]+/gi;
  const transit = content.match(transitPattern) || [];
  
  // Look for zip codes
  const zipPattern = /\b\d{5}(?:-\d{4})?\b/g;
  const zips = content.match(zipPattern) || [];
  
  // Look for neighborhoods
  const neighborhoodList = content.match(/(?:neighborhoods?|areas?)\s*(?:we serve|include|:)\s*[\w\s,]+/gi) || [];
  
  const specificity = streets.length + landmarks.length + transit.length + zips.length;
  
  if (specificity >= 5 && neighborhoodList.length > 0) {
    return { 
      score: 9, 
      finding: `Highly specific service area: ${streets.length} streets, ${landmarks.length} landmarks, ${zips.length} zip codes` 
    };
  } else if (specificity >= 2) {
    return { score: 6, finding: `Moderate service area detail with some specific locations` };
  } else if (neighborhoodList.length > 0 && !isGeneric) {
    return { score: 5, finding: `Neighborhoods listed but lacking specific street/landmark details` };
  } else if (isGeneric) {
    return { score: 2, finding: `Generic "and surrounding areas" language used` };
  }
  
  return { score: 3, finding: "Limited service area information on page" };
}

// Hero CTA detection
function detectHeroCTA(content: string): { score: number; finding: string } {
  // Look for CTA patterns early in content
  const introContent = content.substring(0, 3000); // First viewport-ish
  
  const strongCTAPatterns = [
    /(?:call|contact|schedule|book|get)\s+(?:us\s+)?(?:now|today|free)/gi,
    /(?:free\s+)?(?:quote|estimate|consultation|assessment)/gi,
    /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, // Phone number
  ];
  
  let ctaCount = 0;
  let hasPhone = false;
  
  strongCTAPatterns.forEach((p, i) => {
    const matches = introContent.match(p);
    if (matches) {
      ctaCount += matches.length;
      if (i === 2) hasPhone = true;
    }
  });
  
  // Check for button-like text patterns
  const buttonPatterns = /(?:get started|request|call now|book now|schedule|contact us)/gi;
  const buttons = introContent.match(buttonPatterns) || [];
  
  if (hasPhone && buttons.length >= 2 && ctaCount >= 4) {
    return { score: 9, finding: `Strong hero CTAs: Phone number and ${buttons.length} action buttons` };
  } else if (hasPhone && buttons.length >= 1) {
    return { score: 7, finding: `Good CTA presence: Phone and action button in hero area` };
  } else if (hasPhone || buttons.length >= 1) {
    return { score: 5, finding: `Basic CTA present but could be more prominent` };
  }
  
  return { score: 2, finding: "No clear call-to-action found in hero section" };
}

// Pricing information detection
function detectPricing(content: string): { score: number; finding: string } {
  // Look for price patterns
  const pricePatterns = [
    /\$\d+(?:,\d{3})*(?:\.\d{2})?/g, // $XXX or $X,XXX.XX
    /(?:starting|from|as low as)\s+(?:at\s+)?\$?\d+/gi,
    /\$\d+\s*[-–]\s*\$\d+/g, // Price ranges $X - $Y
    /(?:per|\/)\s*(?:hour|hr|visit|job|project)/gi,
  ];
  
  let priceMatches: string[] = [];
  let hasRange = false;
  let hasUnit = false;
  
  pricePatterns.forEach((p, i) => {
    const matches = content.match(p);
    if (matches) {
      priceMatches.push(...matches);
      if (i === 2) hasRange = true;
      if (i === 3) hasUnit = true;
    }
  });
  
  // Check for "call for quote" patterns (less good)
  const callForQuote = /(?:call|contact)\s+(?:us\s+)?for\s+(?:a\s+)?(?:quote|estimate|pricing)/gi;
  const hasCallForQuote = callForQuote.test(content);
  
  if (priceMatches.length >= 3 && (hasRange || hasUnit)) {
    return { 
      score: 9, 
      finding: `Transparent pricing: ${priceMatches.length} price points with ${hasRange ? 'ranges' : 'units'}` 
    };
  } else if (priceMatches.length >= 1) {
    return { score: 6, finding: `Some pricing shown: ${priceMatches[0]}` };
  } else if (hasCallForQuote) {
    return { score: 4, finding: `"Call for quote" language but no specific pricing` };
  }
  
  return { score: 2, finding: "No pricing information found on page" };
}

// FAQ detection - improved to detect section headings and accordion elements
function detectFAQ(content: string, html?: string): { score: number; finding: string } {
  const combinedContent = html ? `${content} ${html}` : content;
  
  // Look for FAQ section patterns (including variations like "FAQ's", "FAQs", etc.)
  const faqSectionPatterns = [
    /frequently\s+asked\s+questions/gi,
    /\bfaqs?\b/gi,
    /\bfaq['']?s?\b/gi,  // Matches FAQ, FAQs, FAQ's with various apostrophes
    /common\s+questions/gi,
    /questions\s+(?:and|&)\s+answers/gi,
    /q\s*(?:&|and)\s*a\b/gi,
    /have\s+questions\?/gi,
  ];
  
  let hasFAQSection = faqSectionPatterns.some(p => p.test(combinedContent));
  
  // Check for accordion/expandable elements commonly used for FAQs in HTML
  let hasAccordion = false;
  if (html) {
    const accordionPatterns = [
      /class="[^"]*accordion[^"]*"/gi,
      /class="[^"]*(?:faq|expandable|collapsible)[^"]*"/gi,
      /data-widget_type="[^"]*accordion[^"]*"/gi,
      /elementor-accordion/gi,
      /class="[^"]*toggle[^"]*item/gi,
    ];
    hasAccordion = accordionPatterns.some(p => p.test(html));
  }
  
  // Count question patterns - look for questions in various formats
  const questionPatterns = [
    /\?[\s\S]{10,300}(?:\n|<|$)/g, // Questions followed by answers
    /<[^>]*class="[^"]*(?:question|faq-title|accordion-title)[^"]*"[^>]*>([^<]+)/gi, // Question elements
    /(?:how|what|why|when|where|can|do|does|is|are|will|should)\s+[^?.!]{10,80}\?/gi, // Natural questions
  ];
  
  let questionCount = 0;
  questionPatterns.forEach(p => {
    const matches = combinedContent.match(p);
    if (matches) questionCount += matches.length;
  });
  
  // Deduplicate count (rough estimate)
  questionCount = Math.min(questionCount, Math.ceil(questionCount / 2));
  
  // Check for location-specific FAQs
  const localFAQPatterns = [
    /(?:how much|what does|when can)\s+[\w\s]+(?:in|near|around)\s+[\w\s]+\?/gi,
    /(?:do you serve|are you available in|can you come to)\s+[\w\s]+\?/gi,
    /(?:cost|price|rates?)\s+(?:in|for|around)\s+[\w\s]+/gi,
  ];
  
  let hasLocalFAQ = localFAQPatterns.some(p => p.test(combinedContent));
  
  // Determine score
  if ((hasFAQSection || hasAccordion) && hasLocalFAQ && questionCount >= 5) {
    return { score: 9, finding: `Strong FAQ section with ${questionCount} location-specific questions` };
  } else if ((hasFAQSection || hasAccordion) && questionCount >= 5) {
    return { score: 8, finding: `Comprehensive FAQ section with ${questionCount} questions` };
  } else if ((hasFAQSection || hasAccordion) && questionCount >= 3) {
    return { score: 7, finding: `FAQ section present with ${questionCount} questions` };
  } else if (hasFAQSection || hasAccordion) {
    return { score: 5, finding: `FAQ section detected with accordion/expandable elements` };
  } else if (questionCount >= 3) {
    return { score: 4, finding: `${questionCount} Q&A patterns found but no dedicated FAQ section` };
  } else if (questionCount >= 1) {
    return { score: 2, finding: `Limited FAQ content (${questionCount} questions found)` };
  }
  
  return { score: 1, finding: "No FAQ section detected on page" };
}

// Contact information analysis
function analyzeContactInfo(content: string, phone: string | null): { score: number; finding: string } {
  const hasPhone = phone || /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(content);
  
  // Check for address
  const addressPattern = /\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|suite|ste)[\w\s,]+\d{5}/gi;
  const hasAddress = addressPattern.test(content);
  
  // Check for hours
  const hoursPatterns = [
    /(?:hours|open)\s*:?\s*[\d:apm\s\-]+/gi,
    /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*[-:]\s*[\d:apm\s\-]+/gi,
    /\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi,
    /24\/7|24\s+hours/gi,
  ];
  
  let hasHours = false;
  hoursPatterns.forEach(p => {
    if (p.test(content)) hasHours = true;
  });
  
  // Check prominence (appears early)
  const introContent = content.substring(0, 2000);
  const phoneInIntro = hasPhone && /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(introContent);
  
  if (hasPhone && hasAddress && hasHours && phoneInIntro) {
    return { score: 9, finding: `Complete contact info: Phone (prominent), address, and hours` };
  } else if (hasPhone && hasAddress) {
    return { score: 7, finding: `Good contact info: Phone and address present` };
  } else if (hasPhone) {
    return { score: 5, finding: `Phone number present but missing address or hours` };
  }
  
  return { score: 2, finding: "Limited contact information on page" };
}

// Schema analysis - Updated to use extracted JSON-LD
function analyzeLocalBusinessSchema(schemas: any[], schemaTypes: string[]): SchemaAnalysis & { score: number; finding: string } {
  // LocalBusiness and all its subtypes
  const localBusinessTypes = [
    'localbusiness', 'plumber', 'electrician', 'hvacbusiness', 'locksmith',
    'roofingcontractor', 'housepaint', 'movingcompany', 'pestcontrol',
    'homeandconstructionbusiness', 'generalcontractor', 'handyman',
    'autobodyshop', 'autorepair', 'beautysa', 'dentist', 'physician',
    'medicalbusiness', 'legalservice', 'financialservice', 'realestateagent',
    'travelagency', 'lodgingbusiness', 'foodestablishment', 'restaurant'
  ];

  // Check if any LocalBusiness type exists
  const hasLocalBusiness = schemaTypes.some(type =>
    localBusinessTypes.some(lbType => type.toLowerCase().includes(lbType))
  );

  if (!hasLocalBusiness) {
    return { present: false, complete: false, missing: ['LocalBusiness schema'], score: 0, finding: "No LocalBusiness schema found" };
  }

  // Find the actual LocalBusiness schema object
  const localBusinessData = findSchemaByType(schemas, localBusinessTypes);

  if (!localBusinessData) {
    return { present: false, complete: false, missing: ['LocalBusiness schema'], score: 0, finding: "LocalBusiness type detected but data not found" };
  }

  // Check for required and recommended fields
  const requiredFields = ['name', 'address', 'telephone'];
  const recommendedFields = ['geo', 'areaServed', 'openingHoursSpecification', 'priceRange', 'url', 'image'];

  const missing: string[] = [];

  // Check required fields
  requiredFields.forEach(field => {
    if (!localBusinessData[field]) missing.push(field);
  });

  // Check recommended fields
  recommendedFields.forEach(field => {
    if (!localBusinessData[field]) missing.push(field);
  });

  const hasAllRequired = requiredFields.every(f => localBusinessData[f]);
  const recommendedCount = recommendedFields.filter(f => localBusinessData[f]).length;

  console.log(`[GEO Analyzer] LocalBusiness found: required=${hasAllRequired}, recommended=${recommendedCount}/${recommendedFields.length}`);

  if (hasAllRequired && recommendedCount >= 4) {
    return { present: true, complete: true, missing: [], score: 10, finding: "Complete LocalBusiness schema with geo, hours, and areaServed" };
  } else if (hasAllRequired && recommendedCount >= 2) {
    return { present: true, complete: false, missing, score: 7, finding: `LocalBusiness schema with ${recommendedCount} recommended fields` };
  } else if (hasAllRequired) {
    return { present: true, complete: false, missing, score: 6, finding: `LocalBusiness schema present but missing: ${missing.slice(0, 3).join(', ')}` };
  }

  return { present: true, complete: false, missing, score: 4, finding: `Incomplete LocalBusiness schema, missing: ${missing.slice(0, 3).join(', ')}` };
}

function analyzeServiceSchema(schemas: any[], schemaTypes: string[]): SchemaAnalysis & { score: number; finding: string } {
  const serviceTypes = ['service', 'offer', 'product'];

  const hasService = schemaTypes.some(type =>
    serviceTypes.some(st => type.toLowerCase().includes(st))
  );

  if (!hasService) {
    return { present: false, complete: false, missing: ['Service schema'], score: 0, finding: "No Service schema found" };
  }

  const serviceData = findSchemaByType(schemas, serviceTypes);

  if (!serviceData) {
    return { present: false, complete: false, missing: ['Service schema'], score: 0, finding: "Service type detected but data not found" };
  }

  const recommendedFields = ['name', 'description', 'provider', 'areaServed', 'offers'];
  const missing = recommendedFields.filter(f => !serviceData[f]);

  const hasOffers = serviceData.offers || serviceData.priceRange || serviceData.price;

  console.log(`[GEO Analyzer] Service schema found: hasOffers=${hasOffers}, missing=${missing.length}`);

  if (hasOffers && missing.length <= 1) {
    return { present: true, complete: true, missing: [], score: 9, finding: "Complete Service schema with pricing offers" };
  } else if (hasOffers) {
    return { present: true, complete: false, missing, score: 7, finding: "Service schema with offers/pricing present" };
  }

  return { present: true, complete: false, missing, score: 4, finding: `Basic Service schema, missing: ${missing.join(', ')}` };
}

function analyzeFAQSchema(schemas: any[], schemaTypes: string[]): SchemaAnalysis & { score: number; finding: string } {
  const hasFAQ = schemaTypes.some(type => type.toLowerCase().includes('faqpage'));

  if (!hasFAQ) {
    return { present: false, complete: false, missing: ['FAQPage schema'], score: 0, finding: "No FAQPage schema found" };
  }

  const faqData = findSchemaByType(schemas, ['faqpage']);

  if (!faqData) {
    return { present: false, complete: false, missing: ['FAQPage schema'], score: 0, finding: "FAQPage type detected but data not found" };
  }

  const mainEntity = faqData.mainEntity;
  const questionCount = Array.isArray(mainEntity) ? mainEntity.length : 0;

  console.log(`[GEO Analyzer] FAQPage schema found: ${questionCount} questions`);

  if (questionCount >= 5) {
    return { present: true, complete: true, missing: [], score: 9, finding: `FAQPage schema with ${questionCount} questions` };
  } else if (questionCount > 0) {
    return { present: true, complete: false, missing: [], score: 6, finding: `FAQPage schema with only ${questionCount} questions` };
  }

  return { present: true, complete: false, missing: ['mainEntity questions'], score: 4, finding: "FAQPage schema present but no questions defined" };
}

function analyzeAggregateRating(schemas: any[], schemaTypes: string[]): SchemaAnalysis & { score: number; finding: string } {
  // Look for AggregateRating in any schema
  const rating = findAggregateRating(schemas);

  if (!rating) {
    // Also check if any schema type indicates a rating
    const hasRatingType = schemaTypes.some(type => type.toLowerCase().includes('rating'));
    if (!hasRatingType) {
      return { present: false, complete: false, missing: ['AggregateRating schema'], score: 0, finding: "No AggregateRating schema found" };
    }
    return { present: false, complete: false, missing: ['AggregateRating data'], score: 0, finding: "AggregateRating type detected but no data found" };
  }

  const ratingValue = rating.ratingValue;
  const reviewCount = rating.reviewCount || rating.ratingCount;

  console.log(`[GEO Analyzer] AggregateRating found: ${ratingValue}/5, ${reviewCount} reviews`);

  if (ratingValue && reviewCount) {
    return { present: true, complete: true, missing: [], score: 9, finding: `AggregateRating: ${ratingValue}/5 with ${reviewCount} reviews` };
  } else if (ratingValue) {
    return { present: true, complete: false, missing: ['reviewCount'], score: 5, finding: `Rating shown (${ratingValue}) but missing review count` };
  }

  return { present: true, complete: false, missing: ['ratingValue', 'reviewCount'], score: 3, finding: "Incomplete AggregateRating schema" };
}

// Extract business context from page and schema data
interface BusinessContext {
  businessName: string;
  location: string;
  suburb: string;
  state: string;
  phone: string;
  service: string;
  serviceType: string;
  streetAddress: string;
  landmark: string;
}

function extractBusinessContext(
  schemas: any[],
  schemaTypes: string[],
  pageContent: string,
  title: string,
  url: string
): BusinessContext {
  let context: BusinessContext = {
    businessName: '',
    location: '',
    suburb: '',
    state: '',
    phone: '',
    service: '',
    serviceType: '',
    streetAddress: '',
    landmark: ''
  };

  // Try to extract from LocalBusiness schema first
  const localBusinessTypes = [
    'localbusiness', 'plumber', 'electrician', 'hvacbusiness', 'locksmith',
    'roofingcontractor', 'homeandconstructionbusiness', 'generalcontractor'
  ];
  const localBusiness = findSchemaByType(schemas, localBusinessTypes);
  
  if (localBusiness) {
    context.businessName = localBusiness.name || '';
    context.phone = localBusiness.telephone || '';
    
    // Extract from address
    const address = localBusiness.address;
    if (address) {
      context.streetAddress = address.streetAddress || '';
      context.suburb = address.addressLocality || '';
      context.state = address.addressRegion || '';
      context.location = [context.suburb, context.state].filter(Boolean).join(', ');
    }
    
    // Determine service type from @type
    const bizType = Array.isArray(localBusiness['@type']) 
      ? localBusiness['@type'].find((t: string) => t.toLowerCase() !== 'localbusiness') || localBusiness['@type'][0]
      : localBusiness['@type'];
    
    if (bizType && bizType.toLowerCase() !== 'localbusiness') {
      context.serviceType = bizType;
    }
  }

  // Try to get service from URL path or title
  const urlPath = new URL(url).pathname.toLowerCase();
  const servicePatterns = [
    { pattern: /hot[-\s]?water/i, service: 'Hot Water' },
    { pattern: /plumb/i, service: 'Plumbing' },
    { pattern: /electric/i, service: 'Electrical' },
    { pattern: /hvac|air[-\s]?condition|heating/i, service: 'HVAC' },
    { pattern: /roof/i, service: 'Roofing' },
    { pattern: /drain/i, service: 'Drain Cleaning' },
    { pattern: /gas[-\s]?fit/i, service: 'Gas Fitting' },
    { pattern: /blocked[-\s]?drain/i, service: 'Blocked Drain' },
    { pattern: /leak/i, service: 'Leak Detection' },
    { pattern: /bathroom/i, service: 'Bathroom Renovation' },
    { pattern: /emergency/i, service: 'Emergency Repairs' },
  ];
  
  for (const { pattern, service } of servicePatterns) {
    if (pattern.test(urlPath) || pattern.test(title)) {
      context.service = service;
      break;
    }
  }

  // Fallback: extract business name from title
  if (!context.businessName && title) {
    // Common patterns: "Service | Business Name" or "Business Name - Service"
    const titleParts = title.split(/[|\-–—]/);
    if (titleParts.length >= 2) {
      // Usually the business name is the shorter distinct part
      const possibleName = titleParts.find(p => 
        p.trim().length > 3 && 
        !p.toLowerCase().includes('service') &&
        !p.toLowerCase().includes('plumb') &&
        !p.toLowerCase().includes('hot water')
      );
      if (possibleName) {
        context.businessName = possibleName.trim();
      }
    }
  }

  // Fallback: extract location from content
  if (!context.suburb) {
    const locationPatterns = [
      /(?:in|serving|located in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:plumber|electrician|contractor)/i
    ];
    for (const pattern of locationPatterns) {
      const match = pageContent.match(pattern);
      if (match) {
        context.suburb = match[1];
        break;
      }
    }
  }

  // Extract landmark if mentioned
  const landmarkMatch = pageContent.match(/(?:near|by|next to|opposite)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Park|Station|Shopping|Centre|Center|Mall|Hospital|School|University))?)/i);
  if (landmarkMatch) {
    context.landmark = landmarkMatch[1];
  }

  console.log(`[GEO Analyzer] Extracted business context:`, JSON.stringify(context));
  
  return context;
}

// Get letter grade
function getLetterGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// Get status from score
function getStatus(score: number): "critical" | "important" | "optimize" | "excellent" {
  if (score <= 3) return "critical";
  if (score <= 6) return "important";
  if (score <= 8) return "optimize";
  return "excellent";
}

// Generate contextual recommendation based on element and business context
function generateRecommendation(
  elementId: number, 
  score: number, 
  context: BusinessContext
): { recommendation: string; example: string; impact: string } {
  const biz = context.businessName || "Your Business";
  const loc = context.suburb || context.location || "Your Area";
  const state = context.state || "";
  const svc = context.service || "services";
  const svcType = context.serviceType || "Plumber";
  const phone = context.phone || "(02) XXXX-XXXX";
  const street = context.streetAddress || "123 Main Street";
  const landmark = context.landmark || "local shopping centre";

  const recommendations: Record<number, { recommendation: string; example: string; impact: string }> = {
    1: {
      recommendation: "Create a unique title with suburb/specialty mentions",
      example: `${svc} in ${loc} | 24/7 ${svcType} Specialists | ${biz}`,
      impact: "AI groups templated titles as duplicates - only ONE gets cited"
    },
    2: {
      recommendation: "Differentiate H1 from title, add local context or service specialty",
      example: `Trusted ${loc} ${svcType}s - Expert ${svc} Services Since 1995`,
      impact: "AI uses H1 to understand page focus - matching title wastes optimization opportunity"
    },
    3: {
      recommendation: `Add specific street names, landmarks, and suburbs in your intro for ${loc}`,
      example: `Located near ${landmark}, we've been serving families in ${loc}${state ? ` ${state}` : ''} and surrounding suburbs for over 20 years`,
      impact: "Local specifics prove genuine service area knowledge to AI systems"
    },
    4: {
      recommendation: "Expand content to 800+ words with unique local information",
      example: `Add sections about ${loc} building codes, suburb-specific challenges, local supplier partnerships, and ${svc} solutions for the area`,
      impact: "Thin content gets grouped with duplicates - 40-50% unique content minimum for AI citation"
    },
    5: {
      recommendation: "Add named team member with photo, bio, and local credentials",
      example: `Meet our lead ${svcType.toLowerCase()}, licensed in ${state || 'your state'}, serving ${loc} since 2005`,
      impact: "Named experts build E-E-A-T signals that AI trusts for recommendations"
    },
    6: {
      recommendation: "Include full customer names, their suburbs, and service dates in reviews",
      example: `"Sarah M. from ${loc} - January 2024: Best ${svcType.toLowerCase()} in ${loc}! Fixed our ${svc.toLowerCase()} issue in 2 hours."`,
      impact: "AI trusts detailed testimonials over generic 'John D.' reviews"
    },
    7: {
      recommendation: "Add case studies with specific addresses, project scope, and measurable results",
      example: `${street}, ${loc}: Complete ${svc.toLowerCase()} upgrade for heritage home, saved customer $2,000 vs other quotes`,
      impact: "Specific project details demonstrate real local experience to AI systems"
    },
    8: {
      recommendation: "List specific suburbs, landmarks, and postcodes you serve",
      example: `We service ${loc}, and surrounding suburbs including nearby areas. Call us for ${svc.toLowerCase()} anywhere in the region`,
      impact: "Generic 'and surrounding areas' provides no value - specifics prove service coverage"
    },
    9: {
      recommendation: "Add prominent phone number and action button in first viewport",
      example: `Large 'Call Now: ${phone}' button with 'Get Free ${svc} Quote' secondary CTA`,
      impact: "AI recommends action-ready pages - no CTA = no conversion signals"
    },
    10: {
      recommendation: `Show specific price ranges or starting rates for ${svc.toLowerCase()} services`,
      example: `${svc} service call: $99-$175 | Full ${svc.toLowerCase()} installation: Starting from $850`,
      impact: "AI prefers transparent pricing - 'call for quote' loses to competitors with rates"
    },
    11: {
      recommendation: `Create FAQ section with ${loc}-specific questions and answers`,
      example: `Q: How much does a ${svcType.toLowerCase()} cost in ${loc}? A: ${loc} ${svcType.toLowerCase()}s typically charge $75-$150/hour...`,
      impact: "Location-specific FAQs directly answer AI user queries = higher citation chance"
    },
    12: {
      recommendation: "Display phone, address, and hours prominently in header/hero",
      example: `${biz} | ${street}, ${loc} | ${phone} | Open 7am-6pm Mon-Sat`,
      impact: "Complete NAP + hours in Schema and visible = trusted local business signal"
    },
    13: {
      recommendation: "Add complete LocalBusiness JSON-LD with geo, areaServed, and hours",
      example: `{"@type": "${svcType}", "name": "${biz}", "address": {"addressLocality": "${loc}"}, "areaServed": [...]}`,
      impact: "Schema improves AI accuracy from 16% to 54% - incomplete schema = missed opportunity"
    },
    14: {
      recommendation: `Add Service schema with pricing offers for ${svc.toLowerCase()}`,
      example: `{"@type": "Service", "name": "${svc}", "provider": "${biz}", "offers": {"@type": "Offer", "priceSpecification": {...}}}`,
      impact: "Service schema with pricing helps AI recommend you for transactional queries"
    },
    15: {
      recommendation: `Implement FAQPage schema matching your visible FAQ content about ${svc.toLowerCase()}`,
      example: `Add JSON-LD FAQPage with mainEntity array of ${loc}-specific Questions about ${svc.toLowerCase()}`,
      impact: "FAQ schema increases chance of featured snippet and AI citation for questions"
    },
    16: {
      recommendation: "Add AggregateRating schema with ratingValue and reviewCount",
      example: `{"@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "127"} for ${biz}`,
      impact: "Rating schema displays stars in results and builds AI trust signals"
    }
  };
  
  return recommendations[elementId] || {
    recommendation: "Optimize this element for better AI visibility",
    example: `Follow GEO best practices for ${biz}`,
    impact: "Improving this element increases AI citation probability"
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, businessName, targetLocation, primaryService }: GeoAnalysisRequest = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[GEO Analyzer] Starting analysis for: ${url}`);

    // Get DataForSEO credentials
    const email = Deno.env.get("DATAFORSEO_EMAIL");
    const password = Deno.env.get("DATAFORSEO_PASSWORD");

    if (!email || !password) {
      console.error("[GEO Analyzer] Missing DataForSEO credentials");
      return new Response(
        JSON.stringify({ error: "DataForSEO credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call DataForSEO On-Page Instant Pages API AND fetch HTML for schemas in parallel
    const authString = btoa(`${email}:${password}`);
    
    const [apiResponse, schemaData] = await Promise.all([
      fetch("https://api.dataforseo.com/v3/on_page/instant_pages", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${authString}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{
          url: url,
          load_resources: true,
          enable_javascript: true,
          check_spell: true,
          validate_micromarkup: true,
        }]),
      }),
      extractJsonLdSchemas(url)
    ]);

    const apiData = await apiResponse.json();
    console.log(`[GEO Analyzer] DataForSEO response status: ${apiData.status_code}`);
    console.log(`[GEO Analyzer] Schema extraction complete: ${schemaData.types.length} types found`);

    if (apiData.status_code !== 20000 || !apiData.tasks?.[0]?.result?.[0]?.items?.[0]) {
      console.error("[GEO Analyzer] API error:", JSON.stringify(apiData));
      return new Response(
        JSON.stringify({ error: "Failed to analyze page", details: apiData.status_message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pageData = apiData.tasks[0].result[0].items[0];
    console.log(`[GEO Analyzer] Page data received: ${pageData.url}`);

    // Extract key fields from DataForSEO
    const title = pageData.meta?.title || "";
    const description = pageData.meta?.description || "";
    const h1Tags = pageData.meta?.htags?.h1 || [];
    const h2Tags = pageData.meta?.htags?.h2 || [];
    const wordCount = pageData.meta?.content?.plain_text_word_count || 0;
    const phone = pageData.phone || null;
    const internalLinks = pageData.meta?.internal_links_count || 0;
    const externalLinks = pageData.meta?.external_links_count || 0;
    const images = pageData.meta?.images_count || 0;
    const imagesWithAlt = pageData.meta?.images_alt_count || 0;
    
    // Get page content - use description and any available text
    const pageContent = [
      title,
      description,
      ...(h1Tags || []),
      ...(h2Tags || []),
      pageData.meta?.content?.plain_text || "",
    ].join(" ");

    // Extract business context for contextual recommendations
    const businessContext = extractBusinessContext(
      schemaData.jsonLd,
      schemaData.types,
      pageContent,
      title,
      url
    );

    // Analyze all 16 elements
    const elements: ElementScore[] = [];
    
    // Category 1: Content Uniqueness
    const titleAnalysis = detectTemplateTitle(title, targetLocation);
    elements.push({
      id: 1,
      name: "Title Tag",
      category: "content_uniqueness",
      score: titleAnalysis.score,
      maxScore: 10,
      status: getStatus(titleAnalysis.score),
      finding: titleAnalysis.finding,
      ...generateRecommendation(1, titleAnalysis.score, businessContext)
    });
    
    const h1Analysis = analyzeH1(h1Tags, title);
    elements.push({
      id: 2,
      name: "H1 Heading",
      category: "content_uniqueness",
      score: h1Analysis.score,
      maxScore: 10,
      status: getStatus(h1Analysis.score),
      finding: h1Analysis.finding,
      ...generateRecommendation(2, h1Analysis.score, businessContext)
    });
    
    const introAnalysis = analyzeIntroContent(pageContent, targetLocation);
    elements.push({
      id: 3,
      name: "Intro Paragraph",
      category: "content_uniqueness",
      score: introAnalysis.score,
      maxScore: 10,
      status: getStatus(introAnalysis.score),
      finding: introAnalysis.finding,
      ...generateRecommendation(3, introAnalysis.score, businessContext)
    });
    
    const uniquenessAnalysis = analyzeContentUniqueness(wordCount, pageContent);
    elements.push({
      id: 4,
      name: "Content Uniqueness",
      category: "content_uniqueness",
      score: uniquenessAnalysis.score,
      maxScore: 10,
      status: getStatus(uniquenessAnalysis.score),
      finding: uniquenessAnalysis.finding,
      ...generateRecommendation(4, uniquenessAnalysis.score, businessContext)
    });
    
    // Category 2: Local Trust Signals
    const teamAnalysis = detectTeamMember(pageContent);
    elements.push({
      id: 5,
      name: "Team Member/Expert",
      category: "local_trust_signals",
      score: teamAnalysis.score,
      maxScore: 10,
      status: getStatus(teamAnalysis.score),
      finding: teamAnalysis.finding,
      ...generateRecommendation(5, teamAnalysis.score, businessContext)
    });
    
    const testimonialAnalysis = analyzeTestimonials(pageContent, schemaData.html);
    elements.push({
      id: 6,
      name: "Testimonials",
      category: "local_trust_signals",
      score: testimonialAnalysis.score,
      maxScore: 10,
      status: getStatus(testimonialAnalysis.score),
      finding: testimonialAnalysis.finding,
      ...generateRecommendation(6, testimonialAnalysis.score, businessContext)
    });
    
    const caseStudyAnalysis = detectCaseStudies(pageContent);
    elements.push({
      id: 7,
      name: "Case Studies",
      category: "local_trust_signals",
      score: caseStudyAnalysis.score,
      maxScore: 10,
      status: getStatus(caseStudyAnalysis.score),
      finding: caseStudyAnalysis.finding,
      ...generateRecommendation(7, caseStudyAnalysis.score, businessContext)
    });
    
    const serviceAreaAnalysis = analyzeServiceArea(pageContent);
    elements.push({
      id: 8,
      name: "Service Area Details",
      category: "local_trust_signals",
      score: serviceAreaAnalysis.score,
      maxScore: 10,
      status: getStatus(serviceAreaAnalysis.score),
      finding: serviceAreaAnalysis.finding,
      ...generateRecommendation(8, serviceAreaAnalysis.score, businessContext)
    });
    
    // Category 3: Transactional Elements
    const ctaAnalysis = detectHeroCTA(pageContent);
    elements.push({
      id: 9,
      name: "Hero CTA",
      category: "transactional_elements",
      score: ctaAnalysis.score,
      maxScore: 10,
      status: getStatus(ctaAnalysis.score),
      finding: ctaAnalysis.finding,
      ...generateRecommendation(9, ctaAnalysis.score, businessContext)
    });
    
    const pricingAnalysis = detectPricing(pageContent);
    elements.push({
      id: 10,
      name: "Pricing Information",
      category: "transactional_elements",
      score: pricingAnalysis.score,
      maxScore: 10,
      status: getStatus(pricingAnalysis.score),
      finding: pricingAnalysis.finding,
      ...generateRecommendation(10, pricingAnalysis.score, businessContext)
    });
    
    const faqAnalysis = detectFAQ(pageContent, schemaData.html);
    elements.push({
      id: 11,
      name: "FAQ Section",
      category: "transactional_elements",
      score: faqAnalysis.score,
      maxScore: 10,
      status: getStatus(faqAnalysis.score),
      finding: faqAnalysis.finding,
      ...generateRecommendation(11, faqAnalysis.score, businessContext)
    });
    
    const contactAnalysis = analyzeContactInfo(pageContent, phone);
    elements.push({
      id: 12,
      name: "Contact Information",
      category: "transactional_elements",
      score: contactAnalysis.score,
      maxScore: 10,
      status: getStatus(contactAnalysis.score),
      finding: contactAnalysis.finding,
      ...generateRecommendation(12, contactAnalysis.score, businessContext)
    });
    
    // Category 4: Technical & Schema - Using extracted JSON-LD data
    const localBusinessSchema = analyzeLocalBusinessSchema(schemaData.jsonLd, schemaData.types);
    elements.push({
      id: 13,
      name: "LocalBusiness Schema",
      category: "technical_schema",
      score: localBusinessSchema.score,
      maxScore: 10,
      status: getStatus(localBusinessSchema.score),
      finding: localBusinessSchema.finding,
      ...generateRecommendation(13, localBusinessSchema.score, businessContext)
    });
    
    const serviceSchema = analyzeServiceSchema(schemaData.jsonLd, schemaData.types);
    elements.push({
      id: 14,
      name: "Service Schema",
      category: "technical_schema",
      score: serviceSchema.score,
      maxScore: 10,
      status: getStatus(serviceSchema.score),
      finding: serviceSchema.finding,
      ...generateRecommendation(14, serviceSchema.score, businessContext)
    });
    
    const faqSchema = analyzeFAQSchema(schemaData.jsonLd, schemaData.types);
    elements.push({
      id: 15,
      name: "FAQPage Schema",
      category: "technical_schema",
      score: faqSchema.score,
      maxScore: 10,
      status: getStatus(faqSchema.score),
      finding: faqSchema.finding,
      ...generateRecommendation(15, faqSchema.score, businessContext)
    });
    
    const ratingSchema = analyzeAggregateRating(schemaData.jsonLd, schemaData.types);
    elements.push({
      id: 16,
      name: "AggregateRating Schema",
      category: "technical_schema",
      score: ratingSchema.score,
      maxScore: 10,
      status: getStatus(ratingSchema.score),
      finding: ratingSchema.finding,
      ...generateRecommendation(16, ratingSchema.score, businessContext)
    });

    // Calculate category scores
    const categories = {
      content_uniqueness: {
        score: elements.filter(e => e.category === "content_uniqueness").reduce((sum, e) => sum + e.score, 0),
        max: 40,
        percentage: 0
      },
      local_trust_signals: {
        score: elements.filter(e => e.category === "local_trust_signals").reduce((sum, e) => sum + e.score, 0),
        max: 40,
        percentage: 0
      },
      transactional_elements: {
        score: elements.filter(e => e.category === "transactional_elements").reduce((sum, e) => sum + e.score, 0),
        max: 40,
        percentage: 0
      },
      technical_schema: {
        score: elements.filter(e => e.category === "technical_schema").reduce((sum, e) => sum + e.score, 0),
        max: 40,
        percentage: 0
      }
    };
    
    // Calculate percentages
    Object.keys(categories).forEach(key => {
      const cat = categories[key as keyof typeof categories];
      cat.percentage = Math.round((cat.score / cat.max) * 100);
    });

    // Calculate overall score
    const rawScore = elements.reduce((sum, e) => sum + e.score, 0);
    const maxScore = 160;
    const geoScore = Math.round((rawScore / maxScore) * 100);
    const grade = getLetterGrade(geoScore);

    // Group recommendations by priority
    const recommendations = {
      critical: elements.filter(e => e.status === "critical").map(e => ({
        element: e.name,
        currentScore: e.score,
        issue: e.finding,
        recommendation: e.recommendation,
        example: e.example,
        impact: e.impact
      })),
      important: elements.filter(e => e.status === "important").map(e => ({
        element: e.name,
        currentScore: e.score,
        issue: e.finding,
        recommendation: e.recommendation,
        example: e.example,
        impact: e.impact
      })),
      optimize: elements.filter(e => e.status === "optimize").map(e => ({
        element: e.name,
        currentScore: e.score,
        issue: e.finding,
        recommendation: e.recommendation,
        example: e.example,
        impact: e.impact
      }))
    };

    const result = {
      url,
      analyzedAt: new Date().toISOString(),
      geoScore,
      grade,
      rawScore,
      maxScore,
      categories,
      elements,
      recommendations,
      schemaAnalysis: {
        LocalBusiness: { present: localBusinessSchema.present, complete: localBusinessSchema.complete, missing: localBusinessSchema.missing },
        Service: { present: serviceSchema.present, complete: serviceSchema.complete, missing: serviceSchema.missing },
        FAQPage: { present: faqSchema.present, complete: faqSchema.complete, missing: faqSchema.missing },
        AggregateRating: { present: ratingSchema.present, complete: ratingSchema.complete, missing: ratingSchema.missing }
      },
      keyStats: {
        wordCount,
        h1Count: h1Tags.length,
        internalLinks,
        externalLinks,
        images,
        imagesWithAlt,
        phoneDetected: !!phone
      }
    };

    console.log(`[GEO Analyzer] Analysis complete: Score ${geoScore} (${grade})`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[GEO Analyzer] Error:", error);
    return new Response(
      JSON.stringify({ error: "Analysis failed", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
