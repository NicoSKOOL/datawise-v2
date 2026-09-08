import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck, Laptop, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { setReturnTo } from '@/lib/return-to';
import { getAuthorizeRequest, approveAuthorizeRequest, denyAuthorizeRequest, McpApiError, type AuthorizeRequestInfo } from '@/lib/mcp';

const DATA_SCOPE = 'keyword research, competitor analysis, backlinks, rank tracking, AI visibility and Search Console data';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">DW</div>
          <span className="font-semibold">DataWise</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ConnectPage() {
  const { user, loading, signOut } = useAuth();
  const [params] = useSearchParams();
  const req = params.get('req') ?? '';

  const [info, setInfo] = useState<AuthorizeRequestInfo | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);

  useEffect(() => {
    if (!user || !req) return;
    let cancelled = false;
    getAuthorizeRequest(req)
      .then((data) => { if (!cancelled) setInfo(data); })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof McpApiError ? { code: err.code, message: err.message } : { code: null, message: (err as Error).message });
      });
    return () => { cancelled = true; };
  }, [user, req]);

  if (loading) {
    return <Shell><div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div></Shell>;
  }

  if (!req) {
    return <Shell><p className="text-sm">This page is opened by your AI assistant when it connects to DataWise. There is nothing to do here on its own.</p></Shell>;
  }

  if (!user) {
    setReturnTo(`/connect?req=${encodeURIComponent(req)}`);
    return <Navigate to="/auth" replace />;
  }

  const finish = async (action: 'approve' | 'deny') => {
    setBusy(action);
    try {
      const { redirect_to } = action === 'approve' ? await approveAuthorizeRequest(req) : await denyAuthorizeRequest(req);
      window.location.assign(redirect_to);
    } catch (err) {
      setBusy(null);
      setError(err instanceof McpApiError ? { code: err.code, message: err.message } : { code: null, message: (err as Error).message });
    }
  };

  const switchAccount = async () => {
    setReturnTo(`/connect?req=${encodeURIComponent(req)}`);
    await signOut();
    window.location.assign('/auth');
  };

  if (error) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Connection could not be completed</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        {error.code === 'expired' && <p className="text-sm">Go back to your AI assistant and add the DataWise connector again. Each request is valid for ten minutes.</p>}
      </Shell>
    );
  }

  if (!info) {
    return <Shell><div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div></Shell>;
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold">Connect {info.client_name} to DataWise</h1>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{info.client_name}</span> is asking to read your DataWise {DATA_SCOPE}. Requests count against your daily data budget. It cannot change anything in your account.
      </p>

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm space-y-1">
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-green-700" /> Read-only access, revocable any time in Settings.</div>
        <div className="flex items-center gap-2">
          {info.loopback ? <Laptop className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4 text-green-700" />}
          <span>You will return to <code className="text-xs">{info.redirect_host}</code>{info.loopback ? ' (an app running on this computer, such as Claude Code)' : ''}.</span>
        </div>
        {info.loopback && (
          <div className="flex items-start gap-2 text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Only continue if you started this connection yourself from a tool on this computer.</div>
        )}
      </div>

      <p className="text-sm">Signed in as <span className="font-medium">{info.email}</span>. <button type="button" className="underline text-muted-foreground" onClick={switchAccount}>Not you?</button></p>

      {!info.access && info.denial_message && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{info.denial_message}</div>
      )}

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => finish('deny')}>
          {busy === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel'}
        </Button>
        {info.access && (
          <Button type="button" disabled={busy !== null} onClick={() => finish('approve')}>
            {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Allow'}
          </Button>
        )}
      </div>
    </Shell>
  );
}
