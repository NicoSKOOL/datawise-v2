import { useQuery } from '@tanstack/react-query';
import { api, getSessionToken } from '@/lib/api';

// White-label branding for report exports. Stored on the user row in the
// worker; the export engine receives a resolved BrandingConfig where the logo
// is already a PNG data URL so renderers never need network access.

export interface BrandingConfig {
  logoDataUrl?: string;
  primaryColor?: string;
  brandName?: string;
}

export interface BrandingResponse {
  logo_url: string | null;
  brand_color: string | null;
  brand_name: string | null;
}

export function getBranding(): Promise<BrandingResponse> {
  return api<BrandingResponse>('/api/branding');
}

export function updateBranding(body: {
  brand_color?: string | null;
  brand_name?: string | null;
}): Promise<BrandingResponse> {
  return api<BrandingResponse>('/api/branding', { method: 'PATCH', body });
}

export async function uploadBrandingLogo(file: File): Promise<BrandingResponse> {
  const token = getSessionToken();
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/api/branding/logo`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export function deleteBrandingLogo(): Promise<{ success: boolean }> {
  return api<{ success: boolean }>('/api/branding/logo', { method: 'DELETE' });
}

export const BRANDING_QUERY_KEY = ['branding'] as const;

export function useBranding() {
  return useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: getBranding,
    staleTime: 5 * 60 * 1000,
  });
}

// Normalize any supported logo format (PNG, JPEG, WebP) to a PNG data URL at
// natural size. jsPDF and docx both embed PNG reliably; WebP would otherwise
// fail inside jsPDF.addImage and docx ImageRun.
async function blobToPngDataUrl(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode logo image'));
      el.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchLogoDataUrl(logoUrl: string): Promise<string> {
  const res = await fetch(logoUrl);
  if (!res.ok) throw new Error(`Logo fetch failed: ${res.status}`);
  const blob = await res.blob();
  // FileReader gives us a data URL directly, but the renderers need PNG, so
  // route through a canvas. FileReader stays as the fallback for same-format
  // blobs if canvas conversion ever fails.
  try {
    return await blobToPngDataUrl(blob);
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }
}

// Resolve the branding to attach to an export. Returns undefined when the
// user has nothing configured so default exports stay byte-identical.
// Exports must never fail because branding failed: on any error this returns
// whatever subset is still usable (color/name without logo) or undefined.
export async function resolveBrandingForExport(): Promise<BrandingConfig | undefined> {
  let data: BrandingResponse;
  try {
    data = await getBranding();
  } catch {
    return undefined;
  }

  const config: BrandingConfig = {};
  if (data.brand_color) config.primaryColor = data.brand_color;
  if (data.brand_name) config.brandName = data.brand_name;

  if (data.logo_url) {
    try {
      config.logoDataUrl = await fetchLogoDataUrl(data.logo_url);
    } catch {
      // Logo failed to load: continue with color/name only.
    }
  }

  return Object.keys(config).length > 0 ? config : undefined;
}
