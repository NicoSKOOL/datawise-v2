import { api } from './api';

export interface PromoStatus {
  active: boolean;
  label: string | null;
  expires_at: string | null;
}

export function redeemPromoCode(code: string): Promise<{ success: boolean; label: string; expires_at: string }> {
  return api('/api/promo/redeem', {
    method: 'POST',
    body: { code },
  });
}

export function fetchPromoStatus(): Promise<PromoStatus> {
  return api('/api/promo/status');
}
