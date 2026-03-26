import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSessionToken } from '@/lib/api';

// Handles the redirect from Google OAuth callback
// The worker redirects to /auth/callback?token=xxx
export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const error = params.get('error');

    if (token) {
      setSessionToken(token);
      navigate('/', { replace: true });
    } else {
      navigate(`/auth?error=${error || 'unknown'}`, { replace: true });
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}
