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

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { project_id, days = 30, date_from, date_to } = await req.json();

    if (!project_id) {
      throw new Error('Invalid request: project_id required');
    }

    // Verify user owns this project
    const { data: project, error: projectError } = await supabaseClient
      .from('seo_projects')
      .select('id')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found or access denied');
    }

    // Get historical average position data
    const startDate = date_from ? new Date(date_from) : (() => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d;
    })();
    const endDate = date_to ? new Date(date_to) : new Date();

    // Calculate previous period dates for comparison
    const periodLength = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - periodLength);
    const previousEndDate = new Date(startDate);
    previousEndDate.setDate(previousEndDate.getDate() - 1);

    const { data: historyData, error: historyError } = await supabaseClient
      .from('rank_tracking_history')
      .select(`
        check_date,
        rank_absolute,
        search_volume,
        tracked_keywords!inner(project_id)
      `)
      .eq('tracked_keywords.project_id', project_id)
      .gte('check_date', startDate.toISOString().split('T')[0])
      .lte('check_date', endDate.toISOString().split('T')[0])
      .not('rank_absolute', 'is', null)
      .lte('rank_absolute', 100)
      .order('check_date', { ascending: true });

    if (historyError) {
      console.error('History error:', historyError);
      throw historyError;
    }

    // Group by date and calculate daily average position
    const dailyMetrics = new Map<string, { ranks: number[], volumes: number[], count: number }>();
    
    historyData?.forEach((record: any) => {
      const date = record.check_date;
      if (!dailyMetrics.has(date)) {
        dailyMetrics.set(date, { ranks: [], volumes: [], count: 0 });
      }
      const metrics = dailyMetrics.get(date)!;
      metrics.ranks.push(record.rank_absolute);
      metrics.volumes.push(record.search_volume || 0);
      metrics.count++;
    });

    // Calculate average position for each date
    const historicalData = Array.from(dailyMetrics.entries()).map(([date, metrics]) => {
      // Simple average
      const simpleAvg = metrics.ranks.reduce((sum, rank) => sum + rank, 0) / metrics.ranks.length;
      
      // Weighted average by search volume
      const totalVolume = metrics.volumes.reduce((sum, vol) => sum + vol, 0);
      const weightedAvg = totalVolume > 0
        ? metrics.ranks.reduce((sum, rank, idx) => sum + (rank * metrics.volumes[idx]), 0) / totalVolume
        : simpleAvg;

      return {
        date,
        avg_position: Math.round(simpleAvg * 10) / 10,
        weighted_avg_position: Math.round(weightedAvg * 10) / 10,
        keyword_count: metrics.count
      };
    });

    // Get current metrics (latest date)
    const latestMetrics = historicalData[historicalData.length - 1];
    const previousMetrics = historicalData.length > 1 ? historicalData[historicalData.length - 2] : null;

    // Calculate position distribution from DataForSEO API data (most recent month)
    const latestMetricsData = latestMetrics?.metrics?.organic;
    const distribution = {
      top_3: (latestMetricsData?.pos_1 || 0) + (latestMetricsData?.pos_2_3 || 0),
      top_10: (latestMetricsData?.pos_1 || 0) + (latestMetricsData?.pos_2_3 || 0) + (latestMetricsData?.pos_4_10 || 0),
      top_20: (latestMetricsData?.pos_1 || 0) + (latestMetricsData?.pos_2_3 || 0) + (latestMetricsData?.pos_4_10 || 0) + (latestMetricsData?.pos_11_20 || 0),
      top_50: (latestMetricsData?.pos_1 || 0) + (latestMetricsData?.pos_2_3 || 0) + (latestMetricsData?.pos_4_10 || 0) + (latestMetricsData?.pos_11_20 || 0) + (latestMetricsData?.pos_21_30 || 0) + (latestMetricsData?.pos_31_40 || 0) + (latestMetricsData?.pos_41_50 || 0),
      top_100: latestMetricsData?.count || 0
    };

    // Calculate new keywords (keywords that first appeared in this date range)
    const { data: allHistoryData, error: allHistoryError } = await supabaseClient
      .from('rank_tracking_history')
      .select(`
        tracked_keyword_id,
        check_date,
        rank_absolute,
        tracked_keywords!inner(keyword, project_id)
      `)
      .eq('tracked_keywords.project_id', project_id)
      .not('rank_absolute', 'is', null)
      .lte('rank_absolute', 100)
      .order('check_date', { ascending: true });

    if (allHistoryError) {
      console.error('All history error:', allHistoryError);
    }

    // Group by keyword to find first appearance
    const keywordFirstAppearance = new Map<string, { date: string, keyword: string }>();
    
    allHistoryData?.forEach((record: any) => {
      const kwId = record.tracked_keyword_id;
      if (!keywordFirstAppearance.has(kwId)) {
        keywordFirstAppearance.set(kwId, {
          date: record.check_date,
          keyword: record.tracked_keywords.keyword
        });
      }
    });

    // Filter for keywords that first appeared in the selected date range
    const newKeywordsInRange: Array<{ date: string, keyword: string }> = [];
    keywordFirstAppearance.forEach((value) => {
      const firstDate = new Date(value.date);
      if (firstDate >= startDate && firstDate <= endDate) {
        newKeywordsInRange.push(value);
      }
    });

    // Group new keywords by date
    const newKeywordsByDate = new Map<string, number>();
    newKeywordsInRange.forEach(({ date }) => {
      newKeywordsByDate.set(date, (newKeywordsByDate.get(date) || 0) + 1);
    });

    const newKeywordsTimeline = Array.from(newKeywordsByDate.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate total keywords ranked for current and previous periods
    const { data: currentPeriodKeywords, error: currentPeriodError } = await supabaseClient
      .from('rank_tracking_history')
      .select(`
        tracked_keyword_id,
        tracked_keywords!inner(project_id)
      `)
      .eq('tracked_keywords.project_id', project_id)
      .gte('check_date', startDate.toISOString().split('T')[0])
      .lte('check_date', endDate.toISOString().split('T')[0])
      .not('rank_absolute', 'is', null)
      .lte('rank_absolute', 100);

    const { data: previousPeriodKeywords, error: previousPeriodError } = await supabaseClient
      .from('rank_tracking_history')
      .select(`
        tracked_keyword_id,
        tracked_keywords!inner(project_id)
      `)
      .eq('tracked_keywords.project_id', project_id)
      .gte('check_date', previousStartDate.toISOString().split('T')[0])
      .lte('check_date', previousEndDate.toISOString().split('T')[0])
      .not('rank_absolute', 'is', null)
      .lte('rank_absolute', 100);

    if (currentPeriodError) {
      console.error('Current period error:', currentPeriodError);
    }
    if (previousPeriodError) {
      console.error('Previous period error:', previousPeriodError);
    }

    // Get unique keyword IDs for each period
    const currentKeywordIds = new Set(currentPeriodKeywords?.map((r: any) => r.tracked_keyword_id) || []);
    const previousKeywordIds = new Set(previousPeriodKeywords?.map((r: any) => r.tracked_keyword_id) || []);

    const totalKeywordsRanked = currentKeywordIds.size;
    const previousPeriodTotal = previousKeywordIds.size;
    const keywordsGained = [...currentKeywordIds].filter(id => !previousKeywordIds.has(id)).length;
    const keywordsLost = [...previousKeywordIds].filter(id => !currentKeywordIds.has(id)).length;
    const netChange = keywordsGained - keywordsLost;
    const percentageChange = previousPeriodTotal > 0 
      ? ((totalKeywordsRanked - previousPeriodTotal) / previousPeriodTotal) * 100 
      : 0;

    // Calculate daily keyword counts for the timeline chart
    const { data: dailyKeywordData, error: dailyKeywordError } = await supabaseClient
      .from('rank_tracking_history')
      .select(`
        check_date,
        tracked_keyword_id,
        tracked_keywords!inner(project_id)
      `)
      .eq('tracked_keywords.project_id', project_id)
      .gte('check_date', startDate.toISOString().split('T')[0])
      .lte('check_date', endDate.toISOString().split('T')[0])
      .not('rank_absolute', 'is', null)
      .lte('rank_absolute', 100)
      .order('check_date', { ascending: true });

    if (dailyKeywordError) {
      console.error('Daily keyword error:', dailyKeywordError);
    }

    // Group by date and count unique keywords
    const dailyKeywordCounts = new Map<string, Set<string>>();
    dailyKeywordData?.forEach((record: any) => {
      const date = record.check_date;
      if (!dailyKeywordCounts.has(date)) {
        dailyKeywordCounts.set(date, new Set());
      }
      dailyKeywordCounts.get(date)!.add(record.tracked_keyword_id);
    });

    const keywordsRankedTimeline = Array.from(dailyKeywordCounts.entries())
      .map(([date, keywordSet]) => ({ date, count: keywordSet.size }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return new Response(
      JSON.stringify({
        success: true,
        current_avg_position: latestMetrics?.avg_position || null,
        current_weighted_avg_position: latestMetrics?.weighted_avg_position || null,
        previous_avg_position: previousMetrics?.avg_position || null,
        position_change: latestMetrics && previousMetrics 
          ? previousMetrics.avg_position - latestMetrics.avg_position 
          : null,
        distribution,
        historical_data: historicalData,
        total_keywords_ranked: totalKeywordsRanked,
        previous_period_keywords: previousPeriodTotal,
        keywords_gained: keywordsGained,
        keywords_lost: keywordsLost,
        net_change: netChange,
        percentage_change: Math.round(percentageChange * 10) / 10,
        keywords_ranked_timeline: keywordsRankedTimeline,
        new_keywords_timeline: newKeywordsTimeline,
        total_new_keywords: newKeywordsInRange.length
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
