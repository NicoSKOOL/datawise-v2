import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Globe, Upload, Play, Square, Copy, Download, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Loader2, AlertCircle, FileText, Search,
  Clock, LinkIcon, ExternalLink, AlignLeft, Shield, MousePointerClick,
  Heading, MapPin, Tag, Code, MessageSquare, Lightbulb,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useToast } from '@/hooks/use-toast';
import { getLLMConfig } from '@/lib/chat';
import {
  discoverSitemap, fetchPost, analyzePost, rewritePost,
  fetchServicePage, analyzeServicePage, generateSection,
  type SitePage, type PostData, type AuditResult, type UsageInfo,
  type ServicePageData, type ServicePageAnalysis,
} from '@/lib/content-tools';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type PostStatus = 'pending' | 'fetching' | 'auditing' | 'rewriting' | 'done' | 'error';

interface ProcessedPost {
  url: string;
  status: PostStatus;
  statusMessage: string;
  post?: PostData;
  audit?: AuditResult;
  rewritten?: string;
  usageAudit?: UsageInfo;
  usageRewrite?: UsageInfo;
  error?: string;
  wordCountAfter?: number;
}

/**
 * Convert markdown to HTML and copy as rich text so it pastes correctly
 * into Google Docs, WordPress, and other CMS tools.
 */
async function copyAsRichText(markdown: string, toast: ReturnType<typeof useToast>['toast'], label?: string) {
  // Convert markdown to HTML
  const html = markdownToHtml(markdown);

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      }),
    ]);
  } catch {
    // Fallback for browsers that don't support ClipboardItem
    await navigator.clipboard.writeText(markdown);
  }

  toast({ title: 'Copied', description: label ? `${label} copied to clipboard` : 'Content copied as formatted text' });
}

/** Minimal markdown-to-HTML converter for clipboard use */
function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML entities first
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks (before other processing)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Unordered lists (process groups of - lines)
  html = html.replace(/(^- .+$(\n- .+$)*)/gm, (match) => {
    const items = match.split('\n').map(line => `<li>${line.replace(/^- /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/(^\d+\. .+$(\n\d+\. .+$)*)/gm, (match) => {
    const items = match.split('\n').map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Blockquotes
  html = html.replace(/(^&gt; .+$(\n&gt; .+$)*)/gm, (match) => {
    const content = match.replace(/^&gt; /gm, '');
    return `<blockquote>${content}</blockquote>`;
  });

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((\|.+\|\n?)+)/gm, (_match, headerRow, _sep, bodyRows) => {
    const headers = headerRow.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
    const rows = bodyRows.trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Paragraphs: wrap remaining lines that aren't already in HTML tags
  html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p>$1</p>');

  // Clean up double line breaks
  html = html.replace(/\n{2,}/g, '\n');

  return html;
}

function parseUrlsFromText(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map(line => line.trim())
    .filter(line => line.startsWith('http://') || line.startsWith('https://'));
}

function parseGSCCsv(text: string): string[] {
  const lines = text.split('\n');
  const urls: string[] = [];
  for (const line of lines) {
    const cols = line.split(',');
    for (const col of cols) {
      const trimmed = col.trim().replace(/^"/, '').replace(/"$/, '');
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        urls.push(trimmed);
        break;
      }
    }
  }
  return urls;
}

function countMarkdownWords(md: string): number {
  const text = md.replace(/[#*\[\]()_`>-]/g, ' ').replace(/https?:\/\/\S+/g, '');
  return text.split(/\s+/).filter(Boolean).length;
}

function verdictColor(verdict: string): string {
  switch (verdict) {
    case 'thin': return 'bg-red-500/10 text-red-600';
    case 'average': return 'bg-yellow-500/10 text-yellow-600';
    case 'good': return 'bg-green-500/10 text-green-600';
    default: return 'bg-muted text-muted-foreground';
  }
}

function contentScoreColor(score: string): string {
  switch (score) {
    case 'thin': return 'bg-red-500/10 text-red-600';
    case 'adequate': return 'bg-yellow-500/10 text-yellow-600';
    case 'comprehensive': return 'bg-green-500/10 text-green-600';
    default: return 'bg-muted text-muted-foreground';
  }
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'high': return 'bg-red-500/10 text-red-600';
    case 'medium': return 'bg-yellow-500/10 text-yellow-600';
    case 'low': return 'bg-blue-500/10 text-blue-600';
    default: return 'bg-muted text-muted-foreground';
  }
}

// ---------------------------------------------------------------------------
// Content Revival (formerly blog revival)
// ---------------------------------------------------------------------------

function ContentRevival() {
  const { toast } = useToast();
  const [domain, setDomain] = useState('');
  const [urlsText, setUrlsText] = useState('');
  const [inputMode, setInputMode] = useState<'paste' | 'csv'>('paste');
  const [sitePages, setSitePages] = useState<SitePage[]>([]);
  const [sitemapStatus, setSitemapStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [posts, setPosts] = useState<ProcessedPost[]>([]);
  const [processing, setProcessing] = useState(false);
  const [expandedPosts, setExpandedPosts] = useState<Set<number>>(new Set());
  const stopRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalUsage = posts.reduce((acc, p) => ({
    input: acc.input + (p.usageAudit?.input_tokens || 0) + (p.usageRewrite?.input_tokens || 0),
    output: acc.output + (p.usageAudit?.output_tokens || 0) + (p.usageRewrite?.output_tokens || 0),
  }), { input: 0, output: 0 });

  const donePosts = posts.filter(p => p.status === 'done').length;
  const progressPercent = posts.length > 0 ? (donePosts / posts.length) * 100 : 0;

  const handleDiscoverSitemap = async () => {
    if (!domain.trim()) return;
    setSitemapStatus('loading');
    try {
      const result = await discoverSitemap(domain.trim());
      setSitePages(result.pages);
      setSitemapStatus('done');
      toast({ title: 'Sitemap discovered', description: `Found ${result.pages.length} pages` });
    } catch (err) {
      setSitemapStatus('error');
      toast({ variant: 'destructive', title: 'Sitemap error', description: err instanceof Error ? err.message : 'Failed' });
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const urls = parseGSCCsv(text);
      setUrlsText(urls.join('\n'));
      toast({ title: 'CSV loaded', description: `Found ${urls.length} URLs` });
    };
    reader.readAsText(file);
  };

  const updatePost = useCallback((index: number, update: Partial<ProcessedPost>) => {
    setPosts(prev => prev.map((p, i) => i === index ? { ...p, ...update } : p));
  }, []);

  const handleRun = async () => {
    const config = getLLMConfig();
    if (!config) {
      toast({ variant: 'destructive', title: 'No API key', description: 'Add your LLM API key in Settings first.' });
      return;
    }

    const urls = parseUrlsFromText(urlsText);
    if (urls.length === 0) {
      toast({ variant: 'destructive', title: 'No URLs', description: 'Paste at least one URL to process.' });
      return;
    }

    const domainStr = domain.trim();

    if (sitePages.length === 0 && domainStr) {
      setSitemapStatus('loading');
      try {
        const result = await discoverSitemap(domainStr);
        setSitePages(result.pages);
        setSitemapStatus('done');
      } catch {
        setSitemapStatus('error');
      }
    }

    stopRef.current = false;
    setProcessing(true);
    setExpandedPosts(new Set());

    const initialPosts: ProcessedPost[] = urls.map(url => ({
      url,
      status: 'pending',
      statusMessage: 'Waiting...',
    }));
    setPosts(initialPosts);

    for (let i = 0; i < urls.length; i++) {
      if (stopRef.current) break;

      updatePost(i, { status: 'fetching', statusMessage: 'Fetching page content...' });
      let postData: PostData;
      try {
        postData = await fetchPost(urls[i]);
        if (postData.error) {
          updatePost(i, { status: 'error', statusMessage: postData.error, error: postData.error });
          continue;
        }
        updatePost(i, { post: postData });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Fetch failed';
        updatePost(i, { status: 'error', statusMessage: msg, error: msg });
        continue;
      }

      if (stopRef.current) break;

      updatePost(i, { status: 'auditing', statusMessage: 'Running SEO audit...' });
      let currentAudit: AuditResult;
      try {
        const auditResult = await analyzePost(
          { title: postData.title, body_text: postData.body_text, word_count: postData.word_count },
          sitePages,
          domainStr,
        );
        currentAudit = auditResult.audit;
        updatePost(i, { audit: currentAudit, usageAudit: auditResult.usage });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Audit failed';
        updatePost(i, { status: 'error', statusMessage: msg, error: msg });
        continue;
      }

      if (stopRef.current) break;

      updatePost(i, { status: 'rewriting', statusMessage: 'Rewriting post...' });
      try {
        const rewriteResult = await rewritePost(
          { title: postData.title, body_text: postData.body_text },
          currentAudit,
          sitePages,
          domainStr,
        );

        const wordCountAfter = countMarkdownWords(rewriteResult.rewritten);
        updatePost(i, {
          status: 'done',
          statusMessage: 'Complete',
          rewritten: rewriteResult.rewritten,
          usageRewrite: rewriteResult.usage,
          wordCountAfter,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Rewrite failed';
        updatePost(i, { status: 'error', statusMessage: msg, error: msg });
      }
    }

    setProcessing(false);
  };

  const handleStop = () => {
    stopRef.current = true;
  };

  const toggleExpanded = (index: number) => {
    setExpandedPosts(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleCopy = async (text: string) => {
    await copyAsRichText(text, toast);
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    const donePosts2 = posts.filter(p => p.status === 'done' && p.rewritten);
    if (donePosts2.length === 0) return;
    for (const p of donePosts2) {
      const slug = p.post?.slug || 'post';
      handleDownload(`${slug}-rewritten.md`, p.rewritten!);
    }
  };

  const statusIcon = (status: PostStatus) => {
    switch (status) {
      case 'pending': return <div className="h-4 w-4 rounded-full bg-muted" />;
      case 'fetching':
      case 'auditing':
      case 'rewriting': return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'done': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="space-y-2">
          <Label>Domain</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={domain}
                onChange={e => setDomain(e.target.value)}
                placeholder="example.com"
                className="pl-10"
              />
            </div>
            <Button
              variant="outline"
              onClick={handleDiscoverSitemap}
              disabled={!domain.trim() || sitemapStatus === 'loading'}
            >
              {sitemapStatus === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <FileText className="h-4 w-4 mr-1.5" />
              )}
              {sitemapStatus === 'done' ? `${sitePages.length} pages` : 'Discover Sitemap'}
            </Button>
          </div>
          {sitemapStatus === 'error' && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Could not find sitemap. Internal links will be skipped.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Label>URLs to Process</Label>
            <div className="flex gap-1">
              <button
                onClick={() => setInputMode('paste')}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${inputMode === 'paste' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
              >
                Paste
              </button>
              <button
                onClick={() => { setInputMode('csv'); fileInputRef.current?.click(); }}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${inputMode === 'csv' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
              >
                <Upload className="h-3 w-3 inline mr-1" />
                CSV
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleCsvUpload}
          />
          <Textarea
            value={urlsText}
            onChange={e => setUrlsText(e.target.value)}
            placeholder="https://example.com/blog/post-1&#10;https://example.com/blog/post-2&#10;https://example.com/blog/post-3"
            rows={5}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            One URL per line. Tip: export "Crawled, currently not indexed" URLs from GSC Coverage report.
          </p>
        </div>

        <div className="flex gap-2">
          {!processing ? (
            <Button onClick={handleRun} disabled={!urlsText.trim()}>
              <Play className="h-4 w-4 mr-1.5" />
              Run Analysis & Rewrite
            </Button>
          ) : (
            <Button variant="destructive" onClick={handleStop}>
              <Square className="h-4 w-4 mr-1.5" />
              Stop
            </Button>
          )}
        </div>
      </div>

      {posts.length > 0 && (
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {processing ? 'Processing...' : 'Results'}
            </h2>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{donePosts} / {posts.length} done</span>
              <span>{(totalUsage.input + totalUsage.output).toLocaleString()} tokens</span>
            </div>
          </div>

          {processing && (
            <Progress value={progressPercent} className="h-2" />
          )}

          {processing && (
            <div className="space-y-1.5">
              {posts.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {statusIcon(p.status)}
                  <span className="truncate flex-1 font-mono text-xs">{p.url}</span>
                  <span className="text-muted-foreground text-xs whitespace-nowrap">{p.statusMessage}</span>
                </div>
              ))}
            </div>
          )}

          {!processing && donePosts > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">Title</th>
                      <th className="pb-2 font-medium text-right">Before</th>
                      <th className="pb-2 font-medium text-right">After</th>
                      <th className="pb-2 font-medium text-right">Delta</th>
                      <th className="pb-2 font-medium text-center">Verdict</th>
                      <th className="pb-2 font-medium text-right">Tokens</th>
                      <th className="pb-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {posts.map((p, i) => {
                      if (p.status === 'error') {
                        return (
                          <tr key={i} className="border-b">
                            <td className="py-2 font-mono text-xs truncate max-w-[200px]" title={p.url}>{p.url}</td>
                            <td colSpan={5} className="py-2 text-red-500 text-xs">{p.error}</td>
                            <td />
                          </tr>
                        );
                      }
                      if (p.status !== 'done') return null;
                      const before = p.post?.word_count || 0;
                      const after = p.wordCountAfter || 0;
                      const delta = after - before;
                      const totalTokens = (p.usageAudit?.input_tokens || 0) + (p.usageAudit?.output_tokens || 0)
                        + (p.usageRewrite?.input_tokens || 0) + (p.usageRewrite?.output_tokens || 0);

                      return (
                        <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpanded(i)}>
                          <td className="py-2 font-medium truncate max-w-[250px]" title={p.post?.title}>{p.post?.title || p.post?.slug}</td>
                          <td className="py-2 text-right tabular-nums">{before.toLocaleString()}</td>
                          <td className="py-2 text-right tabular-nums">{after.toLocaleString()}</td>
                          <td className={`py-2 text-right tabular-nums ${delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {delta > 0 ? '+' : ''}{delta.toLocaleString()}
                          </td>
                          <td className="py-2 text-center">
                            <Badge variant="secondary" className={verdictColor(p.audit?.verdict || '')}>
                              {p.audit?.verdict || 'n/a'}
                            </Badge>
                          </td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{totalTokens.toLocaleString()}</td>
                          <td className="py-2 text-center">
                            {expandedPosts.has(i) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {posts.map((p, i) => {
                if (!expandedPosts.has(i) || p.status !== 'done') return null;
                return (
                  <div key={`detail-${i}`} className="space-y-4">
                    {/* Audit findings */}
                    <div className="rounded-xl border bg-card p-5">
                      <h3 className="font-semibold text-base mb-4">{p.post?.title}</h3>
                      {p.audit && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {p.audit.thin_sections.length > 0 && (
                            <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <AlignLeft className="h-4 w-4 text-red-500" />
                                <span className="font-medium text-sm text-red-700 dark:text-red-400">Thin Sections</span>
                                <Badge variant="secondary" className="bg-red-500/10 text-red-600 text-xs ml-auto">{p.audit.thin_sections.length}</Badge>
                              </div>
                              <ul className="space-y-1">
                                {p.audit.thin_sections.map((s, j) => (
                                  <li key={j} className="text-xs text-red-800/80 dark:text-red-300/80 flex items-start gap-1.5">
                                    <span className="text-red-400 mt-0.5 shrink-0">&#8226;</span>
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {p.audit.outdated_claims.length > 0 && (
                            <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Clock className="h-4 w-4 text-amber-500" />
                                <span className="font-medium text-sm text-amber-700 dark:text-amber-400">Outdated Claims</span>
                                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 text-xs ml-auto">{p.audit.outdated_claims.length}</Badge>
                              </div>
                              <ul className="space-y-1">
                                {p.audit.outdated_claims.map((s, j) => (
                                  <li key={j} className="text-xs text-amber-800/80 dark:text-amber-300/80 flex items-start gap-1.5">
                                    <span className="text-amber-400 mt-0.5 shrink-0">&#8226;</span>
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {p.audit.missing_internal_links.length > 0 && (
                            <div className="rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <LinkIcon className="h-4 w-4 text-blue-500" />
                                <span className="font-medium text-sm text-blue-700 dark:text-blue-400">Missing Internal Links</span>
                                <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 text-xs ml-auto">{p.audit.missing_internal_links.length}</Badge>
                              </div>
                              <ul className="space-y-1">
                                {p.audit.missing_internal_links.map((s, j) => (
                                  <li key={j} className="text-xs text-blue-800/80 dark:text-blue-300/80 flex items-start gap-1.5">
                                    <span className="text-blue-400 mt-0.5 shrink-0">&#8226;</span>
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {p.audit.missing_external_links.length > 0 && (
                            <div className="rounded-lg border border-purple-200 dark:border-purple-900/50 bg-purple-50/50 dark:bg-purple-950/20 p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <ExternalLink className="h-4 w-4 text-purple-500" />
                                <span className="font-medium text-sm text-purple-700 dark:text-purple-400">Missing External Links</span>
                                <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 text-xs ml-auto">{p.audit.missing_external_links.length}</Badge>
                              </div>
                              <ul className="space-y-1">
                                {p.audit.missing_external_links.map((s, j) => (
                                  <li key={j} className="text-xs text-purple-800/80 dark:text-purple-300/80 flex items-start gap-1.5">
                                    <span className="text-purple-400 mt-0.5 shrink-0">&#8226;</span>
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Rewritten content with actions */}
                    <div className="rounded-xl border bg-card p-5">
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-semibold text-sm">Rewritten Content</p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleCopy(p.rewritten || '')}>
                            <Copy className="h-3 w-3 mr-1.5" />
                            Copy
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(`${p.post?.slug || 'post'}-rewritten.md`, p.rewritten || '')}
                          >
                            <Download className="h-3 w-3 mr-1.5" />
                            Download
                          </Button>
                        </div>
                      </div>
                      <div className={[
                        'prose prose-sm dark:prose-invert max-w-none bg-background rounded-lg border p-6 max-h-[600px] overflow-y-auto',
                        'prose-h1:text-2xl prose-h1:font-bold prose-h1:mt-6 prose-h1:mb-4',
                        'prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-8 prose-h2:mb-3 prose-h2:pb-2 prose-h2:border-b',
                        'prose-h3:text-base prose-h3:font-semibold prose-h3:mt-6 prose-h3:mb-2',
                        'prose-p:leading-relaxed prose-p:mb-4',
                        'prose-ul:my-3 prose-ul:space-y-1 prose-ol:my-3 prose-ol:space-y-1',
                        'prose-li:leading-relaxed',
                        'prose-a:text-primary prose-a:underline prose-a:underline-offset-2 prose-a:decoration-primary/40 hover:prose-a:decoration-primary',
                        'prose-strong:font-semibold',
                        '[&_table]:w-full [&_table]:border-collapse [&_table]:my-4 [&_table]:text-sm',
                        '[&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:bg-muted [&_th]:font-medium [&_th]:text-left',
                        '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2',
                        'prose-blockquote:border-l-primary prose-blockquote:bg-muted/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg',
                      ].join(' ')}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {p.rewritten || ''}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                );
              })}

              {donePosts > 1 && (
                <div className="flex justify-end">
                  <Button variant="outline" onClick={handleDownloadAll}>
                    <Download className="h-4 w-4 mr-1.5" />
                    Download All ({donePosts} files)
                  </Button>
                </div>
              )}
            </>
          )}

          {!processing && donePosts === 0 && posts.some(p => p.status === 'error') && (
            <div className="space-y-2">
              {posts.filter(p => p.status === 'error').map((p, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-red-500">
                  <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-mono text-xs">{p.url}</p>
                    <p className="text-xs">{p.error}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service Page Optimizer
// ---------------------------------------------------------------------------

function ServicePageOptimizer() {
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'fetching' | 'analyzing' | 'done' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [pageData, setPageData] = useState<ServicePageData | null>(null);
  const [analysis, setAnalysis] = useState<ServicePageAnalysis | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [generatedSections, setGeneratedSections] = useState<Record<string, string>>({});
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);

  const handleGenerateSection = async (sectionType: string) => {
    if (!analysis || generatingSection) return;
    setGeneratingSection(sectionType);
    try {
      const result = await generateSection(
        sectionType,
        analysis.service_type,
        analysis.location,
        analysis.tone_analysis || 'professional and helpful',
        pageData?.url || '',
      );
      setGeneratedSections(prev => ({ ...prev, [sectionType]: result.content }));
    } catch (err) {
      toast({ variant: 'destructive', title: 'Generation failed', description: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setGeneratingSection(null);
    }
  };

  const handleCopy = async (text: string, label?: string) => {
    await copyAsRichText(text, toast, label);
  };

  const handleAnalyze = async () => {
    if (!url.trim()) return;

    const config = getLLMConfig();
    if (!config) {
      toast({ variant: 'destructive', title: 'No API key', description: 'Add your LLM API key in Settings first.' });
      return;
    }

    setStatus('fetching');
    setStatusMessage('Fetching page content...');
    setAnalysis(null);
    setUsage(null);

    let data: ServicePageData;
    try {
      data = await fetchServicePage(url.trim());
      if (data.error) {
        setStatus('error');
        setStatusMessage(data.error);
        return;
      }
      setPageData(data);
    } catch (err) {
      setStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Failed to fetch page');
      return;
    }

    setStatus('analyzing');
    setStatusMessage('Running LLM analysis (this may take 30-60 seconds)...');

    try {
      const result = await analyzeServicePage({
        url: data.url,
        title: data.title,
        meta_title: data.meta_title,
        meta_description: data.meta_description,
        headings: data.headings,
        body_text: data.body_text,
        word_count: data.word_count,
        schema_json_ld: data.schema_json_ld,
        images: data.images,
      });
      setAnalysis(result.analysis);
      setUsage(result.usage);
      setStatus('done');
      setStatusMessage('');
    } catch (err) {
      setStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Analysis failed');
    }
  };

  const schemaString = analysis?.schema_generated
    ? JSON.stringify(analysis.schema_generated, null, 2)
    : '';

  const faqMarkdown = analysis?.faq
    ?.map(f => `### ${f.question}\n${f.answer}`)
    .join('\n\n') || '';

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="space-y-2">
          <Label>Service Page URL</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/services/landscaping"
                className="pl-10"
                onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
              />
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={!url.trim() || status === 'fetching' || status === 'analyzing'}
            >
              {(status === 'fetching' || status === 'analyzing') ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Search className="h-4 w-4 mr-1.5" />
              )}
              Analyze
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter a single service page URL. The analyzer will detect the service type and location, then provide tailored recommendations.
          </p>
        </div>

        {(status === 'fetching' || status === 'analyzing') && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {statusMessage}
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <XCircle className="h-4 w-4" />
            {statusMessage}
          </div>
        )}
      </div>

      {/* Results */}
      {status === 'done' && analysis && (
        <>
          {/* Score Overview Card */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-primary/10 text-primary border-0 gap-1">
                      <Tag className="h-3 w-3" />
                      {analysis.service_type}
                    </Badge>
                    <Badge className="bg-primary/10 text-primary border-0 gap-1">
                      <MapPin className="h-3 w-3" />
                      {analysis.location}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {analysis.content_word_count || pageData?.word_count || 0} words
                    </span>
                  </div>
                  {analysis.tone_analysis && (
                    <p className="text-sm text-muted-foreground">{analysis.tone_analysis}</p>
                  )}
                </div>
                {/* Score circle */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className={`relative h-16 w-16 rounded-full flex items-center justify-center border-4 ${
                    (analysis.content_score_pct || 0) >= 70 ? 'border-green-500 text-green-600' :
                    (analysis.content_score_pct || 0) >= 40 ? 'border-yellow-500 text-yellow-600' :
                    'border-red-500 text-red-600'
                  }`}>
                    <span className="text-xl font-bold">{analysis.content_score_pct || 0}</span>
                  </div>
                  <Badge variant="secondary" className={`${contentScoreColor(analysis.content_score)} text-xs`}>
                    {analysis.content_score}
                  </Badge>
                </div>
              </div>

              {/* Quick audit row */}
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t">
                {/* Heading Structure */}
                <div className="flex items-center gap-2">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    analysis.heading_structure?.hierarchy_valid ? 'bg-green-500/10' : 'bg-red-500/10'
                  }`}>
                    <Heading className={`h-4 w-4 ${analysis.heading_structure?.hierarchy_valid ? 'text-green-600' : 'text-red-600'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium">Headings</p>
                    <p className={`text-xs ${analysis.heading_structure?.hierarchy_valid ? 'text-green-600' : 'text-red-600'}`}>
                      {analysis.heading_structure?.hierarchy_valid ? 'Valid' : 'Issues found'}
                    </p>
                  </div>
                </div>
                {/* CTAs */}
                <div className="flex items-center gap-2">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    analysis.cta_audit?.score === 'strong' ? 'bg-green-500/10' :
                    analysis.cta_audit?.score === 'weak' ? 'bg-yellow-500/10' : 'bg-red-500/10'
                  }`}>
                    <MousePointerClick className={`h-4 w-4 ${
                      analysis.cta_audit?.score === 'strong' ? 'text-green-600' :
                      analysis.cta_audit?.score === 'weak' ? 'text-yellow-600' : 'text-red-600'
                    }`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium">CTAs</p>
                    <p className={`text-xs ${
                      analysis.cta_audit?.score === 'strong' ? 'text-green-600' :
                      analysis.cta_audit?.score === 'weak' ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {analysis.cta_audit?.score === 'none' ? 'None found' :
                       analysis.cta_audit?.score === 'weak' ? 'Needs work' : 'Strong'}
                    </p>
                  </div>
                </div>
                {/* Trust */}
                <div className="flex items-center gap-2">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    analysis.trust_signals?.score === 'strong' ? 'bg-green-500/10' :
                    analysis.trust_signals?.score === 'weak' ? 'bg-yellow-500/10' : 'bg-red-500/10'
                  }`}>
                    <Shield className={`h-4 w-4 ${
                      analysis.trust_signals?.score === 'strong' ? 'text-green-600' :
                      analysis.trust_signals?.score === 'weak' ? 'text-yellow-600' : 'text-red-600'
                    }`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium">Trust Signals</p>
                    <p className={`text-xs ${
                      analysis.trust_signals?.score === 'strong' ? 'text-green-600' :
                      analysis.trust_signals?.score === 'weak' ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {analysis.trust_signals?.score === 'none' ? 'None found' :
                       analysis.trust_signals?.score === 'weak' ? 'Needs work' : 'Strong'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            {usage && (
              <div className="px-6 py-2 bg-muted/30 border-t text-xs text-muted-foreground text-right">
                {((usage.input_tokens || 0) + (usage.output_tokens || 0)).toLocaleString()} tokens used
              </div>
            )}
          </div>

          {/* Content Gaps */}
          {analysis.content_gaps?.length > 0 && (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold text-sm">Content Gaps</h3>
              </div>
              <div className="space-y-2">
                {analysis.content_gaps.map((gap, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant="secondary" className={`${severityColor(gap.severity)} text-[10px] shrink-0 px-1.5`}>
                      {gap.severity}
                    </Badge>
                    <span className="text-sm">{gap.issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Heading Structure (full width) */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Heading className="h-4 w-4 text-blue-500" />
              <h3 className="font-semibold text-sm">Heading Structure</h3>
              {analysis.heading_structure && (
                <Badge variant="secondary" className={`ml-auto text-[10px] ${analysis.heading_structure.hierarchy_valid ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                  {analysis.heading_structure.hierarchy_valid ? 'Valid hierarchy' : 'Issues found'}
                </Badge>
              )}
            </div>

            {/* H1 analysis */}
            {analysis.heading_structure?.h1_text && (
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">H1 Tag</p>
                <p className="text-sm font-medium">{analysis.heading_structure.h1_text}</p>
                <div className="flex gap-2 mt-2">
                  <Badge variant="secondary" className={`text-[10px] ${analysis.heading_structure.h1_includes_keyword ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                    {analysis.heading_structure.h1_includes_keyword ? 'Has keyword' : 'Missing keyword'}
                  </Badge>
                  <Badge variant="secondary" className={`text-[10px] ${analysis.heading_structure.h1_includes_location ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                    {analysis.heading_structure.h1_includes_location ? 'Has location' : 'Missing location'}
                  </Badge>
                </div>
              </div>
            )}

            {/* All headings from the page */}
            {pageData?.headings && pageData.headings.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Page Headings</p>
                <div className="bg-background rounded-lg border divide-y">
                  {pageData.headings.map((h, i) => {
                    const indent = h.level === 'h2' ? 'pl-4' : h.level === 'h3' ? 'pl-8' : 'pl-0';
                    return (
                      <div key={i} className={`flex items-center gap-2 py-2 px-3 ${indent}`}>
                        <Badge variant="outline" className="text-[10px] font-mono shrink-0 w-7 justify-center">
                          {h.level.toUpperCase()}
                        </Badge>
                        <span className="text-sm truncate">{h.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Issues */}
            {analysis.heading_structure?.issues?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Issues</p>
                <ul className="space-y-1.5">
                  {analysis.heading_structure.issues.map((issue, i) => (
                    <li key={i} className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggested heading improvements */}
            {analysis.heading_structure?.suggested_headings?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Suggested Improvements</p>
                <div className="space-y-2">
                  {analysis.heading_structure.suggested_headings.map((sh, i) => (
                    <div key={i} className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground line-through">{sh.current}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium text-green-700 dark:text-green-400">{sh.suggested}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{sh.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.heading_structure?.hierarchy_valid && (!analysis.heading_structure?.issues || analysis.heading_structure.issues.length === 0) && (
              <p className="text-xs text-green-600 flex items-center gap-1.5">
                <CheckCircle className="h-3 w-3" />
                Heading hierarchy is valid
              </p>
            )}
          </div>

          {/* CTA Audit + Trust Signals row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* CTA Audit */}
            {analysis.cta_audit && (
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="h-4 w-4 text-indigo-500" />
                  <h3 className="font-semibold text-sm">Call-to-Action Audit</h3>
                  <Badge variant="secondary" className={`ml-auto text-[10px] ${
                    analysis.cta_audit.score === 'strong' ? 'bg-green-500/10 text-green-600' :
                    analysis.cta_audit.score === 'weak' ? 'bg-yellow-500/10 text-yellow-600' :
                    'bg-red-500/10 text-red-600'
                  }`}>
                    {analysis.cta_audit.score}
                  </Badge>
                </div>
                {analysis.cta_audit.ctas_found?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Found on page</p>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.cta_audit.ctas_found.map((cta, i) => (
                        <Badge key={i} variant="outline" className="text-xs font-normal">{cta}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.cta_audit.suggestions?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Suggestions</p>
                    <ul className="space-y-1">
                      {analysis.cta_audit.suggestions.map((s, i) => (
                        <li key={i} className="text-xs flex items-start gap-1.5">
                          <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Trust Signals */}
            {analysis.trust_signals && (
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-emerald-500" />
                  <h3 className="font-semibold text-sm">Trust Signals</h3>
                  <Badge variant="secondary" className={`ml-auto text-[10px] ${
                    analysis.trust_signals.score === 'strong' ? 'bg-green-500/10 text-green-600' :
                    analysis.trust_signals.score === 'weak' ? 'bg-yellow-500/10 text-yellow-600' :
                    'bg-red-500/10 text-red-600'
                  }`}>
                    {analysis.trust_signals.score}
                  </Badge>
                </div>
                {analysis.trust_signals.found?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Present</p>
                    <ul className="space-y-1">
                      {analysis.trust_signals.found.map((s, i) => (
                        <li key={i} className="text-xs text-green-700 dark:text-green-400 flex items-start gap-1.5">
                          <CheckCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.trust_signals.missing?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Missing</p>
                    <ul className="space-y-1">
                      {analysis.trust_signals.missing.map((s, i) => (
                        <li key={i} className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Swap Test / Generic Content */}
          {analysis.swap_test && analysis.swap_test.generic_sections?.length > 0 && (
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-orange-500" />
                  <h3 className="font-semibold text-sm">Content Uniqueness (Swap Test)</h3>
                </div>
                <Badge variant="secondary" className={`text-[10px] ${
                  analysis.swap_test.score <= 30 ? 'bg-green-500/10 text-green-600' :
                  analysis.swap_test.score <= 60 ? 'bg-yellow-500/10 text-yellow-600' :
                  'bg-red-500/10 text-red-600'
                }`}>
                  {analysis.swap_test.score <= 30 ? 'Unique' :
                   analysis.swap_test.score <= 60 ? 'Partially generic' : 'Too generic'} ({analysis.swap_test.score}%)
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                The swap test checks if your content could work for any city by simply replacing the location name. Lower is better.
              </p>
              <div className="space-y-3">
                {analysis.swap_test.generic_sections.map((section, i) => (
                  <div key={i} className="rounded-lg border border-orange-200 dark:border-orange-900/50 bg-orange-50/30 dark:bg-orange-950/10 p-3 space-y-2">
                    <p className="text-xs font-medium text-orange-700 dark:text-orange-400">{section.heading_or_location}</p>
                    <p className="text-xs text-muted-foreground italic">"{section.sample_text}"</p>
                    <p className="text-xs"><span className="font-medium text-red-600 dark:text-red-400">Why generic:</span> {section.why_generic}</p>
                    <p className="text-xs"><span className="font-medium text-green-600 dark:text-green-400">Fix:</span> {section.fix}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Image Audit */}
          {analysis.image_audit && (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-pink-500" />
                <h3 className="font-semibold text-sm">Image Audit</h3>
                <Badge variant="secondary" className={`ml-auto text-[10px] ${
                  !analysis.image_audit.has_images ? 'bg-red-500/10 text-red-600' :
                  analysis.image_audit.missing_alt_count > 0 ? 'bg-yellow-500/10 text-yellow-600' :
                  'bg-green-500/10 text-green-600'
                }`}>
                  {!analysis.image_audit.has_images ? 'No images' :
                   analysis.image_audit.missing_alt_count > 0 ? `${analysis.image_audit.missing_alt_count} missing alt` :
                   'All good'}
                </Badge>
              </div>
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Images found:</span>
                  <span className="text-xs font-medium">{analysis.image_audit.total_count}</span>
                </div>
                {analysis.image_audit.missing_alt_count > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Missing alt text:</span>
                    <span className="text-xs font-medium text-red-600">{analysis.image_audit.missing_alt_count}</span>
                  </div>
                )}
              </div>
              {analysis.image_audit.suggestions?.length > 0 && (
                <ul className="space-y-1.5">
                  {analysis.image_audit.suggestions.map((s, i) => (
                    <li key={i} className="text-xs flex items-start gap-1.5">
                      <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Missing Page Sections + Industry-Specific Sections */}
          {((analysis.missing_page_sections?.length > 0) || (analysis.industry_specific_sections?.length > 0)) && (
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold text-sm">Missing Sections</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                These sections would strengthen your page. Click "Generate" to create a draft you can customize.
              </p>

              <div className="space-y-3">
                {/* Standard missing sections */}
                {analysis.missing_page_sections?.map((section, i) => (
                  <div key={`ms-${i}`} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={`text-[10px] ${
                          section.priority === 'high' ? 'bg-red-500/10 text-red-600' :
                          section.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-600' :
                          'bg-blue-500/10 text-blue-600'
                        }`}>
                          {section.priority}
                        </Badge>
                        <span className="font-medium text-sm">{section.label}</span>
                      </div>
                      {!generatedSections[section.section_type] && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGenerateSection(section.section_type)}
                          disabled={generatingSection !== null}
                        >
                          {generatingSection === section.section_type ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                          ) : (
                            <Play className="h-3 w-3 mr-1.5" />
                          )}
                          Generate
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{section.why_needed}</p>
                    {generatedSections[section.section_type] && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-green-600">Generated Draft</p>
                          <Button size="sm" variant="outline" onClick={() => handleCopy(generatedSections[section.section_type], section.label)}>
                            <Copy className="h-3 w-3 mr-1.5" />
                            Copy
                          </Button>
                        </div>
                        <div className="prose prose-sm dark:prose-invert max-w-none bg-muted/20 rounded-lg border p-4 prose-a:text-primary prose-a:underline prose-a:underline-offset-2">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {generatedSections[section.section_type]}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Industry-specific sections */}
                {analysis.industry_specific_sections?.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Tag className="h-3.5 w-3.5 text-primary" />
                      <p className="text-xs font-medium text-muted-foreground">Industry-Specific Opportunities</p>
                    </div>
                    {analysis.industry_specific_sections.map((section, i) => (
                      <div key={`is-${i}`} className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className={`text-[10px] ${
                              section.priority === 'high' ? 'bg-red-500/10 text-red-600' : 'bg-yellow-500/10 text-yellow-600'
                            }`}>
                              {section.priority}
                            </Badge>
                            <span className="font-medium text-sm">{section.label}</span>
                          </div>
                          {!generatedSections[section.section_type] && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleGenerateSection(section.section_type)}
                              disabled={generatingSection !== null}
                            >
                              {generatingSection === section.section_type ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                              ) : (
                                <Play className="h-3 w-3 mr-1.5" />
                              )}
                              Generate
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{section.why_relevant}</p>
                        {generatedSections[section.section_type] && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-green-600">Generated Draft</p>
                              <Button size="sm" variant="outline" onClick={() => handleCopy(generatedSections[section.section_type], section.label)}>
                                <Copy className="h-3 w-3 mr-1.5" />
                                Copy
                              </Button>
                            </div>
                            <div className="prose prose-sm dark:prose-invert max-w-none bg-background rounded-lg border p-4 prose-a:text-primary prose-a:underline prose-a:underline-offset-2">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {generatedSections[section.section_type]}
                              </ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Meta Tags */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-slate-500" />
              <h3 className="font-semibold text-sm">Meta Tags</h3>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Title Tag</p>
                  {analysis.meta_title_suggested && (
                    <button onClick={() => handleCopy(analysis.meta_title_suggested, 'Title tag')} className="text-xs text-primary hover:underline flex items-center gap-1">
                      <Copy className="h-3 w-3" /> Copy suggested
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/30 rounded-lg p-3 text-sm">{analysis.meta_title_current || '(none)'}</div>
                  <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 text-sm">{analysis.meta_title_suggested || '(no suggestion)'}</div>
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
                  <span>Current ({(analysis.meta_title_current || '').length} chars)</span>
                  <span>Suggested ({(analysis.meta_title_suggested || '').length} chars)</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Meta Description</p>
                  {analysis.meta_description_suggested && (
                    <button onClick={() => handleCopy(analysis.meta_description_suggested, 'Meta description')} className="text-xs text-primary hover:underline flex items-center gap-1">
                      <Copy className="h-3 w-3" /> Copy suggested
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/30 rounded-lg p-3 text-sm">{analysis.meta_description_current || '(none)'}</div>
                  <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 text-sm">{analysis.meta_description_suggested || '(no suggestion)'}</div>
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
                  <span>Current ({(analysis.meta_description_current || '').length} chars)</span>
                  <span>Suggested ({(analysis.meta_description_suggested || '').length} chars)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Local Content Section */}
          {analysis.local_content_section?.content && (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-orange-500" />
                  <h3 className="font-semibold text-sm">Suggested Local Content Section</h3>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(
                    `## ${analysis.local_content_section.title}\n\n${analysis.local_content_section.content}`,
                    'Local content section',
                  )}
                >
                  <Copy className="h-3 w-3 mr-1.5" />
                  Copy
                </Button>
              </div>
              <div className="bg-muted/20 rounded-lg border p-5">
                <h4 className="font-semibold text-base mb-3">{analysis.local_content_section.title}</h4>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{analysis.local_content_section.content}</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs bg-blue-500/5 text-blue-700 dark:text-blue-400 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>Placement: {analysis.local_content_section.placement}</span>
              </div>
            </div>
          )}

          {/* Schema Markup */}
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-teal-500" />
                <h3 className="font-semibold text-sm">Schema Markup</h3>
              </div>
              <div className="flex gap-2 ml-auto">
                {schemaString && (
                  <Button size="sm" variant="outline" onClick={() => handleCopy(schemaString, 'Schema JSON-LD')}>
                    <Copy className="h-3 w-3 mr-1.5" />
                    Copy JSON-LD
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open('https://search.google.com/test/rich-results', '_blank')}
                >
                  <ExternalLink className="h-3 w-3 mr-1.5" />
                  Test Rich Results
                </Button>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Existing:</span>
                {analysis.schema_existing?.length > 0
                  ? analysis.schema_existing.map((s, i) => (
                      <Badge key={i} variant="secondary" className="bg-green-500/10 text-green-600 text-[10px]">{s}</Badge>
                    ))
                  : <span className="text-xs text-muted-foreground">None</span>
                }
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Missing:</span>
                {analysis.schema_missing?.length > 0
                  ? analysis.schema_missing.map((s, i) => (
                      <Badge key={i} variant="secondary" className="bg-red-500/10 text-red-600 text-[10px]">{s}</Badge>
                    ))
                  : <span className="text-xs text-muted-foreground">None</span>
                }
              </div>
            </div>
            {schemaString && (
              <pre className="whitespace-pre-wrap text-xs bg-background rounded-lg border p-4 max-h-64 overflow-y-auto font-mono text-muted-foreground">
                {schemaString}
              </pre>
            )}
          </div>

          {/* FAQ Section */}
          {analysis.faq?.length > 0 && (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-violet-500" />
                  <h3 className="font-semibold text-sm">Suggested FAQ Section</h3>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleCopy(faqMarkdown, 'FAQ section')}>
                  <Copy className="h-3 w-3 mr-1.5" />
                  Copy
                </Button>
              </div>
              <div className="space-y-2">
                {analysis.faq.map((faq, i) => (
                  <div key={i} className="rounded-lg border bg-muted/20 p-4">
                    <p className="font-medium text-sm">{faq.question}</p>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Additional Recommendations */}
          {analysis.additional_recommendations?.length > 0 && (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold text-sm">Additional Recommendations</h3>
              </div>
              <ul className="space-y-2">
                {analysis.additional_recommendations.map((rec, i) => (
                  <li key={i} className="text-sm flex items-start gap-2.5 bg-muted/20 rounded-lg p-3">
                    <CheckCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export with tabbed layout
// ---------------------------------------------------------------------------

export default function ContentTools() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Content Tools</h1>
        <p className="text-muted-foreground">Optimize and revive your content for better search performance</p>
      </div>

      <Tabs defaultValue="revival" className="w-full">
        <TabsList>
          <TabsTrigger value="revival">Content Revival</TabsTrigger>
          <TabsTrigger value="optimizer">Service Page Optimizer</TabsTrigger>
        </TabsList>
        <TabsContent value="revival" className="mt-6" forceMount>
          <ContentRevival />
        </TabsContent>
        <TabsContent value="optimizer" className="mt-6" forceMount>
          <ServicePageOptimizer />
        </TabsContent>
      </Tabs>
    </div>
  );
}
