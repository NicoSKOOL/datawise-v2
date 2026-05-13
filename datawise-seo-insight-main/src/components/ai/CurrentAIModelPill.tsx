import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getLLMConfig, LLM_CONFIG_EVENT, type LLMConfig } from '@/lib/chat';
import { DEFAULT_OPENROUTER_MODEL, modelDisplayName } from '@/lib/ai-models';
import { cn } from '@/lib/utils';
import { ModelProviderLogo } from './ModelProviderLogo';

type CurrentAIModelPillProps = {
  className?: string;
  label?: string;
  surface?: string;
  showName?: boolean;
};

export default function CurrentAIModelPill({
  className,
  label = 'Model',
  surface = 'This area',
  showName = true,
}: CurrentAIModelPillProps) {
  const [config, setConfig] = useState<LLMConfig | null>(() => getLLMConfig());

  useEffect(() => {
    const refresh = () => setConfig(getLLMConfig());
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener(LLM_CONFIG_EVENT, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener(LLM_CONFIG_EVENT, refresh);
    };
  }, []);

  if (!config) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/settings#llm"
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-amber-500/60 bg-amber-50 px-3 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100',
              className
            )}
          >
            <Settings2 className="h-3.5 w-3.5" />
            No model configured
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px] text-xs">
          Add your OpenRouter API key and preferred model in Settings before using AI features.
        </TooltipContent>
      </Tooltip>
    );
  }

  const model = config.model || DEFAULT_OPENROUTER_MODEL;
  const displayName = modelDisplayName(model);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/settings#llm"
          aria-label={`${surface} is using ${displayName}`}
          className={cn(
            showName
              ? 'inline-flex h-9 max-w-full items-center gap-2 rounded-full border bg-card px-3 text-xs font-medium shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:shadow-md'
              : 'inline-flex items-center gap-2 rounded-full border bg-card px-2.5 py-1 text-xs font-medium shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:shadow-md',
            className
          )}
        >
          <span className="text-muted-foreground">{label}</span>
          <ModelProviderLogo model={model} size={14} />
          {showName && <span className="max-w-[180px] truncate">{displayName}</span>}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{surface}: {displayName}</span>
          <span className="font-mono text-[10px] opacity-70">{model}</span>
          <span className="text-[10px] opacity-80">Pulled from Settings → AI Chat Model.</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
