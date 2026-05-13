import { api } from './api';
import type { GSCProperty } from './gsc';

export async function connectBWT() {
  return api<{ url: string }>('/bwt/connect', { method: 'POST' });
}

export async function getBWTProperties() {
  return api<{ connected: boolean; properties: GSCProperty[] }>('/bwt/properties');
}

export async function refreshBWTProperties() {
  return api<{ success: boolean; count: number; properties: GSCProperty[] }>('/bwt/properties/refresh', {
    method: 'POST',
  });
}

export async function disconnectBWT() {
  return api<{ success: boolean }>('/bwt/disconnect', { method: 'POST' });
}
