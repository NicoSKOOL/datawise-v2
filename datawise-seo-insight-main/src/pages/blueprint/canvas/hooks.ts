import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiSuccess, BlueprintGraphResponse, BlueprintLatestView, BlueprintPageDetail } from './types';

// Every Blueprint route returns { requestId, data }; api() returns the body
// as-is, so each hook unwraps `.data` via `select` (mirrors BlueprintHome.tsx's
// blueprintApi<ApiSuccess<T>>(...).then((res) => res.data) convention).

export function useLatestBlueprint(projectId: string): UseQueryResult<BlueprintLatestView> {
  return useQuery({
    queryKey: ['blueprint', 'latest', projectId],
    queryFn: () => api<ApiSuccess<BlueprintLatestView>>(`/api/blueprint/v1/projects/${projectId}/blueprints/latest`),
    select: (res) => res.data,
    retry: false,
  });
}

export function useBlueprintGraph(revisionId: string | undefined): UseQueryResult<BlueprintGraphResponse> {
  return useQuery({
    queryKey: ['blueprint', 'graph', revisionId],
    queryFn: () => api<ApiSuccess<BlueprintGraphResponse>>(`/api/blueprint/v1/blueprint-revisions/${revisionId}/graph`),
    select: (res) => res.data,
    enabled: !!revisionId,
  });
}

export function useBlueprintPage(revisionId: string | undefined, pageId: string | null): UseQueryResult<BlueprintPageDetail> {
  return useQuery({
    queryKey: ['blueprint', 'page', revisionId, pageId],
    queryFn: () => api<ApiSuccess<BlueprintPageDetail>>(`/api/blueprint/v1/blueprint-revisions/${revisionId}/pages/${pageId}`),
    select: (res) => res.data,
    enabled: !!revisionId && !!pageId,
  });
}
