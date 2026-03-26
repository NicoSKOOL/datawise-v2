import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      my_domain,
      competitor_domain,
      both_ranking,
      gaps,
      advantages
    } = await req.json();

    console.log('Generating AI analysis for:', my_domain, 'vs', competitor_domain);

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ 
        error: 'AI service not configured',
        details: 'LOVABLE_API_KEY is not set'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build analysis prompt with keyword data
    const prompt = `You are an expert SEO strategist analyzing keyword gap data for competitive analysis.

**Your Domain:** ${my_domain}
**Competitor:** ${competitor_domain}

**Data Summary:**
- Shared Keywords (both ranking): ${both_ranking?.length || 0}
- Keyword Gaps (competitor has, you don't): ${gaps?.length || 0}
- Your Advantages (you have, competitor doesn't): ${advantages?.length || 0}

**Top Keyword Gaps (Opportunities):**
${gaps?.slice(0, 10).map((k: any, i: number) => 
  `${i + 1}. "${k.keyword}" - ${k.search_volume?.toLocaleString() || 0} monthly searches, $${k.cpc?.toFixed(2) || 0} CPC, ${Math.round(k.competition * 100)}% competition`
).join('\n') || 'No gaps found'}

**Top Shared Keywords (Competitive Overlap):**
${both_ranking?.slice(0, 5).map((k: any, i: number) => 
  `${i + 1}. "${k.keyword}" - You: #${k.my_position || '?'}, Competitor: #${k.competitor_position || '?'}, ${k.search_volume?.toLocaleString() || 0} searches`
).join('\n') || 'No shared keywords'}

**Your Unique Advantages:**
${advantages?.slice(0, 5).map((k: any, i: number) => 
  `${i + 1}. "${k.keyword}" - Position #${k.my_position || '?'}, ${k.search_volume?.toLocaleString() || 0} searches`
).join('\n') || 'No unique advantages found'}

Please provide a strategic SEO analysis with these sections:

## 🎯 Key Opportunities
Identify the top 3-5 most actionable keyword opportunities from the gaps data. Focus on keywords with good search volume, manageable competition, and clear commercial intent.

## 📊 Competitive Analysis
Compare the competitive landscape. What are the competitor's strengths? Where are your advantages? What does the overlap tell us about market positioning?

## 🚀 Priority Recommendations
Which keywords should be targeted first and why? Consider search volume, competition level, relevance, and existing rankings.

## 💡 Market Insights
What do the search volumes, CPC values, and competition levels tell us about this market? Are there trends or patterns worth noting?

## ✅ Action Items
Provide 3-5 specific, actionable next steps to capitalize on these insights.

Keep the analysis strategic, actionable, and focused on business impact.`;

    console.log('Calling Lovable AI Gateway...');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { 
            role: "system", 
            content: "You are an expert SEO strategist providing actionable insights based on keyword gap analysis data." 
          },
          { 
            role: "user", 
            content: prompt
          }
        ]
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Gateway error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ 
          error: 'Rate limits exceeded',
          details: 'Too many AI analysis requests. Please try again later.'
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ 
          error: 'Payment required',
          details: 'Please add funds to your Lovable AI workspace to continue using AI analysis.'
        }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify({ 
        error: 'AI service error',
        details: 'Failed to generate analysis'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const aiData = await aiResponse.json();
    const analysis = aiData.choices?.[0]?.message?.content || 'No analysis generated';

    console.log('AI analysis generated successfully');

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in keyword-analysis-ai function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: 'An unexpected error occurred during AI analysis'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});