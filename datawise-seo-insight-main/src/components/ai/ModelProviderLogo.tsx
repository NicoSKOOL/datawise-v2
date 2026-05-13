import claudeLogo from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
import openaiLogo from '@lobehub/icons-static-svg/icons/openai.svg?url';
import openrouterLogo from '@lobehub/icons-static-svg/icons/openrouter.svg?url';
import deepseekLogo from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import perplexityLogo from '@lobehub/icons-static-svg/icons/perplexity-color.svg?url';
import moonshotLogo from '@lobehub/icons-static-svg/icons/moonshot.svg?url';

export function logoForModel(modelOrProvider: string): string {
  const lower = modelOrProvider.toLowerCase();
  if (lower.startsWith('deepseek')) return deepseekLogo;
  if (lower.startsWith('perplexity') || lower.includes('sonar')) return perplexityLogo;
  if (lower.startsWith('moonshotai') || lower.includes('kimi')) return moonshotLogo;
  if (lower.startsWith('anthropic') || lower.includes('claude')) return claudeLogo;
  if (lower.startsWith('openai') || lower.includes('gpt')) return openaiLogo;
  if (lower.startsWith('openrouter')) return openrouterLogo;
  return openrouterLogo;
}

export function ModelProviderLogo({
  model,
  size = 14,
  className = '',
}: {
  model: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={logoForModel(model)}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
