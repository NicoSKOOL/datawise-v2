import { api } from './api';

export interface ChecklistItem {
  citation_key: string;
  completed_at: string;
}

export async function fetchChecklist(): Promise<ChecklistItem[]> {
  const res = await api<{ items: ChecklistItem[] }>('/api/citations/checklist');
  return res.items ?? [];
}

export async function setChecklistItem(citation_key: string, completed: boolean): Promise<void> {
  await api('/api/citations/checklist', {
    method: 'POST',
    body: { citation_key, completed },
  });
}

export interface CustomCitation {
  id: string;
  name: string;
  url: string;
  category: string | null;
  created_at: string;
}

export async function fetchCustomCitations(projectId: string): Promise<CustomCitation[]> {
  const res = await api<{ items: CustomCitation[] }>(`/api/citations/custom?project_id=${encodeURIComponent(projectId)}`);
  return res.items ?? [];
}

export async function createCustomCitation(input: {
  project_id: string;
  name: string;
  url: string;
  category?: string;
}): Promise<CustomCitation> {
  const res = await api<{ item: CustomCitation }>('/api/citations/custom', {
    method: 'POST',
    body: input,
  });
  return res.item;
}

export async function deleteCustomCitation(id: string): Promise<void> {
  await api(`/api/citations/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
