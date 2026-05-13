export type CitationTier = 'Tier 1' | 'Tier 2';

export interface Citation {
  key: string;
  name: string;
  url: string;
  category: string;
  tier: CitationTier;
  cost: string;
  why: string;
}

export type CountryCode = 'US' | 'AU' | 'UK' | 'IN';

export const COUNTRY_LABELS: Record<CountryCode, string> = {
  US: 'United States',
  AU: 'Australia',
  UK: 'United Kingdom',
  IN: 'India',
};

export const COUNTRY_FROM_LOCATION_CODE: Record<number, CountryCode> = {
  2840: 'US',
  2036: 'AU',
  2826: 'UK',
  2356: 'IN',
};

function slug(country: CountryCode, name: string): string {
  return `${country.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function tierFromLabel(label: string): CitationTier {
  return label.startsWith('Tier 1') ? 'Tier 1' : 'Tier 2';
}

const RAW: Record<CountryCode, Omit<Citation, 'key' | 'tier'> & { tierLabel: string }[]> = {
  US: [
    { name: 'Google Business Profile', url: 'https://business.google.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Powers Google Maps and local pack rankings, the single most important listing.' },
    { name: 'Apple Business Connect', url: 'https://businessconnect.apple.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Controls how businesses appear in Apple Maps, Siri, and Spotlight.' },
    { name: 'Bing Places', url: 'https://www.bingplaces.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Feeds Bing, Microsoft Copilot, and DuckDuckGo local results.' },
    { name: 'Facebook Business Page', url: 'https://www.facebook.com/business/pages', category: 'Social Platform', tierLabel: 'Tier 1', cost: 'Free', why: 'High-authority social citation that often ranks in branded searches.' },
    { name: 'Yelp', url: 'https://biz.yelp.com', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Major review platform feeding Apple Maps and Siri local data.' },
    { name: 'Better Business Bureau', url: 'https://www.bbb.org/get-listed', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 1', cost: 'Paid', why: 'Trust signal that boosts conversions and credibility for service businesses.' },
    { name: 'Yellow Pages (YP.com)', url: 'https://listings.yellowpages.com', category: 'General Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Long-standing high-DR directory still cited by aggregators.' },
    { name: 'Foursquare / Factual', url: 'https://business.foursquare.com', category: 'Data Aggregator', tierLabel: 'Tier 1', cost: 'Free', why: 'Distributes location data to Apple, Uber, Snap, Tesla, and Bing.' },
    { name: 'Data Axle (Express Update)', url: 'https://www.data-axle.com', category: 'Data Aggregator', tierLabel: 'Tier 1', cost: 'Free', why: 'Primary US data aggregator feeding hundreds of downstream directories.' },
    { name: 'Neustar Localeze', url: 'https://www.neustarlocaleze.biz', category: 'Data Aggregator', tierLabel: 'Tier 1', cost: 'Paid', why: 'Powers listings across Apple, Bing, Waze, and major GPS systems.' },
    { name: 'Nextdoor Business', url: 'https://business.nextdoor.com', category: 'Social Platform', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Hyperlocal neighborhood reach, strong for service-area businesses.' },
    { name: 'Manta', url: 'https://www.manta.com', category: 'General Directory', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Established small business directory with decent domain authority.' },
    { name: 'MapQuest', url: 'https://www.mapquest.com', category: 'Search Engine / Map', tierLabel: 'Tier 2', cost: 'Free', why: 'Still pulls navigation traffic and feeds secondary GPS apps.' },
    { name: 'Trustpilot', url: 'https://business.trustpilot.com', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Review schema that surfaces in Google SERPs and AI Overviews.' },
    { name: 'Chamber of Commerce', url: 'https://www.chamberofcommerce.com', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'Locally relevant authority citation, useful for E-E-A-T.' },
  ],
  AU: [
    { name: 'Google Business Profile', url: 'https://business.google.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Dominant local search and Maps platform across Australia.' },
    { name: 'Apple Business Connect', url: 'https://businessconnect.apple.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Controls Apple Maps and Siri results on iOS, large AU user base.' },
    { name: 'Bing Places', url: 'https://www.bingplaces.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Feeds Bing and Microsoft Copilot results in AU.' },
    { name: 'Facebook Business Page', url: 'https://www.facebook.com/business/pages', category: 'Social Platform', tierLabel: 'Tier 1', cost: 'Free', why: 'Top social citation, widely used by Australian consumers.' },
    { name: 'Yellow Pages Australia', url: 'https://www.yellowpages.com.au', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Highest-authority AU business directory, still trusted nationally.' },
    { name: 'White Pages Australia', url: 'https://www.whitepages.com.au', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Sensis-owned, strong domain authority and consumer recognition.' },
    { name: 'True Local', url: 'https://www.truelocal.com.au', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'News Corp-owned review directory with strong AU SEO weight.' },
    { name: 'Localsearch', url: 'https://www.localsearch.com.au', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'One of the top three AU local directories with strong rankings.' },
    { name: 'Yelp Australia', url: 'https://biz.yelp.com.au', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Feeds Apple Maps data in Australia, important for iOS visibility.' },
    { name: 'Hotfrog Australia', url: 'https://www.hotfrog.com.au', category: 'General Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'Reliable AU directory aggregated to other platforms.' },
    { name: 'StartLocal', url: 'https://www.startlocal.com.au', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'Free AU directory still indexed and active.' },
    { name: 'dLook', url: 'https://www.dlook.com.au', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Long-running AU citation with category targeting.' },
    { name: 'Aussie Web', url: 'https://www.aussieweb.com.au', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Established AU directory with decent referral traffic.' },
    { name: 'Word of Mouth (WOMO)', url: 'https://www.womo.com.au', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 2', cost: 'Free', why: 'Reputable AU reviews platform for service businesses.' },
    { name: 'Foursquare', url: 'https://business.foursquare.com', category: 'Data Aggregator', tierLabel: 'Tier 2', cost: 'Free', why: 'Feeds Apple Maps and other apps with AU location data.' },
  ],
  UK: [
    { name: 'Google Business Profile', url: 'https://business.google.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Dominant UK local search and Maps platform.' },
    { name: 'Apple Business Connect', url: 'https://businessconnect.apple.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Controls Apple Maps visibility for UK iOS users.' },
    { name: 'Bing Places', url: 'https://www.bingplaces.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Strong UK Bing market share, feeds Copilot results.' },
    { name: 'Facebook Business Page', url: 'https://www.facebook.com/business/pages', category: 'Social Platform', tierLabel: 'Tier 1', cost: 'Free', why: 'Major UK consumer touchpoint and high-authority citation.' },
    { name: 'Yell.com', url: 'https://www.yell.com', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Top UK business directory, highest local DA in the market.' },
    { name: 'Thomson Local', url: 'https://www.thomsonlocal.com', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Long-standing UK directory feeding multiple data partners.' },
    { name: '192.com', url: 'https://www.192.com', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Major UK people and business search, high trust signal.' },
    { name: 'Trustpilot', url: 'https://business.trustpilot.com', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 1', cost: 'Freemium', why: 'UK-headquartered, dominant review platform with SERP integration.' },
    { name: 'Yelp UK', url: 'https://biz.yelp.co.uk', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Feeds Apple Maps UK and supports review-rich snippets.' },
    { name: 'Scoot', url: 'https://www.scoot.co.uk', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Distributes listings across UK partner networks.' },
    { name: 'FreeIndex', url: 'https://www.freeindex.co.uk', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Popular free UK directory with active reviews.' },
    { name: 'Touch Local', url: 'https://www.touchlocal.com', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Established UK citation with category structure.' },
    { name: 'Cylex UK', url: 'https://www.cylex-uk.co.uk', category: 'General Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'Active UK directory still indexed by Google.' },
    { name: 'Brownbook', url: 'https://www.brownbook.net', category: 'General Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'Free global directory commonly used in UK citation builds.' },
    { name: 'Hotfrog UK', url: 'https://www.hotfrog.co.uk', category: 'General Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'Reliable secondary UK citation source.' },
  ],
  IN: [
    { name: 'Google Business Profile', url: 'https://business.google.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Dominant search and Maps platform across India.' },
    { name: 'Apple Business Connect', url: 'https://businessconnect.apple.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Growing iOS user base in India makes Apple Maps visibility valuable.' },
    { name: 'Bing Places', url: 'https://www.bingplaces.com', category: 'Search Engine / Map', tierLabel: 'Tier 1', cost: 'Free', why: 'Feeds Bing and Copilot results, used in enterprise India.' },
    { name: 'Facebook Business Page', url: 'https://www.facebook.com/business/pages', category: 'Social Platform', tierLabel: 'Tier 1', cost: 'Free', why: 'Massive India user base, strong branded search citation.' },
    { name: 'JustDial', url: 'https://www.justdial.com', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: "India's largest local search engine, essential for visibility." },
    { name: 'Sulekha', url: 'https://www.sulekha.com', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Top services marketplace with high India domain authority.' },
    { name: 'IndiaMART', url: 'https://www.indiamart.com', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Largest B2B directory in India, critical for trade businesses.' },
    { name: 'TradeIndia', url: 'https://www.tradeindia.com', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: 'Major B2B citation platform with strong rankings.' },
    { name: 'Indiacom (Yellow Pages India)', url: 'https://www.indiacom.com', category: 'Country-Specific Directory', tierLabel: 'Tier 1', cost: 'Freemium', why: "India's official Yellow Pages, established trust signal." },
    { name: 'AskLaila', url: 'https://www.asklaila.com', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'City-focused India local directory with active listings.' },
    { name: 'Grotal', url: 'https://www.grotal.com', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'Pan-India local directory covering tier 2 and 3 cities.' },
    { name: 'ClickIndia', url: 'https://www.clickindia.com', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Free', why: 'Classifieds and business listings with steady India traffic.' },
    { name: 'UrbanPro', url: 'https://www.urbanpro.com', category: 'Country-Specific Directory', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Strong for education, coaching, and professional services.' },
    { name: 'MouthShut', url: 'https://www.mouthshut.com', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 2', cost: 'Free', why: 'Established India review platform with SERP visibility.' },
    { name: 'Yelp India', url: 'https://biz.yelp.in', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Feeds Apple Maps data for India iOS users.' },
    { name: 'Trustpilot', url: 'https://business.trustpilot.com', category: 'Industry-Agnostic Review Site', tierLabel: 'Tier 2', cost: 'Freemium', why: 'Increasingly used by India e-commerce and service brands.' },
  ],
};

export const CITATIONS_BY_COUNTRY: Record<CountryCode, Citation[]> = (Object.keys(RAW) as CountryCode[])
  .reduce((acc, country) => {
    acc[country] = RAW[country].map((c) => ({
      key: slug(country, c.name),
      name: c.name,
      url: c.url,
      category: c.category,
      tier: tierFromLabel(c.tierLabel),
      cost: c.cost,
      why: c.why,
    }));
    return acc;
  }, {} as Record<CountryCode, Citation[]>);
