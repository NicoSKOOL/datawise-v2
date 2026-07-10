import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface BlueprintHealth {
  ok: boolean;
  module: string;
  version: string;
  checks: Record<string, string>;
}

export default function BlueprintHome() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['blueprint-health'],
    queryFn: () => api<BlueprintHealth>('/api/blueprint/v1/health'),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Blueprint</h1>
      <p className="text-muted-foreground">
        Website architecture planner (admin preview). Turns a business brief into an
        evidence-backed site structure.
      </p>
      {isLoading && <p className="text-sm">Checking Blueprint backend...</p>}
      {error && (
        <p className="text-sm text-destructive">
          Backend check failed: {(error as Error).message}
        </p>
      )}
      {data && (
        <div className="rounded-md border p-4 text-sm space-y-1">
          <p className="font-medium">Backend status: {data.ok ? 'healthy' : 'degraded'}</p>
          {Object.entries(data.checks).map(([name, status]) => (
            <p key={name}>
              {name}: {status}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
