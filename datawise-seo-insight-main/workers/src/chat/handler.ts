import type { Env } from '../index';
import { getLLMProvider, type ChatMessage, type UserLLMConfig } from '../llm/provider';
import { detectPageUrl, fetchPageData, classifyPageType, analyzeBlogContent, analyzeServicePage, formatPageAnalysis, getTopPageUrls, getPageQueries } from './page-analyzer';

const SYSTEM_PROMPT = `You are a concise SEO analyst. The user's Google Search Console data is provided below. You have COMPLETE data. Answer every question directly from this data.

RULES:
- Answer the question asked. Lead with the number or fact. No filler, no hedging, no caveats about the data.
- For follow-up questions: answer ONLY what the user just asked. Do NOT recap, re-summarize, or repeat data from previous messages. The user already saw it. Jump straight into the new answer.
- The "Performance by Time Period" table has EXACT click/impression totals for 7-day, 30-day, and 90-day periods. Use these numbers directly.
- The "Top Queries (Last 7 Days)" table has the exact keyword breakdown for the last 7 days.
- The "Top 50 Queries" table has the keyword breakdown for the full data range.
- NEVER say the data is incomplete, unavailable, limited, or that you can't break it down. You have everything you need.
- NEVER tell the user to check GSC, export data, or look elsewhere. You ARE their data source.
- NEVER estimate or extrapolate. Every number you cite must come directly from the tables below.
- Keep responses short: 1-3 sentences for simple questions, brief bullet points for analysis.
- Use bold for key numbers and keyword names.
- For action items, give numbered steps that are specific and implementable.
- When PAGE ANALYSIS data is provided, use it to give specific, actionable recommendations. Reference exact metrics (word count, link counts, heading structure).
- For blog pages with low external links: recommend adding citations to back up claims. Be specific about which sections need them.
- For blog pages without content capsule structure: explain the technique (each H2 section should be 200-350 words, scannable with lists/bold, ending with a bold key takeaway).
- For service pages: prioritize CTA placement, trust signals, and schema markup.
- Always reference the GSC query data for the page to tie recommendations to ranking opportunities.

GLOSSARY: query = search term, clicks = site visits from Google, impressions = times shown in results, ctr = click-through rate, position = avg Google ranking (1 = top).`;

// POST /chat - Stream a chat response with GSC context
export async function handleChat(request: Request, env: Env, userId: string): Promise<Response> {
  const { message, conversation_id, property_id, llm_config } = await request.json() as {
    message: string;
    conversation_id?: string;
    property_id?: string;
    llm_config?: UserLLMConfig;
  };

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message required' }), { status: 400 });
  }

  // Get or create conversation
  let convId = conversation_id;
  if (!convId) {
    convId = crypto.randomUUID().replace(/-/g, '');
    const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
    await env.DB.prepare(
      'INSERT INTO chat_conversations (id, user_id, property_id, title) VALUES (?, ?, ?, ?)'
    ).bind(convId, userId, property_id || null, title).run();
  }

  // Save user message
  const userMsgId = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    'INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
  ).bind(userMsgId, convId, 'user', message).run();

  // Build message history
  const history = await env.DB.prepare(
    'SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 50'
  ).bind(convId).all();

  // Build the combined system prompt with GSC data inline
  let fullSystemPrompt = SYSTEM_PROMPT;

  if (property_id) {
    const gscContext = await buildGSCContext(env, userId, property_id);
    if (gscContext) {
      fullSystemPrompt += '\n\n' + gscContext;
    }

    // Page content analysis: detect URL in message, fetch and analyze the page
    const property = await env.DB.prepare(
      'SELECT site_url FROM gsc_properties WHERE id = ? AND user_id = ?'
    ).bind(property_id, userId).first();

    if (property?.site_url) {
      const topPages = await getTopPageUrls(env, property_id);
      const detectedUrl = detectPageUrl(message, property.site_url as string, topPages);
      if (detectedUrl) {
        try {
          const pageData = await fetchPageData(env, detectedUrl);
          if (pageData) {
            const pageType = classifyPageType(pageData);
            const analysis = pageType === 'blog'
              ? analyzeBlogContent(pageData)
              : analyzeServicePage(pageData);
            const pageQueries = await getPageQueries(env, property_id, detectedUrl);
            const pageContext = formatPageAnalysis(detectedUrl, pageType, analysis, pageQueries);
            fullSystemPrompt += '\n\n' + pageContext;
            console.log('Page analysis: fetched and analyzed', detectedUrl, 'as', pageType);
          }
        } catch (err) {
          console.error('Page analysis failed:', err);
        }
      }
    }
  }

  // Single system message with everything (important for Claude API)
  const messages: ChatMessage[] = [
    { role: 'system', content: fullSystemPrompt },
  ];

  // Add conversation history
  for (const msg of history.results || []) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content as string,
    });
  }

  console.log('Chat: property_id =', property_id, '| system prompt length =', fullSystemPrompt.length, '| history msgs =', (history.results || []).length);

  // Get LLM response as a stream (BYOK: user provides their own API key)
  const provider = getLLMProvider(env, llm_config);
  const stream = await provider.chat(messages, env, llm_config);

  // Tee the stream: one for the response, one for saving to DB
  const [responseStream, saveStream] = stream.tee();

  // Save assistant response in background
  saveStreamedResponse(saveStream, convId, env);

  // Update conversation timestamp
  await env.DB.prepare(
    'UPDATE chat_conversations SET updated_at = datetime("now") WHERE id = ?'
  ).bind(convId).run();

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Conversation-ID': convId,
    },
  });
}

// Save streamed response to DB after streaming completes
async function saveStreamedResponse(stream: ReadableStream, conversationId: string, env: Env): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullContent += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  if (fullContent) {
    const msgId = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      'INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
    ).bind(msgId, conversationId, 'assistant', fullContent).run();
  }
}

// Build GSC context as markdown tables (best format for LLM accuracy)
export { buildGSCContext as buildGSCContextDebug };
async function buildGSCContext(env: Env, userId: string, propertyId: string): Promise<string | null> {
  const property = await env.DB.prepare(
    'SELECT site_url FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(propertyId, userId).first();

  if (!property) return null;

  // Accurate period summaries from daily total rows (never truncated by API limits)
  const summary7d = await env.DB.prepare(`
    SELECT SUM(clicks) as clicks, SUM(impressions) as impressions, ROUND(AVG(position), 1) as avg_position
    FROM gsc_search_data WHERE property_id = ? AND query = '__daily_total__' AND date >= date('now', '-7 days')
  `).bind(propertyId).first();

  const summary30d = await env.DB.prepare(`
    SELECT SUM(clicks) as clicks, SUM(impressions) as impressions, ROUND(AVG(position), 1) as avg_position
    FROM gsc_search_data WHERE property_id = ? AND query = '__daily_total__' AND date >= date('now', '-30 days')
  `).bind(propertyId).first();

  const summary90d = await env.DB.prepare(`
    SELECT SUM(clicks) as clicks, SUM(impressions) as impressions, ROUND(AVG(position), 1) as avg_position
    FROM gsc_search_data WHERE property_id = ? AND query = '__daily_total__'
  `).bind(propertyId).first();

  // Weekly trend from daily totals
  const weeklyTrend = await env.DB.prepare(`
    SELECT strftime('%Y-W%W', date) as week, SUM(clicks) as clicks, SUM(impressions) as impressions
    FROM gsc_search_data WHERE property_id = ? AND query = '__daily_total__'
    GROUP BY week ORDER BY week DESC LIMIT 12
  `).bind(propertyId).all();

  // Top queries last 7 days (from dedicated 7-day query rows)
  const topQueries7d = await env.DB.prepare(`
    SELECT query, clicks, impressions,
           ROUND(position, 1) as position, ROUND(ctr * 100, 1) as ctr_pct
    FROM gsc_search_data WHERE property_id = ? AND page = '__7d_query__'
    ORDER BY clicks DESC LIMIT 20
  `).bind(propertyId).all();

  // Top queries last 30 days (from most recent 30-day batch)
  const topQueries30d = await env.DB.prepare(`
    SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as position, ROUND(AVG(ctr) * 100, 1) as ctr_pct
    FROM gsc_search_data WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY query ORDER BY clicks DESC LIMIT 50
  `).bind(propertyId).all();

  // Top pages (from query+page batch data)
  const topPages = await env.DB.prepare(`
    SELECT page, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as position
    FROM gsc_search_data WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY page ORDER BY clicks DESC LIMIT 20
  `).bind(propertyId).all();

  // Striking distance opportunities
  const opportunities = await env.DB.prepare(`
    SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as position, ROUND(AVG(ctr) * 100, 1) as ctr_pct
    FROM gsc_search_data WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY query
    HAVING AVG(position) BETWEEN 4 AND 15 AND SUM(impressions) > 30
    ORDER BY impressions DESC LIMIT 30
  `).bind(propertyId).all();

  // Low CTR keywords
  const lowCtr = await env.DB.prepare(`
    SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as position, ROUND(AVG(ctr) * 100, 1) as ctr_pct
    FROM gsc_search_data WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY query
    HAVING SUM(impressions) > 100 AND AVG(ctr) < 0.02
    ORDER BY impressions DESC LIMIT 20
  `).bind(propertyId).all();

  // Count unique queries/pages from query-level data
  const queryCounts = await env.DB.prepare(`
    SELECT COUNT(DISTINCT query) as total_queries, COUNT(DISTINCT page) as total_pages
    FROM gsc_search_data WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
  `).bind(propertyId).first();

  // Build markdown context
  let ctx = `---\n## GSC DATA FOR: ${property.site_url}\n\n`;

  ctx += `### Performance by Time Period (exact daily totals)\n`;
  ctx += `| Period | Clicks | Impressions | Avg Position |\n`;
  ctx += `|--------|--------|-------------|-------------|\n`;
  ctx += `| Last 7 days | ${summary7d?.clicks || 0} | ${summary7d?.impressions || 0} | ${summary7d?.avg_position || 'N/A'} |\n`;
  ctx += `| Last 30 days | ${summary30d?.clicks || 0} | ${summary30d?.impressions || 0} | ${summary30d?.avg_position || 'N/A'} |\n`;
  ctx += `| Last 90 days | ${summary90d?.clicks || 0} | ${summary90d?.impressions || 0} | ${summary90d?.avg_position || 'N/A'} |\n`;
  ctx += `- **Unique Queries**: ${queryCounts?.total_queries || 0} | **Unique Pages**: ${queryCounts?.total_pages || 0}\n\n`;

  ctx += `### Weekly Trend\n`;
  ctx += `| Week | Clicks | Impressions |\n`;
  ctx += `|------|--------|-------------|\n`;
  for (const w of weeklyTrend.results || []) {
    ctx += `| ${w.week} | ${w.clicks} | ${w.impressions} |\n`;
  }

  ctx += `\n### Top Queries (Last 7 Days)\n\n`;
  ctx += `| Query | Clicks | Impressions | CTR% | Position |\n`;
  ctx += `|-------|--------|-------------|------|----------|\n`;
  for (const q of topQueries7d.results || []) {
    ctx += `| ${q.query} | ${q.clicks} | ${q.impressions} | ${q.ctr_pct}% | ${q.position} |\n`;
  }

  ctx += `\n### Top 50 Queries (Last 90 Days)\n\n`;
  ctx += `| Query | Clicks | Impressions | CTR% | Position |\n`;
  ctx += `|-------|--------|-------------|------|----------|\n`;
  for (const q of topQueries30d.results || []) {
    ctx += `| ${q.query} | ${q.clicks} | ${q.impressions} | ${q.ctr_pct}% | ${q.position} |\n`;
  }

  ctx += `\n### Top 20 Pages\n\n`;
  ctx += `| Page | Clicks | Impressions | Position |\n`;
  ctx += `|------|--------|-------------|----------|\n`;
  for (const p of topPages.results || []) {
    const shortPage = (p.page as string).replace(property.site_url as string, '/');
    ctx += `| ${shortPage} | ${p.clicks} | ${p.impressions} | ${p.position} |\n`;
  }

  if ((opportunities.results || []).length > 0) {
    ctx += `\n### Striking Distance Opportunities (Position 4-15, 30+ Impressions)\n`;
    ctx += `These keywords are close to page 1 and worth optimizing.\n\n`;
    ctx += `| Query | Clicks | Impressions | CTR% | Position |\n`;
    ctx += `|-------|--------|-------------|------|----------|\n`;
    for (const o of opportunities.results || []) {
      ctx += `| ${o.query} | ${o.clicks} | ${o.impressions} | ${o.ctr_pct}% | ${o.position} |\n`;
    }
  }

  if ((lowCtr.results || []).length > 0) {
    ctx += `\n### Low CTR Keywords (100+ Impressions, <2% CTR)\n`;
    ctx += `These keywords get visibility but poor click-through. Improve titles/descriptions.\n\n`;
    ctx += `| Query | Clicks | Impressions | CTR% | Position |\n`;
    ctx += `|-------|--------|-------------|------|----------|\n`;
    for (const lc of lowCtr.results || []) {
      ctx += `| ${lc.query} | ${lc.clicks} | ${lc.impressions} | ${lc.ctr_pct}% | ${lc.position} |\n`;
    }
  }

  ctx += `\n---`;

  return ctx;
}

// GET /chat/conversations - List user's conversations
export async function handleListConversations(env: Env, userId: string): Promise<Response> {
  const conversations = await env.DB.prepare(`
    SELECT c.id, c.title, c.property_id, c.updated_at, p.site_url as property_url
    FROM chat_conversations c
    LEFT JOIN gsc_properties p ON c.property_id = p.id
    WHERE c.user_id = ?
    ORDER BY c.updated_at DESC LIMIT 50
  `).bind(userId).all();

  return new Response(JSON.stringify({ conversations: conversations.results }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /chat/conversations/:id - Load conversation with messages
export async function handleGetConversation(env: Env, userId: string, conversationId: string): Promise<Response> {
  const conversation = await env.DB.prepare(
    'SELECT id, title, property_id, created_at FROM chat_conversations WHERE id = ? AND user_id = ?'
  ).bind(conversationId, userId).first();

  if (!conversation) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  const messages = await env.DB.prepare(
    'SELECT id, role, content, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).bind(conversationId).all();

  return new Response(JSON.stringify({
    conversation,
    messages: messages.results,
  }), { headers: { 'Content-Type': 'application/json' } });
}
