import type { NextRequest } from 'next/server';
import { authRedirect, browserAuthConfig, isToken, oauthCookie, oauthOptions, randomToken, sameState, sessionCookie, sessionOptions, sessionSeconds, tokenDigest } from '../../../../browser-auth';
import { repositoryCandidate } from '../../../../github-repository';
import { parseRepositoryRequest } from '../../../../repository-connections';
import { connectWorkspaceRepository, createBrowserSession } from '../../../../workspace-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = browserAuthConfig();
  if (!config) return new Response('GitHub sign-in is unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const [state, verifier, connection] = (request.cookies.get(oauthCookie)?.value ?? '').split('.');
  const code = request.nextUrl.searchParams.get('code');
  function finish(error?: string, workspaceId?: string) {
    const url = new URL('/workspaces', config!.origin);
    if (workspaceId) {
      url.searchParams.set('workspace', workspaceId);
      url.searchParams.set('connection', error ?? 'connected');
    } else if (error) url.searchParams.set('sign-in', error);
    const response = authRedirect(url.href);
    response.cookies.set(oauthCookie, '', { ...oauthOptions(config!.secure), maxAge: 0 });
    return response;
  }
  if (!code || code.length > 256 || !sameState(state, request.nextUrl.searchParams.get('state') ?? '') ||
      !isToken(verifier)) return finish('failed');

  try {
    const signal = AbortSignal.timeout(7000);
    const exchange = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.callback,
        code, code_verifier: verifier,
      }),
    });
    if (!exchange.ok) return finish('failed');
    const result = await exchange.json() as { access_token?: unknown };
    if (typeof result.access_token !== 'string' || !result.access_token) return finish('failed');

    const profile = await fetch('https://api.github.com/user', {
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${result.access_token}` },
    });
    if (!profile.ok) return finish('failed');
    const user = await profile.json() as { id?: unknown };
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id < 1) return finish('failed');

    if (connection) {
      const intent = parseRepositoryRequest(JSON.parse(Buffer.from(connection, 'base64url').toString('utf8')));
      const session = request.cookies.get(sessionCookie)?.value;
      if (!intent || !isToken(session)) return finish('failed');
      try {
        const binding = await repositoryCandidate(intent.name, intent.releaseBranch, result.access_token, {
          appId: process.env.SEMVERGE_GITHUB_APP_ID ?? '',
          privateKey: process.env.SEMVERGE_GITHUB_APP_PRIVATE_KEY ?? '',
        }, signal);
        const connected = await connectWorkspaceRepository(tokenDigest(session), user.id, intent.workspaceId, binding);
        return finish(connected ? undefined : 'not-connected', intent.workspaceId);
      } catch {
        return finish('not-connected', intent.workspaceId);
      }
    }

    const session = randomToken();
    if (!await createBrowserSession(user.id, tokenDigest(session), sessionSeconds)) return finish('no-membership');
    const response = finish();
    response.cookies.set(sessionCookie, session, sessionOptions(config.secure));
    return response;
  } catch {
    return finish('failed');
  }
}
