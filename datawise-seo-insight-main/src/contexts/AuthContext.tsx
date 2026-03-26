import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getSessionToken, setSessionToken, clearSessionToken } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface User {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string;
  subscription_tier: 'free' | 'pro' | 'community';
  is_community_member: boolean;
  credits_used: number;
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
  isAdmin: boolean;
  isCommunityMember: boolean;
  isPro: boolean;
  creditsRemaining: number;
  creditsLimit: number;
  hasCredits: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchUser = useCallback(async () => {
    const token = getSessionToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const data = await api<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch {
      clearSessionToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Handle OAuth callback token from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const error = params.get('error');

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

  const signInWithGoogle = async () => {
    try {
      const data = await api<{ url: string }>('/auth/google', { method: 'POST' });
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

  const isCommunityMember = user?.is_community_member ?? false;
  const isPro = user?.subscription_tier === 'pro' || user?.subscription_tier === 'community';
  const unlimited = isCommunityMember || isPro;
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
    isAdmin: user?.email === 'nico@airankingskool.com',
    isCommunityMember,
    isPro,
    creditsRemaining,
    creditsLimit: FREE_CREDITS_LIMIT,
    hasCredits: unlimited || creditsRemaining > 0,
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
