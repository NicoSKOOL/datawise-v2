import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Clean domain: remove https://, www., trailing slash
const cleanDomain = (domain: string): string => {
  return domain.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/$/, '');
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
      tool: 'keyword-gap-analysis'
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

    const {
      my_domain,
      competitor_domain,
      location_code = 2840, 
      language_code = 'en'
    } = await req.json();
    
    if (!my_domain || !competitor_domain) {
      return new Response(JSON.stringify({ 
        error: 'Both domains are required',
        details: 'Please provide both your domain and competitor domain'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const myDomainClean = cleanDomain(my_domain);
    const competitorDomainClean = cleanDomain(competitor_domain);

    console.log('Processing keyword gap analysis:');
    console.log('Your domain:', myDomainClean);
    console.log('Competitor:', competitorDomainClean);
    console.log('Location:', location_code, 'Language:', language_code);

    const dataForSeoEmail = Deno.env.get('DATAFORSEO_EMAIL');
    const dataForSeoPassword = Deno.env.get('DATAFORSEO_PASSWORD');
    
    if (!dataForSeoEmail || !dataForSeoPassword) {
      return new Response(JSON.stringify({ error: 'DataForSEO credentials not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const credentials = btoa(`${dataForSeoEmail}:${dataForSeoPassword}`);
    
    // Call 1: Keywords where BOTH domains rank (intersections: true)
    console.log('Call 1: Fetching shared keywords...');
    const bothRankingResponse = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live',
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          target1: myDomainClean,
          target2: competitorDomainClean,
          location_code,
          language_code,
          intersections: true,
          limit: 100,
          order_by: ["keyword_data.keyword_info.search_volume,desc"]
        }])
      }
    );

    const bothRankingData = await bothRankingResponse.json();
    
    if (!bothRankingResponse.ok || bothRankingData.status_code !== 20000) {
      console.error('API Error (both ranking):', JSON.stringify(bothRankingData, null, 2));
      return new Response(JSON.stringify({ 
        error: 'Failed to fetch keyword data',
        details: bothRankingData.status_message || 'Unknown error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Call 2: Keywords competitor has but YOU DON'T (gaps)
    console.log('Call 2: Fetching keyword gaps...');
    const gapsResponse = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live',
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          target1: competitorDomainClean,
          target2: myDomainClean,
          location_code,
          language_code,
          intersections: false,
          limit: 100,
          order_by: ["keyword_data.keyword_info.search_volume,desc"]
        }])
      }
    );

    const gapsData = await gapsResponse.json();
    
    if (!gapsResponse.ok || gapsData.status_code !== 20000) {
      console.error('API Error (gaps):', JSON.stringify(gapsData, null, 2));
    }

    // Call 3: Keywords YOU have but competitor DOESN'T (advantages)
    console.log('Call 3: Fetching your advantages...');
    const advantagesResponse = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live',
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          target1: myDomainClean,
          target2: competitorDomainClean,
          location_code,
          language_code,
          intersections: false,
          limit: 100,
          order_by: ["keyword_data.keyword_info.search_volume,desc"]
        }])
      }
    );

    const advantagesData = await advantagesResponse.json();
    
    if (!advantagesResponse.ok || advantagesData.status_code !== 20000) {
      console.error('API Error (advantages):', JSON.stringify(advantagesData, null, 2));
    }

    // Parse responses
    const bothRanking = bothRankingData.tasks?.[0]?.result?.[0]?.items?.map((item: any) => ({
      keyword: item.keyword_data.keyword,
      search_volume: item.keyword_data.keyword_info.search_volume || 0,
      cpc: item.keyword_data.keyword_info.cpc || 0,
      competition: item.keyword_data.keyword_info.competition || 0,
      my_position: item.first_domain_serp_element?.rank_absolute || null,
      competitor_position: item.second_domain_serp_element?.rank_absolute || null
    })) || [];

    const gaps = gapsData.tasks?.[0]?.result?.[0]?.items?.map((item: any) => ({
      keyword: item.keyword_data.keyword,
      search_volume: item.keyword_data.keyword_info.search_volume || 0,
      cpc: item.keyword_data.keyword_info.cpc || 0,
      competition: item.keyword_data.keyword_info.competition || 0,
      competitor_position: item.first_domain_serp_element?.rank_absolute || null
    })) || [];

    const advantages = advantagesData.tasks?.[0]?.result?.[0]?.items?.map((item: any) => ({
      keyword: item.keyword_data.keyword,
      search_volume: item.keyword_data.keyword_info.search_volume || 0,
      cpc: item.keyword_data.keyword_info.cpc || 0,
      competition: item.keyword_data.keyword_info.competition || 0,
      my_position: item.first_domain_serp_element?.rank_absolute || null
    })) || [];

    console.log(`Results: ${bothRanking.length} shared, ${gaps.length} gaps, ${advantages.length} advantages`);

    return new Response(JSON.stringify({
      my_domain: myDomainClean,
      competitor_domain: competitorDomainClean,
      both_ranking: bothRanking,
      gaps,
      advantages,
      metrics: {
        total_shared: bothRanking.length,
        total_gaps: gaps.length,
        total_advantages: advantages.length,
        avg_gap_search_volume: gaps.length > 0 
          ? Math.round(gaps.reduce((sum: number, g: any) => sum + g.search_volume, 0) / gaps.length)
          : 0
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in keyword-gap-analysis function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: 'An unexpected error occurred during analysis'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
