import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format' }), 
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Running Lighthouse analysis for:', url);

    // Get DataForSEO credentials
    const email = Deno.env.get('DATAFORSEO_EMAIL');
    const password = Deno.env.get('DATAFORSEO_PASSWORD');

    if (!email || !password) {
      console.error('DataForSEO credentials not found');
      return new Response(
        JSON.stringify({ error: 'DataForSEO credentials not configured' }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Prepare request to DataForSEO Lighthouse API
    const requestBody = [{
      url: url,
      categories: ["seo", "performance", "accessibility"],
      device: "desktop",
      language_code: "en"
    }];

    console.log('Sending request to DataForSEO:', JSON.stringify(requestBody, null, 2));

    // Make request to DataForSEO
    const response = await fetch('https://api.dataforseo.com/v3/on_page/lighthouse/live/json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${email}:${password}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const responseData = await response.json();
    
    console.log('DataForSEO response status:', response.status);
    console.log('DataForSEO response:', JSON.stringify(responseData, null, 2));

    if (!response.ok) {
      console.error('DataForSEO API error:', responseData);
      return new Response(
        JSON.stringify({ 
          error: 'DataForSEO API error', 
          details: responseData 
        }), 
        { 
          status: response.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check if the response has the expected structure
    if (!responseData.tasks || responseData.tasks.length === 0) {
      console.error('No tasks in response:', responseData);
      return new Response(
        JSON.stringify({ error: 'No analysis results received' }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const task = responseData.tasks[0];
    if (task.status_code !== 20000) {
      console.error('Task failed:', task);
      return new Response(
        JSON.stringify({ 
          error: 'Analysis failed', 
          details: task.status_message 
        }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (!task.result || task.result.length === 0) {
      console.error('No results in task:', task);
      return new Response(
        JSON.stringify({ error: 'No analysis results available' }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const result = task.result[0];
    
    // Debug: Log ALL available audits to find the right ones
    const allAuditKeys = Object.keys(result.audits || {});
    console.log('ALL available audit keys:', allAuditKeys);
    
    // Look for audits that might contain title content
    const titleRelatedAudits = allAuditKeys.filter(key => 
      key.includes('title') || key.includes('meta') || key.includes('heading') || 
      key.includes('text') || key.includes('content')
    );
    console.log('Title/content related audits:', titleRelatedAudits);
    
    // Log each title-related audit structure
    titleRelatedAudits.forEach(auditKey => {
      console.log(`${auditKey} audit:`, JSON.stringify(result.audits[auditKey], null, 2));
    });
    
    // Also check if title info is in the main result object
    console.log('Main result properties that might contain title:', {
      finalUrl: result.finalUrl,
      mainDocumentUrl: result.mainDocumentUrl,  
      requestedUrl: result.requestedUrl,
      finalDisplayedUrl: result.finalDisplayedUrl
    });
    
    // Extract and structure the Lighthouse data
    const lighthouseData = {
      categories: result.categories || {},
      audits: result.audits || {},
      // Include main result properties that might contain page info
      metadata: {
        finalUrl: result.finalUrl,
        mainDocumentUrl: result.mainDocumentUrl,
        requestedUrl: result.requestedUrl,
        finalDisplayedUrl: result.finalDisplayedUrl,
        fetchTime: result.fetchTime,
        userAgent: result.userAgent
      }
    };

    console.log('Successfully processed Lighthouse data');

    // Call html-parser function to get actual title and meta content
    console.log('Calling html-parser function for actual content...');
    
    try {
      const htmlParserResponse = await fetch('https://tjizedjqkcnzfnwlejwh.supabase.co/functions/v1/html-parser', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ url: url })
      });

      if (htmlParserResponse.ok) {
        const htmlData = await htmlParserResponse.json();
        console.log('HTML parser data received:', htmlData);
        
        // Combine Lighthouse and HTML parser data
        const combinedData = {
          lighthouse: lighthouseData,
          htmlData: htmlData,
          url: url,
          timestamp: new Date().toISOString()
        };

        return new Response(
          JSON.stringify(combinedData), 
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      } else {
        console.error('HTML parser failed:', htmlParserResponse.status);
        // Return just Lighthouse data if HTML parsing fails
        return new Response(
          JSON.stringify({ 
            lighthouse: lighthouseData,
            url: url,
            timestamp: new Date().toISOString(),
            htmlParserError: 'Failed to parse HTML content'
          }), 
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    } catch (htmlError) {
      console.error('Error calling html-parser:', htmlError);
      // Return just Lighthouse data if HTML parsing fails
      return new Response(
        JSON.stringify({ 
          lighthouse: lighthouseData,
          url: url,
          timestamp: new Date().toISOString(),
          htmlParserError: htmlError instanceof Error ? htmlError.message : 'Unknown HTML parser error'
        }), 
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

  } catch (error) {
    console.error('Error in lighthouse-seo function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      }), 
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});