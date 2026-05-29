import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  outputLanguageOptions,
  saveOutputLanguagePreference,
  type OutputLanguageCode,
} from '@/lib/output-language';

interface OutputLanguageSelectProps {
  value: OutputLanguageCode;
  onValueChange: (value: OutputLanguageCode) => void;
  id?: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
  /** Render the bare Select with no stacked label/description (for inline rows). */
  hideLabel?: boolean;
  /** Accessible name used when hideLabel is set. Falls back to label. */
  ariaLabel?: string;
  /** Extra classes for the trigger, e.g. a fixed width to match an adjacent button. */
  triggerClassName?: string;
}

export function OutputLanguageSelect({
  value,
  onValueChange,
  id = 'output-language',
  label = 'AI Output Language',
  description,
  disabled,
  className = '',
  hideLabel = false,
  ariaLabel,
  triggerClassName = '',
}: OutputLanguageSelectProps) {
  const handleChange = (nextValue: string) => {
    const next = nextValue as OutputLanguageCode;
    saveOutputLanguagePreference(next);
    onValueChange(next);
  };

  const select = (
    <Select value={value} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={hideLabel ? (ariaLabel ?? label) : undefined} className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {outputLanguageOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span>{option.label}</span>
            {option.description ? (
              <span className="ml-2 text-xs text-muted-foreground">{option.description}</span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (hideLabel) {
    return className ? <div className={className}>{select}</div> : select;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {select}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
