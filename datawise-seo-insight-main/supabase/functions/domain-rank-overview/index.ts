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
      tool: 'domain-rank-overview'
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

    const { target, targets, location_code = 2840, language_code = 'en' } = await req.json();
    
    // Accept either single target or multiple targets
    const inputTargets = targets || (target ? [target] : []);
    
    if (!inputTargets || inputTargets.length === 0) {
      return new Response(JSON.stringify({ error: 'At least one target domain is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (inputTargets.length > 5) {
      return new Response(JSON.stringify({ error: 'Maximum 5 domains allowed for comparison' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Sanitize domain input - remove protocol, www, trailing slashes/paths
    const sanitizeDomain = (domain: string): string => {
      let cleanDomain = domain.trim().toLowerCase();
      
      // Remove protocol
      cleanDomain = cleanDomain.replace(/^https?:\/\//, '');
      
      // Remove www prefix
      cleanDomain = cleanDomain.replace(/^www\./, '');
      
      // Remove trailing slash and everything after it (paths, query params, etc.)
      cleanDomain = cleanDomain.split('/')[0];
      
      // Remove any remaining query parameters or fragments
      cleanDomain = cleanDomain.split('?')[0].split('#')[0];
      
      return cleanDomain;
    };

    const cleanTargets = inputTargets.map(sanitizeDomain);
    
    // Basic domain validation for all targets
    for (const cleanTarget of cleanTargets) {
      if (!cleanTarget || !cleanTarget.includes('.') || cleanTarget.length < 3) {
        return new Response(JSON.stringify({ error: `Invalid domain format: ${cleanTarget}. Please provide a valid domain (e.g., example.com)` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    console.log('Processing domain rank overview for:', inputTargets);
    console.log('Sanitized domains:', cleanTargets);

    const email = Deno.env.get('DATAFORSEO_EMAIL');
    const password = Deno.env.get('DATAFORSEO_PASSWORD');
    
    const credentials = btoa(`${email}:${password}`);
    
    // Create request body with multiple targets
    const requestBody = cleanTargets.map((cleanTarget: string) => ({
      target: cleanTarget,
      location_code: location_code,
      language_code: language_code
    }));

    console.log('Making request to DataForSEO API...');
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    
    // Make separate API calls for each domain since the API only accepts one at a time
    const results = await Promise.all(
      requestBody.map(async (singleRequest: { target: string; location_code: number; language_code: string }, index: number) => {
        try {
          console.log(`Making request ${index + 1}/${requestBody.length} for domain: ${singleRequest.target}`);
          
          const response = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live', {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify([singleRequest])
          });

          const data = await response.json();
          console.log(`API Response ${index + 1} status:`, response.status);
          console.log(`API Response ${index + 1} data:`, JSON.stringify(data, null, 2));

          if (!response.ok) {
            console.error(`API Error for domain ${singleRequest.target}:`, data);
            return {
              error: true,
              domain: singleRequest.target,
              details: data
            };
          }

          return {
            error: false,
            domain: singleRequest.target,
            data: data
          };
        } catch (error) {
          console.error(`Error for domain ${singleRequest.target}:`, error);
          return {
            error: true,
            domain: singleRequest.target,
            details: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    // Combine all results into a single response format
    const combinedResponse = {
      version: "0.1.20250922",
      status_code: 20000,
      status_message: "Ok.",
      time: "combined",
      cost: 0,
      tasks_count: requestBody.length,
      tasks_error: results.filter(r => r.error).length,
      tasks: results.map((result: any, index: number) => {
        if (result.error) {
          return {
            id: `error-${index}`,
            status_code: 40000,
            status_message: typeof result.details === 'string' ? result.details : 'API Error',
            time: "0 sec.",
            cost: 0,
            result_count: 0,
            path: ["v3", "dataforseo_labs", "google", "domain_rank_overview", "live"],
            data: {
              api: "dataforseo_labs",
              function: "domain_rank_overview",
              se_type: "google",
              target: result.domain,
              location_code: location_code,
              language_code: language_code
            },
            result: null
          };
        } else {
          // Return the successful task from the API response
          return result.data.tasks[0];
        }
      })
    };

    return new Response(JSON.stringify(combinedResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in domain-rank-overview function:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});