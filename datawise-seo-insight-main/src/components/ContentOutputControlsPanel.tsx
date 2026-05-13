import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  contentOutputLengthOptions,
  contentOutputRegisterOptions,
  contentOutputSourcePolicyOptions,
  outputLanguageOptions,
  saveContentOutputControlsPreference,
  type ContentOutputControls,
  type ContentOutputLength,
  type ContentOutputRegister,
  type ContentOutputSourcePolicy,
  type OutputLanguageCode,
} from '@/lib/output-language';

interface ContentOutputControlsPanelProps {
  value: ContentOutputControls;
  onValueChange: (value: ContentOutputControls) => void;
  idPrefix?: string;
  title?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

type ToggleKey = 'include_tldr' | 'include_tables' | 'include_faq' | 'include_meta';

const toggleOptions: Array<{ key: ToggleKey; label: string; description: string }> = [
  {
    key: 'include_tldr',
    label: 'TL;DR',
    description: 'Add a short direct-answer summary near the top when the output is long-form.',
  },
  {
    key: 'include_tables',
    label: 'Tables',
    description: 'Use markdown tables where they improve comparisons, lists, or local proof.',
  },
  {
    key: 'include_faq',
    label: 'FAQ',
    description: 'Include FAQ output where the tool supports it.',
  },
  {
    key: 'include_meta',
    label: 'Meta',
    description: 'Generate meta title and description suggestions where supported.',
  },
];

export function ContentOutputControlsPanel({
  value,
  onValueChange,
  idPrefix = 'content-output',
  title = 'Content Output Controls',
  description,
  disabled,
  className = '',
}: ContentOutputControlsPanelProps) {
  const update = (next: ContentOutputControls) => {
    saveContentOutputControlsPreference(next);
    onValueChange(next);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="space-y-1">
        <Label className="text-sm font-semibold">{title}</Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SelectField
          id={`${idPrefix}-language`}
          label="Language"
          value={value.language}
          options={outputLanguageOptions}
          disabled={disabled}
          onValueChange={(language) => update({ ...value, language })}
        />
        <SelectField
          id={`${idPrefix}-register`}
          label="Register"
          value={value.register}
          options={contentOutputRegisterOptions}
          disabled={disabled}
          onValueChange={(register) => update({ ...value, register })}
        />
        <SelectField
          id={`${idPrefix}-length`}
          label="Length"
          value={value.length}
          options={contentOutputLengthOptions}
          disabled={disabled}
          onValueChange={(length) => update({ ...value, length })}
        />
        <SelectField
          id={`${idPrefix}-source-policy`}
          label="Sources"
          value={value.source_policy}
          options={contentOutputSourcePolicyOptions}
          disabled={disabled}
          onValueChange={(sourcePolicy) => update({ ...value, source_policy: sourcePolicy })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {toggleOptions.map((option) => (
          <div key={option.key} className="flex items-start justify-between gap-3 rounded-md bg-muted/40 p-3">
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-${option.key}`} className="text-sm">{option.label}</Label>
              <p className="text-xs leading-snug text-muted-foreground">{option.description}</p>
            </div>
            <Switch
              id={`${idPrefix}-${option.key}`}
              checked={value[option.key]}
              disabled={disabled}
              onCheckedChange={(checked) => update({ ...value, [option.key]: checked })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  id: string;
  label: string;
  value: T;
  disabled?: boolean;
  options: Array<{ value: T; label: string; description: string }>;
  onValueChange: (value: T) => void;
}

function SelectField<T extends OutputLanguageCode | ContentOutputRegister | ContentOutputLength | ContentOutputSourcePolicy>({
  id,
  label,
  value,
  options,
  disabled,
  onValueChange,
}: SelectFieldProps<T>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onValueChange(next as T)} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div>
                <span>{option.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{option.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
