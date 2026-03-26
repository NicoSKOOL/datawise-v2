import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  target: string;
  location_code?: number;
  language_code?: string;
  date_from?: string;
  date_to?: string;
}

// Helper function to clean domain
function sanitizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, '') // Remove http:// or https://
    .replace(/^www\./, '')        // Remove www.
    .replace(/\/$/, '')           // Remove trailing slash
    .split('/')[0]                // Remove any path
    .split('?')[0];               // Remove any query params
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user and check credits
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Deduct credit
    const { data: hasCreditData, error: creditError } = await supabaseClient.rpc('deduct_credit', {
      user_uuid: user.id,
      tool: 'historical-rank-overview'
    });

    if (creditError || !hasCreditData) {
      console.error('Credit deduction error:', creditError);
      return new Response(JSON.stringify({ 
        error: 'out_of_credits',
        message: 'You have run out of credits. Please upgrade to continue using this tool.'
      }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { target, location_code = 2840, language_code = "en", date_from, date_to }: RequestBody = await req.json();

    // Sanitize the domain to remove protocol, www, trailing slash, etc.
    const sanitizedTarget = sanitizeDomain(target);
    console.log(`Processing historical rank overview for: ${target} -> ${sanitizedTarget}`);

    // Get credentials from environment variables
    const email = Deno.env.get('DATAFORSEO_EMAIL');
    const password = Deno.env.get('DATAFORSEO_PASSWORD');

    if (!email || !password) {
      console.error('DataForSEO credentials not found');
      return new Response(
        JSON.stringify({ error: 'API credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cap date_to at today to prevent future date errors
    const today = new Date().toISOString().split('T')[0];
    let finalDateTo = date_to;
    
    if (date_to && date_to > today) {
      console.log(`Capping date_to from ${date_to} to ${today}`);
      finalDateTo = today;
    }

    // Prepare the request body
    const requestBody = [{
      target: sanitizedTarget,
      location_code: location_code,
      language_code: language_code,
      ...(date_from && { date_from }),
      ...(finalDateTo && { date_to: finalDateTo })
    }];

    console.log('Making request to DataForSEO API...');
    console.log('Request body:', JSON.stringify(requestBody, null, 2));

    // Make the API request
    const response = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${email}:${password}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`API Response status: ${response.status}`);

    const data = await response.json();
    console.log('API Response data:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch historical data', details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for API errors
    if (data.status_code !== 20000) {
      return new Response(
        JSON.stringify({ 
          error: 'API returned error', 
          message: data.status_message,
          details: data 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract and format the data (API returns tasks[0].result[0])
    const result = data.tasks?.[0]?.result?.[0];
    if (!result) {
      return new Response(
        JSON.stringify({ error: 'No data found for the specified domain' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Transform the data for frontend consumption
    // Only return keyword count and ETV for each month
    const formattedData = {
      target: result.target,
      location_code: result.location_code,
      language_code: result.language_code,
      total_count: result.total_count,
      items_count: result.items_count,
      historical_data: result.items
        ?.filter((item: any) => item.metrics?.organic !== null)
        ?.map((item: any) => ({
          date: `${item.year}-${String(item.month).padStart(2, '0')}-01`,
          keyword_count: item.metrics.organic.count || 0,
          estimated_traffic: Math.round(item.metrics.organic.etv || 0)
        })) || []
    };

    return new Response(
      JSON.stringify(formattedData),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in historical-rank-overview function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});