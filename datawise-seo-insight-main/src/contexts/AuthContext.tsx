import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getSessionToken, setSessionToken, clearSessionToken } from '@/lib/api';
import { fetchPromoStatus, redeemPromoCode, type PromoStatus } from '@/lib/promo';
import { getAttribution } from '@/lib/attribution';
import { useToast } from '@/hooks/use-toast';

interface User {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string;
  subscription_tier: 'free' | 'pro' | 'community';
  is_community_member: boolean;
  is_admin: boolean;
  credits_used: number;
  default_location_code: number;
  default_language_code: string;
}

const FREE_CREDITS_LIMIT = 5;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name?: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshPromoStatus: () => Promise<void>;
  isAdmin: boolean;
  isCommunityMember: boolean;
  isPro: boolean;
  creditsRemaining: number;
  creditsLimit: number;
  hasCredits: boolean;
  promoActive: boolean;
  promoExpiresAt: string | null;
  promoLabel: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoActive, setPromoActive] = useState(false);
  const [promoExpiresAt, setPromoExpiresAt] = useState<string | null>(null);
  const [promoLabel, setPromoLabel] = useState<string | null>(null);
  const { toast } = useToast();

  const loadPromoStatus = useCallback(async () => {
    try {
      const status = await fetchPromoStatus();
      setPromoActive(status.active);
      setPromoExpiresAt(status.expires_at);
      setPromoLabel(status.label);
    } catch {
      // Promo status not available, keep defaults
    }
  }, []);

  const fetchUser = useCallback(async () => {
    let token = getSessionToken();
    const canUseDevLogin = import.meta.env.DEV
      && typeof window !== 'undefined'
      && window.location.hostname === 'localhost';

    async function mintDevSession(): Promise<string | null> {
      if (!canUseDevLogin) return null;
      try {
        const devResp = await api<{ token: string }>('/auth/dev-login', { method: 'POST' });
        if (devResp?.token) {
          setSessionToken(devResp.token);
          return devResp.token;
        }
      } catch {
        // Dev-login not available (worker not running, prod API, non-dev env): fall through.
      }
      return null;
    }

    // Dev convenience: on localhost, auto-mint a session against the worker's
    // /auth/dev-login endpoint (which only responds in ENVIRONMENT=development).
    if (!token) {
      token = await mintDevSession();
    }

    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const data = await api<{ user: User }>('/auth/me');
      setUser(data.user);
      // Load promo status after user is fetched
      await loadPromoStatus();
    } catch {
      clearSessionToken();
      const devToken = await mintDevSession();
      if (devToken) {
        try {
          const data = await api<{ user: User }>('/auth/me');
          setUser(data.user);
          await loadPromoStatus();
          return;
        } catch {
          clearSessionToken();
        }
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [loadPromoStatus]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Handle OAuth callback token from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const error = params.get('error');
    const promoParam = params.get('promo');

    // Capture promo code from URL before it gets cleared
    if (promoParam) {
      localStorage.setItem('pending_promo_code', promoParam);
    }

    if (error) {
      const detail = params.get('detail');
      toast({
        variant: 'destructive',
        title: 'Sign in failed',
        description: `Authentication error: ${error}${detail ? ` - ${detail}` : ''}`,
      });
      window.history.replaceState({}, '', '/auth');
      setLoading(false);
      return;
    }

    if (token) {
      setSessionToken(token);
      window.history.replaceState({}, '', '/');
      fetchUser();
    }
  }, [fetchUser, toast]);

  // Auto-redeem pending promo code after auth completes
  useEffect(() => {
    if (!user) return;
    const pendingCode = localStorage.getItem('pending_promo_code');
    if (!pendingCode) return;

    localStorage.removeItem('pending_promo_code');
    redeemPromoCode(pendingCode)
      .then((result) => {
        toast({
          title: 'Promo activated!',
          description: `You have unlimited access until ${new Date(result.expires_at).toLocaleString()}.`,
        });
        loadPromoStatus();
      })
      .catch(() => {
        toast({
          variant: 'destructive',
          title: 'Promo code failed',
          description: 'The promo code is invalid or has expired.',
        });
      });
  }, [user, toast, loadPromoStatus]);

  const signInWithGoogle = async () => {
    try {
      const attribution = getAttribution();
      const data = await api<{ url: string }>('/auth/google', {
        method: 'POST',
        body: attribution ? { attribution } : {},
      });
      window.location.href = data.url;
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Sign in failed',
        description: 'Could not initiate Google sign-in. Please try again.',
      });
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    const data = await api<{ token: string }>('/auth/email/login', {
      method: 'POST',
      body: { email, password },
    });
    setSessionToken(data.token);
    await fetchUser();
  };

  const signUpWithEmail = async (email: string, password: string, name?: string) => {
    const data = await api<{ token: string }>('/auth/email/signup', {
      method: 'POST',
      body: { email, password, name },
    });
    setSessionToken(data.token);
    await fetchUser();
  };

  const forgotPassword = async (email: string) => {
    await api('/auth/forgot-password', { method: 'POST', body: { email } });
  };

  const resetPassword = async (token: string, password: string) => {
    const data = await api<{ token: string }>('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
    });
    setSessionToken(data.token);
    await fetchUser();
  };

  const signOut = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Sign out locally even if API call fails
    }
    clearSessionToken();
    setUser(null);
    toast({
      title: 'Signed out',
      description: 'You have been signed out successfully.',
    });
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  const refreshPromoStatus = async () => {
    await loadPromoStatus();
  };

  const isCommunityMember = user?.is_community_member ?? false;
  const isPro = user?.subscription_tier === 'pro' || user?.subscription_tier === 'community';
  const unlimited = isCommunityMember || isPro || promoActive;
  const creditsRemaining = unlimited ? FREE_CREDITS_LIMIT : Math.max(0, FREE_CREDITS_LIMIT - (user?.credits_used ?? 0));

  const value: AuthContextType = {
    user,
    loading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    forgotPassword,
    resetPassword,
    signOut,
    refreshUser,
    refreshPromoStatus,
    isAdmin: user?.is_admin === true || user?.email === 'nico@airankingskool.com',
    isCommunityMember,
    isPro,
    creditsRemaining,
    creditsLimit: FREE_CREDITS_LIMIT,
    hasCredits: unlimited || creditsRemaining > 0,
    promoActive,
    promoExpiresAt,
    promoLabel,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
