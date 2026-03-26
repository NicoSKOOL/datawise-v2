import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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
      tool: 'related-keywords'
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

    const { keyword, location_code = 2840, language_code = 'en', limit = 100 } = await req.json();
    
    if (!keyword) {
      return new Response(JSON.stringify({ error: 'Keyword is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing related keywords for: ${keyword}, location: ${location_code}, language: ${language_code}, limit: ${limit}`);

    const email = Deno.env.get('DATAFORSEO_EMAIL');
    const password = Deno.env.get('DATAFORSEO_PASSWORD');
    
    const credentials = btoa(`${email}:${password}`);
    
    // First try related keywords API
    const relatedRequestBody = [{
      keyword: keyword,
      location_code: location_code,
      language_code: language_code,
      include_seed_keyword: true,
      limit: Math.min(limit, 1000), // DataForSEO max is 1000
      offset: 0,
      depth: 2, // Get deeper related keywords
      filters: [
        ["keyword_data.keyword_info.search_volume", ">", 0] // Only keywords with search volume
      ]
    }];

    // Also try keyword ideas API for broader results
    const keywordIdeasBody = [{
      keywords: [keyword],
      location_code: location_code,
      language_code: language_code,
      limit: Math.min(limit, 1000),
      offset: 0,
      filters: [
        ["keyword_info.search_volume", ">", 0]
      ],
      order_by: ["keyword_info.search_volume,desc"]
    }];

    console.log('Making requests to DataForSEO APIs...');
    
    // Make both API calls in parallel
    const [relatedResponse, keywordIdeasResponse] = await Promise.all([
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(relatedRequestBody)
      }),
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(keywordIdeasBody)
      })
    ]);

    const [relatedData, keywordIdeasData] = await Promise.all([
      relatedResponse.json(),
      keywordIdeasResponse.json()
    ]);

    console.log('Related Keywords API Response status:', relatedResponse.status);
    console.log('Keyword Ideas API Response status:', keywordIdeasResponse.status);

    if (!relatedResponse.ok && !keywordIdeasResponse.ok) {
      console.error('Both API calls failed');
      return new Response(JSON.stringify({ error: 'DataForSEO API Error', details: { relatedData, keywordIdeasData } }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Combine results from both APIs
    let allKeywords = new Set(); // To avoid duplicates

    // Process related keywords results
    if (relatedResponse.ok && relatedData?.tasks?.length > 0) {
      const relatedTask = relatedData.tasks[0];
      if (relatedTask.result && relatedTask.result.length > 0) {
        const items = relatedTask.result[0].items || [];
        items.forEach((item: any) => {
          if (item.keyword_data?.keyword) {
            allKeywords.add(JSON.stringify({
              keyword: item.keyword_data.keyword,
              search_volume: item.keyword_data.keyword_info?.search_volume || 0,
              competition: item.keyword_data.keyword_info?.competition || 0,
              cpc: item.keyword_data.keyword_info?.cpc || 0,
              competition_level: item.keyword_data.keyword_info?.competition_level || 'UNKNOWN'
            }));
          }
        });
      }
    }

    // Process keyword ideas results
    if (keywordIdeasResponse.ok && keywordIdeasData?.tasks?.length > 0) {
      const keywordIdeasTask = keywordIdeasData.tasks[0];
      if (keywordIdeasTask.result && keywordIdeasTask.result.length > 0) {
        const items = keywordIdeasTask.result[0].items || [];
        items.forEach((item: any) => {
          if (item.keyword) {
            allKeywords.add(JSON.stringify({
              keyword: item.keyword,
              search_volume: item.keyword_info?.search_volume || 0,
              competition: item.keyword_info?.competition || 0,
              cpc: item.keyword_info?.cpc || 0,
              competition_level: item.keyword_info?.competition_level || 'UNKNOWN'
            }));
          }
        });
      }
    }

    // Convert back to objects and sort by search volume
    const finalKeywords = Array.from(allKeywords)
      .map((keywordStr) => JSON.parse(keywordStr as string))
      .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
      .slice(0, limit); // Respect the limit

    // Create a response that matches the expected format
    const combinedResults: any = {
      tasks: [{
        result: [{
          items: finalKeywords.map((keyword: any) => ({
            keyword_data: {
              keyword: keyword.keyword,
              keyword_info: {
                search_volume: keyword.search_volume,
                competition: keyword.competition,
                cpc: keyword.cpc,
                competition_level: keyword.competition_level
              }
            }
          })),
          total_count: finalKeywords.length,
          items_count: finalKeywords.length
        }]
      }]
    };

    console.log(`Combined results: ${finalKeywords.length} unique keywords`);

    return new Response(JSON.stringify(combinedResults), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in related-keywords function:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});