import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

const RELOAD_FLAG = 'dw_chunk_reload_at';
const RELOAD_WINDOW_MS = 60_000;

function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_ERROR_RE.test(`${error.name}: ${error.message}`);
}

// After a deploy, chunk filenames change and a stale client can fail to fetch a
// lazy route. One automatic reload picks up the new bundle; the sessionStorage
// timestamp stops a broken deploy from causing a reload loop.
function tryReloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

interface Props {
  children: ReactNode;
  /** "app" renders a full-screen fallback; "route" keeps the surrounding layout alive. */
  variant: 'app' | 'route';
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
  reloading: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary] Render crashed:', error, info?.componentStack);
    if (isChunkLoadError(error) && tryReloadOnceForStaleChunk()) {
      this.setState({ error, info, reloading: true });
      return;
    }
    this.setState({ error, info });
  }

  private reset = () => {
    this.setState({ error: null, info: null, reloading: false });
  };

  render() {
    const { error, info, reloading } = this.state;
    if (!error) return this.props.children;

    if (reloading) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      );
    }

    const staleChunk = isChunkLoadError(error);
    const title = staleChunk
      ? 'A new version of DataWise was deployed'
      : 'Something went wrong';
    const message = staleChunk
      ? 'Your browser has an older version of the app. Refresh the page to load the latest version.'
      : 'This page hit an unexpected error. Try again, or reload the page. If it keeps happening, send us the details below from the feedback bubble.';

    const card = (
      <div className="max-w-xl w-full rounded-lg border bg-card text-card-foreground shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0" />
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex gap-2">
          {!staleChunk && (
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90"
          >
            Reload page
          </button>
        </div>
        {!staleChunk && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Error details</summary>
            <pre className="mt-2 rounded-md border bg-muted/50 p-3 whitespace-pre-wrap overflow-auto max-h-64">
              <span className="font-bold">{error.name}: </span>
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
              {info?.componentStack ? `\n\n--- component stack ---${info.componentStack}` : ''}
            </pre>
          </details>
        )}
      </div>
    );

    if (this.props.variant === 'app') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          {card}
        </div>
      );
    }
    return <div className="min-h-[60vh] flex items-center justify-center p-6">{card}</div>;
  }
}

export function RouteLoadingFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}
