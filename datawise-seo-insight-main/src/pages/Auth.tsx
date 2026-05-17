import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate, Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowRight, LogIn, UserPlus } from 'lucide-react';

type AuthMode = 'login' | 'signup' | null;

export default function Auth() {
  const { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const modeParam = searchParams.get('mode');
  const [mode, setMode] = useState<AuthMode>(modeParam === 'signup' ? 'signup' : modeParam === 'login' ? 'login' : null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const setAuthMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextMode) {
        next.set('mode', nextMode);
      } else {
        next.delete('mode');
      }
      return next;
    }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const isSignup = mode === 'signup';
  const isChoosing = mode === null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email, password, name || undefined);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: mode === 'signup' ? 'Sign up failed' : 'Sign in failed',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] px-4 py-8 text-foreground sm:py-12">
      <div className="mx-auto flex w-full max-w-[430px] flex-col items-center gap-7">
        {/* Logo / Branding */}
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
            <span className="text-2xl font-bold text-primary-foreground">DW</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">DataWise</h1>
          <p className="mx-auto max-w-xs text-sm leading-6 text-muted-foreground">
            AI-powered SEO intelligence for the{' '}
            <span className="font-semibold text-foreground">AI Ranking</span> community
          </p>
        </div>

        <div className="w-full space-y-5 rounded-2xl border border-border/70 bg-card p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] sm:p-6">
          {isChoosing ? (
            <>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">Continue to DataWise</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Pick the option that matches your account status.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className="group flex w-full items-center gap-3 rounded-xl bg-primary p-4 text-left text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15">
                    <LogIn className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block text-base font-semibold">Log in</span>
                    <span className="block text-sm font-normal leading-5 text-primary-foreground/85">
                      For returning members with an existing account.
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => setAuthMode('signup')}
                  className="group flex w-full items-center gap-3 rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary/40 hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                    <UserPlus className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block text-base font-semibold">Create an account</span>
                    <span className="block text-sm font-normal leading-5 text-muted-foreground">
                      New to DataWise or joining from AI Ranking Skool.
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                </button>
              </div>

              <p className="rounded-lg bg-secondary/45 px-3 py-2 text-center text-xs leading-5 text-muted-foreground">
                Premium community members should use the same email they used to join.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setAuthMode(null)}
                className="text-xs font-medium text-muted-foreground hover:text-primary hover:underline"
              >
                Back to choices
              </button>

              <div className="space-y-2 text-center">
                <h2 className="text-xl font-semibold">
                  {isSignup ? 'Create your DataWise account' : 'Log in to DataWise'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {isSignup
                    ? 'New here or joining from the premium community? Start with the same email you used to join.'
                    : 'Already created your account? Use the same Google or email login you used before.'}
                </p>
              </div>

              {/* Google OAuth */}
              <div className="space-y-3">
                <Button
                  onClick={signInWithGoogle}
                  className="w-full h-11 text-sm font-semibold gap-3"
                >
                  <GoogleIcon />
                  {isSignup ? 'Create account with Google' : 'Log in with Google'}
                </Button>
                {isSignup && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Premium community members: use the same email you used to join. If your
                    DataWise account already exists, Google will log you in.
                  </p>
                )}
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    or {isSignup ? 'create with email' : 'log in with email'}
                  </span>
                </div>
              </div>

              {/* Email / Password Form */}
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                {isSignup && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full h-11" disabled={submitting}>
                  {submitting
                    ? 'Please wait...'
                    : isSignup
                      ? 'Create account with email'
                      : 'Log in with email'}
                </Button>
                {!isSignup && (
                  <div className="text-right">
                    <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-primary hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                )}
              </form>

              <div className="text-center text-sm">
                {!isSignup ? (
                  <p className="text-muted-foreground">
                    No account?{' '}
                    <button
                      type="button"
                      onClick={() => setAuthMode('signup')}
                      className="text-primary font-medium hover:underline"
                    >
                      Create one
                    </button>
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className="text-primary font-medium hover:underline"
                    >
                      Log in
                    </button>
                  </p>
                )}
              </div>
            </>
          )}

          <div className="flex items-center justify-center gap-2">
            <a
              href="https://www.skool.com/ai-ranking"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Join AI Ranking Skool for full access
            </a>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
