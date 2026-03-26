import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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
      tool: 'ai-overview'
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

    const { keyword, location_code = 2826, language_code = "en" } = await req.json();

    if (!keyword) {
      return new Response(
        JSON.stringify({ error: 'Keyword is required' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    console.log(`Processing AI Overview for keyword: ${keyword}`);

    const email = Deno.env.get('DATAFORSEO_EMAIL');
    const password = Deno.env.get('DATAFORSEO_PASSWORD');

    if (!email || !password) {
      throw new Error('DataForSEO credentials not configured');
    }

    const credentials = btoa(`${email}:${password}`);

    const requestBody = {
      language_code,
      location_code: parseInt(location_code),
      keyword,
      calculate_clickstream_data: true,
      include_serp_info: true,
      include_clickstream_data: true,
      custom_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };

    console.log('Making request to DataForSEO API...');

    const response = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([requestBody]),
    });

    console.log(`API Response status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`DataForSEO API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('API Response data:', JSON.stringify(data, null, 2));

    // Add detailed logging of SERP items to understand structure
    if (data?.tasks?.[0]?.result?.[0]?.items) {
      const items = data.tasks[0].result[0].items;
      console.log(`Found ${items.length} SERP items`);
      
      items.forEach((item: any, index: number) => {
        console.log(`Item ${index}: type=${item.type}, title=${item.title || 'N/A'}`);
        if (item.type === 'ai_overview' || item.type === 'ai_summary' || item.type === 'ai_mode') {
          console.log('AI Overview item found:', JSON.stringify(item, null, 2));
        }
      });
    }

    return new Response(
      JSON.stringify(data),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('Error in AI Overview function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch AI Overview data',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});