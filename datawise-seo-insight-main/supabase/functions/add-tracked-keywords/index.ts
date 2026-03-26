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

    const { project_id, keywords } = await req.json();

    if (!project_id || !keywords || !Array.isArray(keywords) || keywords.length === 0) {
      throw new Error('Invalid request: project_id and keywords array required');
    }

    // Verify user owns the project
    const { data: project, error: projectError } = await supabaseClient
      .from('seo_projects')
      .select('id')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found or access denied');
    }

    // Prepare keywords for insertion
    const keywordsToInsert = keywords.map((kw: any) => ({
      project_id,
      keyword: kw.keyword.trim(),
      location_code: kw.location_code || 2840,
      language_code: kw.language_code || 'en',
      device: kw.device || 'desktop',
      target_url: kw.target_url || null,
      is_active: true
    }));

    // Insert keywords (will skip duplicates due to unique constraint)
    const { data: insertedKeywords, error: insertError } = await supabaseClient
      .from('tracked_keywords')
      .insert(keywordsToInsert)
      .select();

    if (insertError) {
      console.error('Insert error:', insertError);
      // If it's a duplicate error, still return success with empty array
      if (insertError.code === '23505') {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Some keywords were already being tracked',
            keywords: [],
            count: 0
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully added ${insertedKeywords?.length || 0} keywords`,
        keywords: insertedKeywords,
        count: insertedKeywords?.length || 0
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
