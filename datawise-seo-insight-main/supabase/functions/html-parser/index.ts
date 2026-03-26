import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }), 
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Fetching HTML for:', url);

    // Fetch the HTML content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEO-Analyzer/1.0)',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch HTML: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    console.log('HTML fetched successfully, length:', html.length);

    // Parse HTML using DOMParser for more reliable extraction
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    if (!doc) {
      console.error('Failed to parse HTML document');
      throw new Error('Failed to parse HTML document');
    }
    
    // Parse title
    const titleElement = doc.querySelector('title');
    const title = titleElement ? titleElement.textContent?.trim() || null : null;
    console.log('Extracted title:', title);
    
    // Parse meta description - try both name and property attributes
    let metaDescription = null;
    const metaDescElement = doc.querySelector('meta[name="description"]') || 
                           doc.querySelector('meta[property="og:description"]');
    if (metaDescElement) {
      metaDescription = metaDescElement.getAttribute('content')?.trim() || null;
    }
    console.log('Extracted meta description:', metaDescription);

    // Parse meta keywords
    const metaKeywordsElement = doc.querySelector('meta[name="keywords"]');
    const metaKeywords = metaKeywordsElement ? 
      metaKeywordsElement.getAttribute('content')?.trim() || null : null;

    // Parse h1 tags - get text content properly
    const h1Elements = doc.querySelectorAll('h1');
    const h1Tags = Array.from(h1Elements).map(h1 => h1.textContent?.trim() || '').filter(text => text.length > 0);
    console.log('Extracted H1 tags:', h1Tags);

    // Parse schema markup
    const schemaData = extractSchemaMarkup(doc, html);
    console.log('Extracted schema data:', schemaData);

    const parsedData = {
      title: {
        content: title,
        length: title ? title.length : 0,
        exists: !!title
      },
      metaDescription: {
        content: metaDescription,
        length: metaDescription ? metaDescription.length : 0,
        exists: !!metaDescription
      },
      metaKeywords: {
        content: metaKeywords,
        exists: !!metaKeywords
      },
      h1Tags: {
        content: h1Tags,
        count: h1Tags.length
      },
      schemaMarkup: schemaData,
      url: url
    };

    console.log('Parsed HTML data:', JSON.stringify(parsedData, null, 2));

    return new Response(
      JSON.stringify(parsedData), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in html-parser function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to parse HTML', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      }), 
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Function to extract schema markup from HTML
function extractSchemaMarkup(doc: any, html: string) {
  const schemas: {
    jsonLd: any[];
    microdata: string[];
    rdfa: string[];
    exists: boolean;
    types: string[];
  } = {
    jsonLd: [],
    microdata: [],
    rdfa: [],
    exists: false,
    types: []
  };

  if (!doc) {
    console.error('DOM document is null, cannot extract schema markup');
    return schemas;
  }

  try {
    // Extract JSON-LD schema
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    Array.from(jsonLdScripts).forEach((script: any) => {
      try {
        const content = script.textContent?.trim();
        if (content) {
          const data = JSON.parse(content);
          schemas.jsonLd.push(data);
          
          // Extract schema types
          if (data['@type']) {
            if (Array.isArray(data['@type'])) {
              schemas.types.push(...data['@type']);
            } else {
              schemas.types.push(data['@type']);
            }
          }
        }
      } catch (e) {
        console.log('Error parsing JSON-LD:', e);
      }
    });

    // Extract Microdata
    const microdataElements = doc.querySelectorAll('[itemscope]');
    Array.from(microdataElements).forEach((element: any) => {
      const itemType = element.getAttribute('itemtype');
      if (itemType) {
        schemas.microdata.push(itemType);
        schemas.types.push(itemType);
      }
    });

    // Extract RDFa using regex on HTML (since DOM parser might not handle all RDFa)
    const rdfaMatches = html.match(/typeof=["']([^"']+)["']/gi) || [];
    rdfaMatches.forEach(match => {
      const typeMatch = match.match(/typeof=["']([^"']+)["']/i);
      if (typeMatch && typeMatch[1]) {
        schemas.rdfa.push(typeMatch[1]);
        schemas.types.push(typeMatch[1]);
      }
    });

    // Remove duplicates and clean up types
    schemas.types = [...new Set(schemas.types)].filter(type => type && typeof type === 'string');
    schemas.exists = schemas.jsonLd.length > 0 || schemas.microdata.length > 0 || schemas.rdfa.length > 0;

    console.log('Schema markup found:', {
      jsonLd: schemas.jsonLd.length,
      microdata: schemas.microdata.length,
      rdfa: schemas.rdfa.length,
      types: schemas.types
    });

  } catch (error) {
    console.error('Error extracting schema markup:', error);
  }

  return schemas;
}