import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Palette, Loader2, CheckCircle, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  useBranding,
  updateBranding,
  uploadBrandingLogo,
  deleteBrandingLogo,
  BRANDING_QUERY_KEY,
} from '@/lib/branding';

const MAX_LOGO_BYTES = 1 * 1024 * 1024; // 1 MB
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#005232';

export function BrandingCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: branding, isLoading } = useBranding();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [color, setColor] = useState('');
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (branding) {
      setColor(branding.brand_color ?? '');
      setName(branding.brand_name ?? '');
      setDirty(false);
    }
  }, [branding]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: BRANDING_QUERY_KEY });

  const handleLogoSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      toast({
        variant: 'destructive',
        title: 'Unsupported file type',
        description: 'Use a PNG, JPG or WebP image.',
      });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({
        variant: 'destructive',
        title: 'File too large',
        description: 'Logo must be 1 MB or smaller.',
      });
      return;
    }
    setUploading(true);
    try {
      await uploadBrandingLogo(file);
      await refresh();
      toast({ title: 'Logo uploaded', description: 'Your exports will now use this logo.' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedColor = color.trim();
    if (trimmedColor && !HEX_COLOR_RE.test(trimmedColor)) {
      toast({
        variant: 'destructive',
        title: 'Invalid color',
        description: 'Use a 6-digit hex color like #005232.',
      });
      return;
    }
    setSaving(true);
    try {
      await updateBranding({
        brand_color: trimmedColor || null,
        brand_name: trimmedName || null,
      });
      await refresh();
      setDirty(false);
      toast({ title: 'Saved', description: 'Export branding updated.' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save branding.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      if (branding?.logo_url) {
        await deleteBrandingLogo();
      }
      await updateBranding({ brand_color: null, brand_name: null });
      await refresh();
      setColor('');
      setName('');
      setDirty(false);
      toast({ title: 'Reset', description: 'Exports will use the DataWise defaults again.' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to reset branding.',
      });
    } finally {
      setResetting(false);
    }
  };

  const hasBranding = !!(branding?.logo_url || branding?.brand_color || branding?.brand_name);

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Palette className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Export Branding</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Add your own logo, brand color, and brand name to PDF and DOCX report exports. Leave everything empty to keep the DataWise look.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading branding...</span>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              {branding?.logo_url ? (
                <img
                  src={branding.logo_url}
                  alt="Brand logo preview"
                  className="h-12 max-w-[160px] rounded border bg-white object-contain p-1"
                />
              ) : (
                <div className="flex h-12 w-24 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
                  No logo
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleLogoSelected(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="gap-2"
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                {uploading ? 'Uploading...' : branding?.logo_url ? 'Replace logo' : 'Upload logo'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG or WebP, max 1 MB.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Brand color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={HEX_COLOR_RE.test(color) ? color : DEFAULT_COLOR}
                  onChange={(e) => { setColor(e.target.value); setDirty(true); }}
                  className="h-9 w-12 cursor-pointer rounded border bg-background p-1"
                  aria-label="Pick brand color"
                />
                <Input
                  value={color}
                  onChange={(e) => { setColor(e.target.value); setDirty(true); }}
                  placeholder={DEFAULT_COLOR}
                  className="font-mono"
                  maxLength={7}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Brand name</Label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setDirty(true); }}
                placeholder="DataWise SEO"
                maxLength={60}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
              {saving ? (
                <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Saving...</>
              ) : !dirty ? (
                <><CheckCircle className="h-3 w-3 mr-1.5" />Saved</>
              ) : 'Save Branding'}
            </Button>
            {hasBranding && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3 mr-1.5" />
                )}
                Reset to DataWise defaults
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            The footer attribution line, Generated by DataWise SEO, stays on every export.
          </p>
        </>
      )}
    </div>
  );
}
