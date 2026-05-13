import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class SiteAuditErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    // Also surface to the console so we can read it in DevTools
    console.error('[SiteAudit] Render crashed:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border-2 border-red-500/40 bg-red-50 p-6 space-y-3">
          <h2 className="text-lg font-semibold text-red-700">Site Audit page crashed</h2>
          <p className="text-sm text-red-900">
            Something in the dashboard threw an error. Reload the page; if that doesn't help,
            share the details below with the team.
          </p>
          <pre className="rounded-md bg-white/80 border border-red-200 p-3 text-xs whitespace-pre-wrap overflow-auto max-h-64">
            <span className="font-bold">{this.state.error.name}: </span>
            {this.state.error.message}
            {this.state.error.stack && (
              <>
                {'\n\n'}
                {this.state.error.stack}
              </>
            )}
            {this.state.info?.componentStack && (
              <>
                {'\n\n--- component stack ---'}
                {this.state.info.componentStack}
              </>
            )}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null, info: null })}
            className="inline-flex items-center rounded-md bg-red-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
