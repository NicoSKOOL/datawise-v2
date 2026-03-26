import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MessageSquare, Send, Plus, Link2, HelpCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SparklesIcon from '@/components/icons/sparkles-icon';
import type { AnimatedIconHandle } from '@/components/icons/types';
import { sendMessage, getConversations, getConversation, type Conversation, type ChatMessageData } from '@/lib/chat';
import { getGSCProperties, type GSCProperty } from '@/lib/gsc';
import { useToast } from '@/hooks/use-toast';

interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function SEOAssistant() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [properties, setProperties] = useState<GSCProperty[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sparklesRef = useRef<AnimatedIconHandle>(null);
  const { toast } = useToast();

  // Load conversations and GSC properties
  useEffect(() => {
    getConversations()
      .then((data) => setConversations(data.conversations || []))
      .catch(() => {});

    getGSCProperties()
      .then((data) => {
        setConnected(data.connected);
        const enabledProps = (data.properties || []).filter((p) => p.is_enabled !== 0);
        setProperties(enabledProps);
        const syncedProps = enabledProps.filter((p) => p.last_synced_at);
        if (syncedProps.length > 0) {
          setSelectedProperty(syncedProps[0].id);
        }
      })
      .catch(() => {});
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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
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
      if (errMsg === 'NO_LLM_KEY') {
        toast({ variant: 'destructive', title: 'API Key Required', description: 'Add your LLM API key in Settings to use the chat.' });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: errMsg || 'Failed to get response.' });
      }
      setMessages((prev) => prev.slice(0, -1)); // Remove empty assistant message
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

  const suggestedPrompts = [
    { label: 'Low Hanging Fruit', prompt: 'Show me keywords ranking on page 2 (positions 11-20) with the most impressions. These are my best opportunities to push to page 1.' },
    { label: 'Top Keywords', prompt: 'What are my top 10 keywords by clicks over the past 7 days? Show them in a table.' },
    { label: 'Quick Wins', prompt: 'Find keywords with high impressions but low CTR where I rank in the top 5. These need better titles and meta descriptions.' },
    { label: 'Weekly Trend', prompt: 'How has my click and impression trend been week over week? Am I growing or declining?' },
    { label: 'Content Gaps', prompt: 'Which of my pages get the most impressions but the fewest clicks? These pages need content improvements.' },
    { label: 'Traffic Summary', prompt: 'Give me a full performance summary: clicks, impressions, and avg position for the past 7, 30, and 90 days.' },
  ];

  const handleSuggestedPrompt = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Sidebar: Conversations */}
      <div className="w-64 flex-shrink-0 flex flex-col border rounded-xl bg-card">
        <div className="p-3 border-b">
          <Button onClick={startNewConversation} variant="outline" className="w-full gap-2" size="sm">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        {/* Property Selector */}
        {properties.length > 0 && (
          <div className="p-3 border-b">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Property</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px] text-xs">
                  Only synced properties can be selected. Go to Settings to sync your GSC data.
                </TooltipContent>
              </Tooltip>
            </div>
            <Select value={selectedProperty} onValueChange={setSelectedProperty}>
              <SelectTrigger className="text-xs h-8">
                <div className="flex items-center gap-2 truncate">
                  {selectedProperty && (() => {
                    const prop = properties.find((p) => p.id === selectedProperty);
                    return prop ? (
                      <>
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: prop.color || '#6366f1' }} />
                        <span className="truncate">{prop.site_url.replace(/^(sc-domain:|https?:\/\/)/, '')}</span>
                      </>
                    ) : <span>Select property</span>;
                  })()}
                </div>
              </SelectTrigger>
              <SelectContent>
                {properties.map((p) => {
                  const isSynced = !!p.last_synced_at;
                  return (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      disabled={!isSynced}
                      className={`text-xs ${!isSynced ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: isSynced ? (p.color || '#6366f1') : '#a1a1aa' }}
                        />
                        <span className={!isSynced ? 'text-muted-foreground' : ''}>
                          {p.site_url.replace(/^(sc-domain:|https?:\/\/)/, '')}
                        </span>
                        {!isSynced && (
                          <span className="text-[10px] text-muted-foreground ml-auto">Not synced</span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.map((conv) => {
              const convProperty = properties.find((p) => p.id === conv.property_id);
              const convColor = convProperty?.color || null;
              return (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    conversationId === conv.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {convColor && (
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: convColor }} />
                  )}
                  <span className="truncate">{conv.title}</span>
                </button>
              );
            })}
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No conversations yet</p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col border rounded-xl bg-card">
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
                        : 'bg-muted'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_table]:w-full [&_table]:border-collapse [&_th]:px-2 [&_th]:py-1.5 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-gray-300 [&_td]:border [&_td]:border-gray-300 [&_th]:bg-gray-100 [&_th]:font-semibold [&_th]:text-left dark:[&_th]:border-gray-600 dark:[&_td]:border-gray-600 dark:[&_th]:bg-gray-800 [&_table]:rounded-lg [&_table]:overflow-hidden">
                        {msg.content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        ) : (
                          <div className="flex items-center gap-2 py-1 text-muted-foreground">
                            <SparklesIcon ref={sparklesRef} size={18} className="text-primary" />
                            <span className="text-sm">Thinking...</span>
                          </div>
                        )}
                      </div>
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
          {connected && messages.length === 0 && (
            <div className="flex flex-wrap gap-2 max-w-3xl mx-auto mb-3">
              {suggestedPrompts.map((sp) => (
                <button
                  key={sp.label}
                  onClick={() => handleSuggestedPrompt(sp.prompt)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
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
              onClick={handleSend}
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
