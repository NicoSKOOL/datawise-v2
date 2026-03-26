import { api } from './api';

interface UploadResult {
  success: boolean;
  imported: number;
}

interface CrossReferenceResult {
  total_csv_members: number;
  active_members: Array<{
    id: string;
    email: string;
    name: string;
    subscription_tier: string;
    created_at: string;
    first_name: string;
    last_name: string;
    community_tier: string;
    ltv: number;
    joined_date: string;
  }>;
  non_members: Array<{
    id: string;
    email: string;
    name: string;
    subscription_tier: string;
    is_community_member: number;
    created_at: string;
  }>;
  not_registered: Array<{
    email: string;
    first_name: string;
    last_name: string;
    tier: string;
    ltv: number;
    joined_date: string;
  }>;
}

interface AccessResult {
  success: boolean;
  affected: number;
}

export function uploadMembers(csvText: string): Promise<UploadResult> {
  return api<UploadResult>('/api/admin/upload-members', {
    method: 'POST',
    body: { csv: csvText },
  });
}

export function getCrossReference(): Promise<CrossReferenceResult> {
  return api<CrossReferenceResult>('/api/admin/cross-reference');
}

export function revokeAccess(userIds: string[]): Promise<AccessResult> {
  return api<AccessResult>('/api/admin/revoke-access', {
    method: 'POST',
    body: { user_ids: userIds },
  });
}

export function restoreAccess(userIds: string[]): Promise<AccessResult> {
  return api<AccessResult>('/api/admin/revoke-access', {
    method: 'POST',
    body: { user_ids: userIds, action: 'restore' },
  });
}

export function sendInvites(emails?: string[]): Promise<{ sent: number; failed: number; total: number }> {
  return api('/api/admin/send-invites', {
    method: 'POST',
    body: emails ? { emails } : {},
  });
}

export function addMember(email: string, sendInvite = true): Promise<{ status: string; message: string }> {
  return api('/api/admin/add-member', {
    method: 'POST',
    body: { email, send_invite: sendInvite },
  });
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  subscription_tier: string;
  is_community_member: number;
  is_admin: number;
  credits_used: number;
  created_at: string;
}

export function listUsers(): Promise<{ users: AppUser[] }> {
  return api('/api/admin/users');
}

export function deleteUser(userId: string): Promise<{ success: boolean }> {
  return api('/api/admin/delete-user', {
    method: 'POST',
    body: { user_id: userId },
  });
}

export function toggleMember(userId: string, action: 'grant' | 'revoke'): Promise<{ success: boolean }> {
  return api('/api/admin/toggle-member', {
    method: 'POST',
    body: { user_id: userId, action },
  });
}
