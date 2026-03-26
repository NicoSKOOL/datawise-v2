import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Function to make a single DataForSEO API call
async function makeDataForSEOCall(searchKeyword: string, location: string, language: string, auth: string) {
  const requestData = [{
    keyword: searchKeyword,
    location_code: parseInt(location),
    language_code: language,
    device: "desktop",
    os: "windows",
    people_also_ask_click_depth: 4
  }];

  console.log(`Making DataForSEO API request for "${searchKeyword}" with maximum click depth`);

  const response = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`DataForSEO API error for "${searchKeyword}":`, response.status, errorText);
    throw new Error(`DataForSEO API error: ${response.status}`);
  }

  const result = await response.json();
  console.log(`DataForSEO API response for "${searchKeyword}":`, result.status_message);
  
  if (result.status_code !== 20000) {
    throw new Error(`DataForSEO API error: ${result.status_message}`);
  }

  return result.tasks?.[0]?.result?.[0]?.items || [];
}

// Extract seed keywords from PAA questions for iterative searching
function extractSeedKeywords(questions: string[], originalKeyword: string): string[] {
  const seeds = new Set<string>();
  
  questions.forEach(question => {
    // Extract key phrases from questions
    const words = question.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['what', 'how', 'why', 'when', 'where', 'does', 'will', 'can', 'should'].includes(word));
    
    // Create 2-3 word combinations
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = words.slice(i, i + 2).join(' ');
      if (phrase.length > 6 && phrase !== originalKeyword.toLowerCase()) {
        seeds.add(phrase);
      }
    }
  });
  
  return Array.from(seeds).slice(0, 5); // Limit to 5 seed keywords per iteration
}

// Enhanced data processing with deduplication
function processResults(results: any[], keyword: string, iteration: number) {
  const formattedData: any[] = [];
  let position = 1;

  // Process People Also Ask items with depth tracking
  const paaItems = results.filter((item: any) => item.type === 'people_also_ask');
  console.log(`Iteration ${iteration}: Found ${paaItems.length} People Also Ask items`);
  
  paaItems.forEach((paaItem: any) => {
    if (paaItem.items && Array.isArray(paaItem.items)) {
      paaItem.items.forEach((question: any) => {
        formattedData.push({
          position: position++,
          source_type: 'people_also_ask',
          question: question.title || question.question || '',
          answer: question.snippet || question.answer || '',
          source_url: question.url || '',
          source_domain: question.domain || (question.url ? new URL(question.url).hostname : ''),
          search_iteration: iteration,
          depth_level: question.depth || 1,
        });
      });
    }
  });

  // Process Answer Box items
  const answerBoxItems = results.filter((item: any) => item.type === 'answer_box');
  console.log(`Iteration ${iteration}: Found ${answerBoxItems.length} Answer Box items`);
  
  answerBoxItems.forEach((item: any) => {
    if (item.text) {
      formattedData.push({
        position: position++,
        source_type: 'answer_box',
        question: `What is ${keyword}?`,
        answer: item.text,
        source_url: item.url || '',
        source_domain: item.domain || (item.url ? new URL(item.url).hostname : ''),
        search_iteration: iteration,
        depth_level: 1,
      });
    }
  });

  // Process Featured Snippet items
  const featuredSnippets = results.filter((item: any) => item.type === 'featured_snippet');
  console.log(`Iteration ${iteration}: Found ${featuredSnippets.length} Featured Snippet items`);
  
  featuredSnippets.forEach((item: any) => {
    if (item.description) {
      formattedData.push({
        position: position++,
        source_type: 'featured_snippet',
        question: `What is ${keyword}?`,
        answer: item.description,
        source_url: item.url || '',
        source_domain: item.domain || (item.url ? new URL(item.url).hostname : ''),
        search_iteration: iteration,
        depth_level: 1,
      });
    }
  });

  // Process Related Searches and convert to questions
  const relatedSearches = results.filter((item: any) => item.type === 'related_searches');
  console.log(`Iteration ${iteration}: Found ${relatedSearches.length} Related Searches sections`);
  
  relatedSearches.forEach((item: any) => {
    if (item.items && Array.isArray(item.items)) {
      item.items.forEach((search: any) => {
        const searchQuery = search.query || search.title || '';
        if (searchQuery) {
          let question = '';
          if (searchQuery.toLowerCase().includes('how')) {
            question = searchQuery;
          } else if (searchQuery.toLowerCase().includes('what')) {
            question = searchQuery;
          } else if (searchQuery.toLowerCase().includes('why')) {
            question = searchQuery;
          } else if (searchQuery.toLowerCase().includes('when')) {
            question = searchQuery;
          } else if (searchQuery.toLowerCase().includes('where')) {
            question = searchQuery;
          } else {
            question = `What about ${searchQuery}?`;
          }
          
          formattedData.push({
            position: position++,
            source_type: 'related_search',
            question: question,
            answer: `Related search suggestion for: ${searchQuery}`,
            source_url: '',
            source_domain: 'Google Related Searches',
            search_iteration: iteration,
            depth_level: 1,
          });
        }
      });
    }
  });

  // Process Knowledge Graph items
  const knowledgeGraph = results.filter((item: any) => item.type === 'knowledge_graph');
  console.log(`Iteration ${iteration}: Found ${knowledgeGraph.length} Knowledge Graph items`);
  
  knowledgeGraph.forEach((item: any) => {
    if (item.description) {
      formattedData.push({
        position: position++,
        source_type: 'knowledge_graph',
        question: `What is ${item.title || keyword}?`,
        answer: item.description,
        source_url: item.url || '',
        source_domain: item.source || 'Knowledge Graph',
        search_iteration: iteration,
        depth_level: 1,
      });
    }
  });

  return formattedData;
}

// Semantic deduplication based on question similarity
function deduplicateQuestions(allData: any[]): any[] {
  const uniqueQuestions = new Map<string, any>();
  
  allData.forEach(item => {
    const normalizedQuestion = item.question.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Keep the item with the most detailed answer or from the most authoritative source
    if (!uniqueQuestions.has(normalizedQuestion) || 
        (item.answer.length > uniqueQuestions.get(normalizedQuestion).answer.length)) {
      uniqueQuestions.set(normalizedQuestion, item);
    }
  });
  
  return Array.from(uniqueQuestions.values())
    .sort((a, b) => a.position - b.position)
    .map((item, index) => ({ ...item, position: index + 1 }));
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
      tool: 'people-also-ask'
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

    const { keyword, location = "2840", language = "en" } = await req.json();
    
    console.log('Enhanced People Also Ask request:', { 
      keyword, 
      location, 
      language, 
      strategy: 'iterative_search_with_maximum_click_depth' 
    });

    if (!keyword) {
      throw new Error('Keyword is required');
    }

    const email = Deno.env.get('DATAFORSEO_EMAIL');
    const password = Deno.env.get('DATAFORSEO_PASSWORD');
    
    if (!email || !password) {
      throw new Error('DataForSEO credentials not configured');
    }

    const auth = btoa(`${email}:${password}`);
    
    // Track all keywords searched and results
    const searchedKeywords = new Set([keyword.toLowerCase()]);
    const allData: any[] = [];
    let totalApiCalls = 0;
    const maxIterations = 3;
    
    // Initial search with the main keyword
    console.log(`Starting iteration 1 with keyword: "${keyword}"`);
    const initialResults = await makeDataForSEOCall(keyword, location, language, auth);
    totalApiCalls++;
    
    const initialData = processResults(initialResults, keyword, 1);
    allData.push(...initialData);
    
    // Extract questions for seed keyword generation
    const paaQuestions = initialData
      .filter(item => item.source_type === 'people_also_ask')
      .map(item => item.question);
    
    console.log(`Initial search found ${initialData.length} items, ${paaQuestions.length} PAA questions for seed generation`);
    
    // Iterative searching with seed keywords from PAA questions
    for (let iteration = 2; iteration <= maxIterations && paaQuestions.length > 0; iteration++) {
      const seedKeywords = extractSeedKeywords(paaQuestions, keyword);
      console.log(`Iteration ${iteration}: Generated ${seedKeywords.length} seed keywords:`, seedKeywords);
      
      if (seedKeywords.length === 0) break;
      
      // Search with the first unsearched seed keyword
      const newKeyword = seedKeywords.find(seed => !searchedKeywords.has(seed.toLowerCase()));
      
      if (!newKeyword) {
        console.log(`Iteration ${iteration}: No new keywords to search`);
        break;
      }
      
      searchedKeywords.add(newKeyword.toLowerCase());
      console.log(`Iteration ${iteration}: Searching with seed keyword: "${newKeyword}"`);
      
      try {
        const iterationResults = await makeDataForSEOCall(newKeyword, location, language, auth);
        totalApiCalls++;
        
        const iterationData = processResults(iterationResults, newKeyword, iteration);
        allData.push(...iterationData);
        
        // Add new PAA questions to the pool for potential future iterations
        const newPaaQuestions = iterationData
          .filter(item => item.source_type === 'people_also_ask')
          .map(item => item.question);
        
        paaQuestions.push(...newPaaQuestions);
        
        console.log(`Iteration ${iteration}: Found ${iterationData.length} additional items`);
      } catch (error) {
        console.error(`Iteration ${iteration} failed for keyword "${newKeyword}":`, error);
        // Continue with next iteration even if one fails
      }
    }
    
    // Deduplicate and finalize data
    console.log(`Raw data collected: ${allData.length} items from ${totalApiCalls} API calls`);
    const deduplicatedData = deduplicateQuestions(allData);
    console.log(`After deduplication: ${deduplicatedData.length} unique items`);

    // Generate comprehensive statistics
    const sourceStats = deduplicatedData.reduce((acc: any, item: any) => {
      acc[item.source_type] = (acc[item.source_type] || 0) + 1;
      return acc;
    }, {});

    const iterationStats = deduplicatedData.reduce((acc: any, item: any) => {
      acc[`iteration_${item.search_iteration}`] = (acc[`iteration_${item.search_iteration}`] || 0) + 1;
      return acc;
    }, {});

    const estimatedCost = totalApiCalls * 0.0006; // $0.00015 per click × 4 clicks per call

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: deduplicatedData,
        total_questions: deduplicatedData.length,
        source_stats: sourceStats,
        iteration_stats: iterationStats,
        extraction_method: 'iterative_search_with_maximum_click_depth',
        clicks_simulated: 4,
        api_calls_made: totalApiCalls,
        keywords_searched: Array.from(searchedKeywords),
        estimated_cost: estimatedCost,
        keyword: keyword,
        location: location,
        language: language
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('Error in enhanced people-also-ask function:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        success: false 
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
})
