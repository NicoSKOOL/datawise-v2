import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('Check keyword rankings function invoked');

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      console.error('Authentication error:', userError);
      throw new Error('Unauthorized');
    }

    console.log('User authenticated:', user.id);

    // Deduct credit
    const { data: hasCreditData, error: creditError } = await supabaseClient.rpc('deduct_credit', {
      user_uuid: user.id,
      tool: 'rank-tracking'
    });

    if (creditError || !hasCreditData) {
      console.error('Credit deduction error:', creditError);
      return new Response(
        JSON.stringify({ 
          error: 'out_of_credits',
          message: 'You have used all your free credits. Join the AI Ranking Community for unlimited access!',
          join_url: 'https://www.skool.com/ai-ranking'
        }),
        { 
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Credit deducted successfully');

    const { keyword_ids, project_id } = await req.json();

    console.log(`Processing ${keyword_ids?.length || 0} keywords for project ${project_id}`);

    if (!keyword_ids || !Array.isArray(keyword_ids) || keyword_ids.length === 0) {
      console.error('Invalid keyword_ids:', keyword_ids);
      throw new Error('Invalid request: keyword_ids array required');
    }

    // Fetch keyword details with project website URL
    const { data: keywords, error: keywordsError } = await supabaseClient
      .from('tracked_keywords')
      .select('*, seo_projects!inner(website_url)')
      .in('id', keyword_ids)
      .eq('is_active', true);

    if (keywordsError || !keywords || keywords.length === 0) {
      console.error('Keywords fetch error:', keywordsError);
      throw new Error('No active keywords found for tracking');
    }

    console.log(`Found ${keywords.length} keywords to check`);

    // Get the project's website URL to use as target domain
    const projectWebsiteUrl = keywords[0]?.seo_projects?.website_url;
    if (!projectWebsiteUrl) {
      console.error('Project website URL not found');
      throw new Error('Project website URL not found');
    }
    
    const targetDomain = projectWebsiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];

    console.log(`Checking rankings for project: ${projectWebsiteUrl}, target domain: ${targetDomain}`);

    const dataForSeoEmail = Deno.env.get('DATAFORSEO_EMAIL');
    const dataForSeoPassword = Deno.env.get('DATAFORSEO_PASSWORD');

    if (!dataForSeoEmail || !dataForSeoPassword) {
      console.error('DataForSEO credentials not configured');
      throw new Error('DataForSEO credentials not configured');
    }

    const auth = btoa(`${dataForSeoEmail}:${dataForSeoPassword}`);
    const results = [];

    // Check rankings for each keyword
    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      console.log(`Processing keyword ${i + 1}/${keywords.length}: ${keyword.keyword}`);
      
      try {
        // Fetch previous rank for comparison
        const { data: previousRank } = await supabaseClient
          .from('rank_tracking_history')
          .select('rank_absolute')
          .eq('tracked_keyword_id', keyword.id)
          .order('check_date', { ascending: false })
          .limit(1)
          .single();

        // Call DataForSEO SERP API with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const serpResponse = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([{
            keyword: keyword.keyword,
            location_code: keyword.location_code,
            language_code: keyword.language_code,
            device: keyword.device,
            depth: 100
          }]),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!serpResponse.ok) {
          console.error(`SERP API error for keyword "${keyword.keyword}": ${serpResponse.status} ${serpResponse.statusText}`);
          continue;
        }

        const serpData = await serpResponse.json();
        const taskResult = serpData?.tasks?.[0];
        
        if (taskResult?.status_code !== 20000 || !taskResult?.result?.[0]?.items) {
          console.error(`No results for keyword "${keyword.keyword}": status ${taskResult?.status_code}, message: ${taskResult?.status_message}`);
          continue;
        }

      const items = taskResult.result[0].items;
      let currentRank = null;
      let rankingUrl = null;
      let serpItemType = null;

      // Find the ranking position for the target domain
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === 'organic' && item.url) {
          try {
            const itemDomain = new URL(item.url).hostname.replace(/^www\./, '');
            const searchDomain = targetDomain.replace(/^www\./, '');
            
            // Check if this URL matches our target domain
            if (itemDomain === searchDomain || itemDomain.endsWith('.' + searchDomain) || searchDomain.endsWith('.' + itemDomain)) {
              currentRank = item.rank_absolute || item.rank_group || (i + 1);
              rankingUrl = item.url;
              serpItemType = item.type;
              break;
            }
          } catch (urlError) {
            console.error('Error parsing URL:', item.url);
          }
        }
      }

      // Determine rank group
      let rankGroup = null;
      if (currentRank) {
        if (currentRank === 1) rankGroup = '1';
        else if (currentRank <= 3) rankGroup = '2-3';
        else if (currentRank <= 10) rankGroup = '4-10';
        else if (currentRank <= 20) rankGroup = '11-20';
        else if (currentRank <= 50) rankGroup = '21-50';
        else rankGroup = '51-100';
      }

      // Calculate estimated traffic (simplified CTR model)
      let estimatedTraffic = 0;
      const searchVolume = taskResult.result[0].keyword_info?.search_volume || 0;
      if (currentRank && searchVolume) {
        const ctr = currentRank === 1 ? 0.30 :
                    currentRank === 2 ? 0.15 :
                    currentRank === 3 ? 0.10 :
                    currentRank <= 10 ? 0.05 :
                    currentRank <= 20 ? 0.02 :
                    0.01;
        estimatedTraffic = Math.round(searchVolume * ctr);
      }

      // Insert rank history
      const { error: historyError } = await supabaseClient
        .from('rank_tracking_history')
        .insert({
          tracked_keyword_id: keyword.id,
          check_date: new Date().toISOString().split('T')[0],
          rank_absolute: currentRank,
          rank_group: rankGroup,
          previous_rank_absolute: previousRank?.rank_absolute || null,
          url: rankingUrl,
          search_volume: searchVolume,
          cpc: taskResult.result[0].keyword_info?.cpc || null,
          competition: taskResult.result[0].keyword_info?.competition || null,
          estimated_traffic: estimatedTraffic,
          serp_item_type: serpItemType
        });

      if (historyError) {
        console.error('Error inserting history:', historyError);
      }

        results.push({
          keyword_id: keyword.id,
          keyword: keyword.keyword,
          current_rank: currentRank,
          previous_rank: previousRank?.rank_absolute || null,
          delta: currentRank && previousRank?.rank_absolute ? 
                 previousRank.rank_absolute - currentRank : null,
          url: rankingUrl
        });

        console.log(`Keyword "${keyword.keyword}" processed: rank ${currentRank || 'not found'}`);
      } catch (error) {
        console.error(`Error checking keyword "${keyword.keyword}":`, error);
        // Continue with next keyword even if one fails
      }
    }

    console.log(`Successfully checked ${results.length} out of ${keywords.length} keywords`);

    return new Response(
      JSON.stringify({
        success: true,
        checked_count: results.length,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
