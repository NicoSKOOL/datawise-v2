import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: creditDeducted, error: creditError } = await adminClient.rpc(
      'deduct_credit',
      { user_uuid: user.id, tool: 'google-ai-mode' }
    );

    if (creditError || !creditDeducted) {
      console.error('Credit deduction error:', creditError);
      return new Response(
        JSON.stringify({ error: 'Insufficient credits or credit deduction failed' }),
        {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { keyword, location_name, device = 'desktop', os = 'windows' } = await req.json();

    if (!keyword) {
      return new Response(JSON.stringify({ error: 'Keyword is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const username = Deno.env.get('DATAFORSEO_EMAIL');
    const password = Deno.env.get('DATAFORSEO_PASSWORD');
    const credentials = btoa(`${username}:${password}`);

    const dataForSEORequest = [{
      language_name: "English",
      location_name: location_name || "United States",
      keyword: keyword,
      device: device,
      os: os
    }];

    console.log('DataForSEO AI Mode Request:', JSON.stringify(dataForSEORequest, null, 2));

    const response = await fetch('https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dataForSEORequest),
    });

    const data = await response.json();
    console.log('DataForSEO AI Mode Response:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error('DataForSEO API Error:', data);
      return new Response(JSON.stringify({ error: 'Failed to fetch AI Mode data', details: data }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in google-ai-mode function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
