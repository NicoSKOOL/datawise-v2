import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MessageSquare, Send, Plus, Link2, HelpCircle, Trash2, Pencil, Check, X, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SparklesIcon from '@/components/icons/sparkles-icon';
import type { AnimatedIconHandle } from '@/components/icons/types';
import { useSearchParams } from 'react-router-dom';
import { sendMessage, getConversations, getConversation, deleteConversation, renameConversation, getLLMConfig, LLM_CONFIG_EVENT, type Conversation, type ChatMessageData } from '@/lib/chat';
import { useProperty } from '@/contexts/PropertyContext';
import { useToast } from '@/hooks/use-toast';
import { ExportMenu } from '@/components/export/ExportMenu';
import { buildChatConversationReport } from '@/lib/export/adapters/chatConversation';

interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  // When the LLM call fails, we keep the assistant bubble and attach the
  // reason here instead of deleting it. Previously the bubble was removed on
  // any error (slice(0,-1)) and the cause shown only in a transient toast, so
  // a missing/invalid/credit-less BYOK key looked like the assistant silently
  // ignored the user: the thread showed only their own messages (bug
  // b0f06dc3, "All AI replies disappear here?").
  error?: string;
  // 'no_key' renders an "Add key in Settings" CTA; 'generic' just shows the
  // provider's error message (out of credits, rate limit, bad model, etc.).
  errorKind?: 'no_key' | 'generic';
}

export default function SEOAssistant() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Whether a usable OpenRouter key is configured (BYOK). Drives the no-key
  // banner so users learn they must add a key BEFORE sending into the void.
  const [hasLlmKey, setHasLlmKey] = useState<boolean>(() => !!getLLMConfig());
  // Drive the chat's GSC property from the global PropertyContext so the
  // sidebar property selector and the chat agree on context. Two independent
  // selectors caused user confusion when one was set to domain A and the
  // chat ran with domain B (bug 89b32130).
  const { properties, selectedPropertyId: selectedProperty, connected } = useProperty();
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sparklesRef = useRef<AnimatedIconHandle>(null);
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillRef = useRef(false);

  // Deep-link prefill: the dashboard "Get a fix plan" sends ?q=<prompt>.
  // Load it into the composer once, clear the param, focus. No auto-send.
  useEffect(() => {
    if (prefillRef.current) return;
    const q = searchParams.get('q');
    if (q) {
      prefillRef.current = true;
      setInput(q);
      setSearchParams({}, { replace: true });
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [searchParams, setSearchParams]);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('seo-assistant-sidebar-width');
    return saved ? Math.max(200, Math.min(480, Number(saved))) : 264;
  });
  const isDragging = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(200, Math.min(480, e.clientX - 16));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('seo-assistant-sidebar-width', String(sidebarWidth));
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarWidth]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Load conversations (properties come from PropertyContext above).
  useEffect(() => {
    getConversations()
      .then((data) => setConversations(data.conversations || []))
      .catch(() => {});
  }, []);

  // Keep the no-key banner in sync if the user saves a key in Settings within
  // the same SPA session. saveLLMConfig dispatches LLM_CONFIG_EVENT.
  useEffect(() => {
    const refresh = () => setHasLlmKey(!!getLLMConfig());
    window.addEventListener(LLM_CONFIG_EVENT, refresh);
    return () => window.removeEventListener(LLM_CONFIG_EVENT, refresh);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Loop sparkles animation while loading
  useEffect(() => {
    if (!loading) return;
    sparklesRef.current?.startAnimation();
    const interval = setInterval(() => {
      sparklesRef.current?.startAnimation();
    }, 700);
    return () => {
      clearInterval(interval);
      sparklesRef.current?.stopAnimation();
    };
  }, [loading]);

  // textOverride lets suggested-prompt chips send immediately; reading `input`
  // right after setInput(prompt) would send the stale value.
  const handleSend = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;

    if (!textOverride) setInput('');
    const userMsg: UIMessage = { id: Date.now().toString(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsg: UIMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: '' };
    setMessages((prev) => [...prev, assistantMsg]);
    setLoading(true);

    try {
      const result = await sendMessage(text, (chunk) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + chunk };
          }
          return updated;
        });
      }, {
        conversation_id: conversationId || undefined,
        property_id: selectedProperty || undefined,
      });

      if (result.conversation_id && !conversationId) {
        setConversationId(result.conversation_id);
        // Refresh conversation list
        getConversations().then((data) => setConversations(data.conversations || [])).catch(() => {});
      }
    } catch (error: any) {
      const errMsg = error?.message || '';
      const isNoKey = errMsg === 'NO_LLM_KEY';
      const description = isNoKey
        ? 'No OpenRouter API key found. Add your key in Settings to use the SEO Assistant.'
        : (errMsg || 'The assistant could not reply. Try again in a moment.');
      // Keep the assistant bubble and attach the reason so the failure stays
      // visible in the thread (the toast auto-dismisses; the bubble does not).
      // Any partial streamed text is preserved alongside the error.
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            error: description,
            errorKind: isNoKey ? 'no_key' : 'generic',
          };
        }
        return updated;
      });
      if (isNoKey) setHasLlmKey(false);
      toast({
        variant: 'destructive',
        title: isNoKey ? 'API Key Required' : 'Assistant error',
        description,
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading, conversationId, selectedProperty, toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const loadConversation = async (convId: string) => {
    try {
      const data = await getConversation(convId);
      setConversationId(convId);
      setMessages(data.messages.map((m: ChatMessageData) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      })));
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load conversation' });
    }
  };

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    inputRef.current?.focus();
  };

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (conversationId === convId) {
        setConversationId(null);
        setMessages([]);
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete conversation' });
    }
  };

  const startRename = (convId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConvId(convId);
    setEditingTitle(currentTitle);
    setTimeout(() => editInputRef.current?.select(), 0);
  };

  const confirmRename = async () => {
    if (!editingConvId || !editingTitle.trim()) {
      setEditingConvId(null);
      return;
    }
    try {
      await renameConversation(editingConvId, editingTitle.trim());
      setConversations((prev) =>
        prev.map((c) => c.id === editingConvId ? { ...c, title: editingTitle.trim() } : c)
      );
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to rename conversation' });
    }
    setEditingConvId(null);
  };

  const cancelRename = () => {
    setEditingConvId(null);
  };

  const suggestedPrompts = [
    { label: 'Low Hanging Fruit', prompt: 'Show me keywords ranking on page 2 (positions 11-20) with the most impressions. These are my best opportunities to push to page 1.' },
    { label: 'Top Keywords', prompt: 'What are my top 10 keywords by clicks over the past 7 days? Show them in a table.' },
    { label: 'Quick Wins', prompt: 'Find keywords with high impressions but low CTR where I rank in the top 5. These need better titles and meta descriptions.' },
    { label: 'Weekly Trend', prompt: 'How has my click and impression trend been week over week? Am I growing or declining?' },
    { label: 'Content Gaps', prompt: 'Which of my pages get the most impressions but the fewest clicks? These pages need content improvements.' },
    { label: 'Traffic Summary', prompt: 'Give me a full performance summary: clicks, impressions, and avg position for the past 7, 30, and 90 days.' },
  ];

  // Send the prepared prompt right away (bug 5a49fe13: chips only filled the
  // input, so the search never ran unless the user pressed Enter themselves).
  const handleSuggestedPrompt = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Sidebar: Conversations */}
      <div className="flex-shrink-0 flex flex-col border rounded-xl bg-card relative" style={{ width: sidebarWidth }}>
        <div className="p-3 border-b">
          <Button onClick={startNewConversation} variant="outline" className="w-full gap-2" size="sm">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        {/* Active property indicator (read-only). The actual selector lives
             in the global sidebar so there is exactly one source of truth. */}
        {properties.length > 0 && selectedProperty && (() => {
          const prop = properties.find((p) => p.id === selectedProperty);
          if (!prop) return null;
          return (
            <div className="p-3 border-b">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Property</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px] text-xs">
                    The chat uses the property selected in the left sidebar. Change it there to switch domains.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-muted/50 truncate">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: prop.color || '#6366f1' }} />
                <span className="truncate">{prop.site_url.replace(/^(sc-domain:|https?:\/\/)/, '')}</span>
              </div>
            </div>
          );
        })()}

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.map((conv) => {
              const convProperty = properties.find((p) => p.id === conv.property_id);
              const convColor = convProperty?.color || null;
              const isEditing = editingConvId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`group relative w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 cursor-pointer ${
                    conversationId === conv.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => !isEditing && loadConversation(conv.id)}
                >
                  {convColor && (
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: convColor }} />
                  )}
                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <input
                        ref={editInputRef}
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename();
                          if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={confirmRename}
                        className="flex-1 min-w-0 bg-background border rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ) : (
                    <>
                      <span className="truncate flex-1">{conv.title}</span>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition-opacity">
                        <button
                          onClick={(e) => startRename(conv.id, conv.title, e)}
                          className="p-0.5 rounded hover:bg-muted-foreground/10 hover:text-foreground"
                          title="Rename conversation"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteConversation(conv.id, e)}
                          className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive"
                          title="Delete conversation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No conversations yet</p>
            )}
          </div>
        </ScrollArea>
        {/* Drag handle */}
        <div
          onMouseDown={startDrag}
          className="absolute top-0 -right-2 w-4 h-full cursor-col-resize group/drag flex items-center justify-center z-10"
        >
          <div className="w-0.5 h-8 rounded-full bg-border group-hover/drag:bg-primary/50 group-active/drag:bg-primary transition-colors" />
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col border rounded-xl bg-card">
        {messages.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold truncate">
                {conversations.find((c) => c.id === conversationId)?.title || 'New Conversation'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {messages.length} {messages.length === 1 ? 'message' : 'messages'}
              </p>
            </div>
            <ExportMenu
              surface="seo-assistant"
              identifier={() => conversations.find((c) => c.id === conversationId)?.title}
              buildPayload={() => {
                const conv = conversations.find((c) => c.id === conversationId);
                const nowIso = new Date().toISOString();
                return buildChatConversationReport({
                  conversation: conv ?? {
                    id: conversationId ?? 'draft',
                    title: 'SEO Assistant Conversation',
                    property_id: selectedProperty || null,
                    updated_at: nowIso,
                  },
                  messages: messages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    created_at: nowIso,
                  })) as ChatMessageData[],
                });
              }}
            />
          </div>
        )}
        {/* No-key banner: the assistant is BYOK. Surface this up front so
            users add a key instead of sending messages that silently fail. */}
        {!hasLlmKey && (
          <div className="mx-4 mt-4 flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-950/30">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-amber-900 dark:text-amber-200">Add your OpenRouter API key to use the SEO Assistant</p>
              <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">The assistant is bring-your-own-key. Without a valid OpenRouter inference key with credits, your messages won't get a reply.</p>
            </div>
            <Button variant="outline" size="sm" className="h-8 flex-shrink-0 gap-2" asChild>
              <a href="/settings">
                <Link2 className="h-3.5 w-3.5" />
                Add key
              </a>
            </Button>
          </div>
        )}
        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <MessageSquare className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">SEO Assistant</h3>
              <p className="text-sm text-muted-foreground/60 mt-1 max-w-md">
                {connected
                  ? 'Ask me anything about your search performance. I can analyze your GSC data, find opportunities, and suggest improvements.'
                  : 'Connect your Google Search Console in Settings to get personalized SEO insights. You can still ask general SEO questions.'}
              </p>
              {!connected && (
                <Button variant="outline" className="mt-4 gap-2" size="sm" asChild>
                  <a href="/settings">
                    <Link2 className="h-4 w-4" />
                    Connect GSC
                  </a>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : msg.error
                          ? 'border border-destructive/40 bg-destructive/10 text-foreground'
                          : 'bg-muted'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <>
                        {msg.content && (
                          <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_table]:w-full [&_table]:border-collapse [&_th]:px-2 [&_th]:py-1.5 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-gray-300 [&_td]:border [&_td]:border-gray-300 [&_th]:bg-gray-100 [&_th]:font-semibold [&_th]:text-left dark:[&_th]:border-gray-600 dark:[&_td]:border-gray-600 dark:[&_th]:bg-gray-800 [&_table]:rounded-lg [&_table]:overflow-hidden">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                        {msg.error ? (
                          <div className={`flex items-start gap-2 ${msg.content ? 'mt-2 pt-2 border-t border-destructive/20' : ''}`}>
                            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-destructive" />
                            <div className="space-y-2 min-w-0">
                              <p className="text-sm text-foreground">{msg.error}</p>
                              {msg.errorKind === 'no_key' && (
                                <Button variant="outline" size="sm" className="gap-2 h-7" asChild>
                                  <a href="/settings">
                                    <Link2 className="h-3.5 w-3.5" />
                                    Add key in Settings
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : !msg.content ? (
                          <div className="flex items-center gap-2 py-1 text-muted-foreground">
                            <SparklesIcon ref={sparklesRef} size={18} className="text-primary" />
                            <span className="text-sm">Thinking...</span>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>

        {/* Suggested Prompts + Input */}
        <div className="p-4 border-t">
          {/* Chips stay visible mid-conversation (bug 5a49fe13: they used to
              unmount after the first exchange, forcing a new chat to use
              another prepared prompt). */}
          {connected && (
            <div className="flex flex-wrap gap-2 max-w-3xl mx-auto mb-3">
              {suggestedPrompts.map((sp) => (
                <button
                  key={sp.label}
                  onClick={() => handleSuggestedPrompt(sp.prompt)}
                  disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                >
                  {sp.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 max-w-3xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={connected ? 'Ask about your search performance...' : 'Ask an SEO question...'}
              className="flex-1 resize-none rounded-xl border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[48px] max-h-[120px]"
              rows={1}
              disabled={loading}
            />
            <Button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              size="icon"
              className="h-12 w-12 rounded-xl flex-shrink-0"
            >
              {loading ? <SparklesIcon size={18} className="text-primary-foreground" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
