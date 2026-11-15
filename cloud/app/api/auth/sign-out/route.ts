import type { NextRequest } from 'next/server';
import { authRedirect, browserAuthConfig, isToken, sessionCookie, sessionOptions, tokenDigest } from '../../../browser-auth';
import { deleteBrowserSession } from '../../../workspace-store';

export async function POST(request: NextRequest) {
  const config = browserAuthConfig();
  if (!config || request.headers.get('origin') !== config.origin) {
    return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const session = request.cookies.get(sessionCookie)?.value;
  try {
    if (isToken(session)) await deleteBrowserSession(tokenDigest(session));
  } catch {
    return new Response('Sign-out is unavailable. Try again.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const response = authRedirect(new URL('/workspaces', config.origin).href, 303);
  response.cookies.set(sessionCookie, '', { ...sessionOptions(config.secure), maxAge: 0 });
  return response;
}

