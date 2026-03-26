import type { Env } from '../index';

export async function sendPasswordResetEmail(
  env: Env,
  to: string,
  name: string | null,
  resetUrl: string
): Promise<boolean> {
  const displayName = name || 'there';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; background: #6366f1; border-radius: 12px; line-height: 48px; color: white; font-weight: bold; font-size: 18px;">DW</div>
        <h1 style="margin: 16px 0 0; font-size: 24px; color: #111;">DataWise</h1>
      </div>
      <p style="color: #333; font-size: 16px; line-height: 1.5;">Hi ${displayName},</p>
      <p style="color: #333; font-size: 16px; line-height: 1.5;">We received a request to reset your password. Click the button below to create a new one:</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Reset Password</a>
      </div>
      <p style="color: #666; font-size: 14px; line-height: 1.5;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">DataWise SEO by AI Ranking Skool</p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'DataWise <noreply@datawiseseo.com>',
        to: [to],
        subject: 'Reset your DataWise password',
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend email error:', err);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to send reset email:', err);
    return false;
  }
}

export async function sendCreditsExhaustedEmail(
  env: Env,
  to: string,
  name: string | null
): Promise<boolean> {
  const displayName = name || 'there';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; background: #6366f1; border-radius: 12px; line-height: 48px; color: white; font-weight: bold; font-size: 18px;">DW</div>
        <h1 style="margin: 16px 0 0; font-size: 24px; color: #111;">DataWise</h1>
      </div>
      <p style="color: #333; font-size: 16px; line-height: 1.5;">Hi ${displayName},</p>
      <p style="color: #333; font-size: 16px; line-height: 1.5;">Thanks for trying out DataWise! You've used all <strong>5 free tool uses</strong>.</p>
      <p style="color: #333; font-size: 16px; line-height: 1.5;">If you'd like <strong>unlimited access</strong> to all our SEO tools, join the AI Ranking community on Skool:</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://www.skool.com/ai-ranking/" style="display: inline-block; background: #6366f1; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Join the Community</a>
      </div>
      <p style="color: #666; font-size: 14px; line-height: 1.5;">As a community member, you'll get unlimited access to keyword research, competitor analysis, AI visibility checks, rank tracking, and more.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">DataWise SEO by AI Ranking Skool</p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'DataWise <noreply@datawiseseo.com>',
        to: [to],
        subject: "You've reached your free quota on DataWise",
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend credits exhausted email error:', err);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to send credits exhausted email:', err);
    return false;
  }
}

export async function sendInviteEmail(
  env: Env,
  to: string,
  name: string | null,
  activateUrl: string
): Promise<boolean> {
  const displayName = name || 'there';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; background: #6366f1; border-radius: 12px; line-height: 48px; color: white; font-weight: bold; font-size: 18px;">DW</div>
        <h1 style="margin: 16px 0 0; font-size: 24px; color: #111;">DataWise</h1>
      </div>
      <p style="color: #333; font-size: 16px; line-height: 1.5;">Hi ${displayName},</p>
      <p style="color: #333; font-size: 16px; line-height: 1.5;">You've been invited to <strong>DataWise</strong>, the AI-powered SEO intelligence platform for the AI Ranking community.</p>
      <p style="color: #333; font-size: 16px; line-height: 1.5;">As a community member, you get <strong>unlimited access</strong> to all features. Click below to set your password and activate your account:</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${activateUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Activate Your Account</a>
      </div>
      <p style="color: #666; font-size: 14px; line-height: 1.5;">You can also sign in with Google using this email address. This activation link expires in 24 hours.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">DataWise SEO by AI Ranking Skool</p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'DataWise <noreply@datawiseseo.com>',
        to: [to],
        subject: 'You\'re invited to DataWise SEO',
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend invite email error:', err);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to send invite email:', err);
    return false;
  }
}
