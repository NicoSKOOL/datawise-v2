import { CheckSquare } from 'lucide-react';

export default function Tasks() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground">Actionable items from your SEO analysis and chat conversations</p>
      </div>

      <div className="flex flex-col items-center justify-center min-h-[400px] rounded-xl border-2 border-dashed">
        <CheckSquare className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground">Coming in Phase 2</h3>
        <p className="text-sm text-muted-foreground/60 mt-1">Tasks will be generated from your SEO Assistant conversations</p>
      </div>
    </div>
  );
}
