import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Settings2, RotateCcw } from 'lucide-react';
import claudeLogo from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
import openaiLogo from '@lobehub/icons-static-svg/icons/openai.svg?url';
import openrouterLogo from '@lobehub/icons-static-svg/icons/openrouter.svg?url';
import deepseekLogo from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import perplexityLogo from '@lobehub/icons-static-svg/icons/perplexity-color.svg?url';
import moonshotLogo from '@lobehub/icons-static-svg/icons/moonshot.svg?url';
import { getLLMConfig, LLM_CONFIG_EVENT, type LLMConfig } from '@/lib/chat';
import {
  CONTENT_WRITER_STEP_DEFAULTS,
  getContentWriterStepModels,
  setContentWriterStepModel,
  resolveContentWriterStepModel,
  CW_STEP_MODELS_EVENT,
  type PostStep,
} from '@/lib/content-writer';
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_MODELS, OPENROUTER_PROVIDER_GROUPS, modelDisplayName } from '@/lib/ai-models';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';

// Map an OpenRouter model ID (e.g. `deepseek/deepseek-v4-pro`) or a chat
// provider key to the right vendor logo. Falls back to OpenRouter when we
// don't have a vendor-specific icon for the model family.
function logoForModel(modelOrProvider: string): string {
  const lower = modelOrProvider.toLowerCase();
  if (lower.startsWith('deepseek')) return deepseekLogo;
  if (lower.startsWith('perplexity') || lower.includes('sonar')) return perplexityLogo;
  if (lower.startsWith('moonshotai') || lower.includes('kimi')) return moonshotLogo;
  if (lower.startsWith('anthropic') || lower.includes('claude')) return claudeLogo;
  if (lower.startsWith('openai') || lower.includes('gpt')) return openaiLogo;
  if (lower.startsWith('openrouter')) return openrouterLogo;
  return openrouterLogo;
}

function ModelLogo({ src, size = 14 }: { src: string; size?: number }) {
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

const STEP_ORDER: PostStep[] = ['research', 'outline', 'draft', 'review'];

const STEP_LABEL: Record<PostStep, string> = {
  research: 'Research',
  outline: 'Outline',
  draft: 'Draft',
  review: 'Review',
};

const STEP_HINT: Record<PostStep, string> = {
  research: 'Search-grounded model. Sonar Pro returns real web citations.',
  outline: 'Curated OpenRouter model for short structured output.',
  draft: 'Long-form prose. This is the bulk of token spend.',
  review: 'Final pass to flag issues and artifact cleanup.',
};

export default function ModelBadge() {
  const [config, setConfig] = useState<LLMConfig | null>(() => getLLMConfig());
  const [overrides, setOverrides] = useState<Partial<Record<PostStep, string>>>(() => getContentWriterStepModels());

  useEffect(() => {
    const refresh = () => {
      setConfig(getLLMConfig());
      setOverrides(getContentWriterStepModels());
    };
    // `storage` only fires for cross-tab writes, so we also listen for
    // our own custom events (LLM_CONFIG_EVENT, CW_STEP_MODELS_EVENT) which
    // are dispatched immediately after a same-tab write. focus is kept as
    // a belt-and-braces fallback for any edge case we missed.
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener(LLM_CONFIG_EVENT, refresh);
    window.addEventListener(CW_STEP_MODELS_EVENT, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener(LLM_CONFIG_EVENT, refresh);
      window.removeEventListener(CW_STEP_MODELS_EVENT, refresh);
    };
  }, []);

  if (!config) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/settings#llm"
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-500/60 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            <Settings2 className="h-3 w-3" />
            No model configured
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[240px] text-xs">
          Bring your own API key in Settings → AI Model. The Content Writer needs a model to run.
        </TooltipContent>
      </Tooltip>
    );
  }

  // Pill icon represents the writer (draft step) — that's the bulk of the
  // token spend and the most representative "active model" for the post.
  // Resolution mirrors what runStep actually sends to the worker:
  // override > Settings chat model > hard-wired default.
  const resolvedDraft = resolveContentWriterStepModel('draft');
  const draftModel = resolvedDraft.model;
  const draftLogo = logoForModel(draftModel);

  function handleChange(step: PostStep, value: string) {
    if (step === 'research') return;
    setContentWriterStepModel(step, value || null);
    setOverrides(getContentWriterStepModels());
  }

  function resetAll() {
    STEP_ORDER.forEach((s) => setContentWriterStepModel(s, null));
    setOverrides({});
  }

  const overrideCount = STEP_ORDER.filter((s) => overrides[s]).length;
  const draftDisplay = modelDisplayName(draftModel);
  const sourceLabel = resolvedDraft.source === 'override'
    ? 'Per-step override (click to edit)'
    : resolvedDraft.source === 'settings'
      ? 'From Settings → AI Chat Model. Click to override per step.'
      : 'Default. Pick a model in Settings or override per step here.';

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border bg-card px-2.5 py-1 text-xs font-medium shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-muted hover:shadow-md hover:border-primary/40"
            >
              <span className="text-muted-foreground">Model</span>
              <ModelLogo src={draftLogo} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">Writer: {draftDisplay}</span>
            <span className="font-mono text-[10px] opacity-70">{draftModel}</span>
            <span className="text-[10px] opacity-80">{sourceLabel}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    {/* Tooltip closed above; popover content continues here. */}
      <PopoverContent align="end" className="w-[420px] p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h4 className="text-sm font-semibold">Content Writer models</h4>
            <p className="text-xs text-muted-foreground">
              Per-step model used by the pipeline. Defaults are what we recommend; override only if you know what you're doing.
            </p>
          </div>
          <Link
            to="/settings#llm"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            API key
          </Link>
        </div>

        <div className="space-y-3">
          {STEP_ORDER.map((step) => {
            const resolved = resolveContentWriterStepModel(step);
            const value = step === 'research' ? '' : overrides[step] || '';
            const effective = value || resolved.model;
            // The placeholder shows the EFFECTIVE fallback if the user
            // clears their override — i.e. resolves through Settings or
            // step default depending on which is active.
            const fallbackLabel = resolved.source === 'override'
              ? CONTENT_WRITER_STEP_DEFAULTS[step]
              : resolved.model;
            const sourceTag = resolved.source === 'settings'
              ? 'from Settings'
              : 'default';
            return (
              <div key={step}>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium">
                    <ModelLogo src={logoForModel(effective)} size={12} />
                    {STEP_LABEL[step]}
                    {step === 'research' && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    {value ? `default: ${CONTENT_WRITER_STEP_DEFAULTS[step]}` : `${sourceTag}: ${fallbackLabel}`}
                  </span>
                </div>
                {step === 'research' ? (
                  <div className="flex h-8 items-center justify-between rounded-md border bg-muted/40 px-3 text-xs">
                    <span>{modelDisplayName(effective)}</span>
                    <code className="font-mono text-[10px] text-muted-foreground">{effective}</code>
                  </div>
                ) : (
                  <Select value={value || '__default'} onValueChange={(next) => handleChange(step, next === '__default' ? '' : next)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={fallbackLabel} />
                    </SelectTrigger>
                    <SelectContent className="min-w-[360px]">
                      <SelectItem value="__default">
                        <span className="text-muted-foreground">Use {sourceTag}: {modelDisplayName(fallbackLabel)}</span>
                      </SelectItem>
                      {OPENROUTER_PROVIDER_GROUPS.map((provider) => {
                        const models = OPENROUTER_MODELS.filter((model) => model.provider === provider.id);
                        if (!models.length) return null;
                        return (
                          <SelectGroup key={provider.id}>
                            <SelectSeparator />
                            <SelectLabel className="flex items-center gap-2 pl-8 text-xs uppercase tracking-wide text-muted-foreground">
                              <ModelLogo src={logoForModel(`${provider.id}/`)} size={12} />
                              {provider.name}
                            </SelectLabel>
                            {models.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                <span className="inline-flex items-center gap-2">
                                  <span className="font-medium">{model.name}</span>
                                  {model.id === DEFAULT_OPENROUTER_MODEL && (
                                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                                      Default
                                    </span>
                                  )}
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                    {model.tier}
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">{STEP_HINT[step]}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <span className="text-[10px] text-muted-foreground">
            Models are sent as OpenRouter IDs (e.g. <code className="font-mono">deepseek/deepseek-v4-pro</code>).
          </span>
          <Button variant="ghost" size="sm" onClick={resetAll} disabled={overrideCount === 0}>
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
