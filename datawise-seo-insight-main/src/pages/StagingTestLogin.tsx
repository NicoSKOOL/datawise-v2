import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSessionToken } from '@/lib/api';
import { Button } from '@/components/ui/button';

function readTokenFromLocation(): string {
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get('token');
  if (queryToken) return queryToken;

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  return hashParams.get('token') || '';
}

export default function StagingTestLogin() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const token = useMemo(readTokenFromLocation, []);

  useEffect(() => {
    let cancelled = false;

    async function login() {
      if (!token) {
        setError('Missing staging login token.');
        return;
      }

      try {
        const data = await api<{ token: string }>('/auth/staging-test-login', {
          method: 'POST',
          body: { token },
        });
        if (cancelled) return;
        setSessionToken(data.token);
        window.location.replace('/');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Staging test login failed.');
      }
    }

    void login();

    return () => {
      cancelled = true;
    };
  }, [navigate, token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-secondary/20 px-4">
      <div className="w-full max-w-sm rounded-xl border-2 bg-card p-6 text-center shadow-xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-lg">
          <span className="text-2xl font-bold text-primary-foreground">DW</span>
        </div>
        <h1 className="text-2xl font-semibold">Staging Login</h1>
        {error ? (
          <>
            <p className="mt-3 text-sm text-destructive">{error}</p>
            <Button className="mt-5 w-full" onClick={() => navigate('/auth', { replace: true })}>
              Back to sign in
            </Button>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Signing you in to the staging app...</p>
        )}
      </div>
    </div>
  );
}
