import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const oauthCookie = 'semverge_github_oauth';
export const sessionCookie = 'semverge_session';
export const sessionSeconds = 8 * 60 * 60;
export const randomToken = () => randomBytes(32).toString('base64url');
export const tokenDigest = (token: string) => createHash('sha256').update(token).digest();

export function browserAuthConfig() {
  const { SEMVERGE_ORIGIN, SEMVERGE_GITHUB_CLIENT_ID, SEMVERGE_GITHUB_CLIENT_SECRET, SEMVERGE_DATABASE_URL } = process.env;
  if (!SEMVERGE_ORIGIN || !SEMVERGE_GITHUB_CLIENT_ID || !SEMVERGE_GITHUB_CLIENT_SECRET || !SEMVERGE_DATABASE_URL) return;
  try {
    const url = new URL(SEMVERGE_ORIGIN);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.origin !== SEMVERGE_ORIGIN || (!local && url.protocol !== 'https:')) return;
    return {
      origin: url.origin,
      secure: !local,
      callback: new URL('/api/auth/github/callback', url).href,
      clientId: SEMVERGE_GITHUB_CLIENT_ID,
      clientSecret: SEMVERGE_GITHUB_CLIENT_SECRET,
    };
  } catch {
    return;
  }
}

export function isToken(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function sameState(expected: string, supplied: string) {
  return isToken(expected) && isToken(supplied) && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function authRedirect(url: string, status: 302 | 303 = 302) {
  const response = NextResponse.redirect(url, status);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export function oauthOptions(secure: boolean) {
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/api/auth/github', maxAge: 600 };
}

export function sessionOptions(secure: boolean) {
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: sessionSeconds };
}

export function authorizeGithub(config: NonNullable<ReturnType<typeof browserAuthConfig>>, intent?: string) {
  const state = randomToken();
  const verifier = randomToken();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.callback, state,
    code_challenge: tokenDigest(verifier).toString('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  const response = authRedirect(url.href, intent ? 303 : 302);
  const cookie = [state, verifier, intent].filter(Boolean).join('.');
  response.cookies.set(oauthCookie, cookie, oauthOptions(config.secure));
  return response;
}
