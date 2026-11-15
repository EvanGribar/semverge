import type { NextRequest } from 'next/server';
import { authorizeGithub, browserAuthConfig, isToken, sessionCookie, tokenDigest } from '../../../browser-auth';
import { parseRepositoryRequest } from '../../../repository-connections';
import { configuredWorkspacesForSession } from '../../../workspace-store';

export const dynamic = 'force-dynamic';

export function GET() {
  const config = browserAuthConfig();
  if (!config) return new Response('GitHub sign-in is unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return authorizeGithub(config);
}

export async function POST(request: NextRequest) {
  const config = browserAuthConfig();
  const session = request.cookies.get(sessionCookie)?.value;
  const deny = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!config || request.headers.get('origin') !== config.origin || !isToken(session)) return deny(403);
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return deny(415);
  try {
    const form = await request.formData();
    const intent = parseRepositoryRequest({
      workspaceId: form.get('workspaceId'), name: form.get('repository'), releaseBranch: form.get('releaseBranch'),
    });
    if (!intent) return deny(400);
    const workspaces = await configuredWorkspacesForSession(tokenDigest(session));
    if (!workspaces.some(({ id, canConnectRepositories }) => id === intent.workspaceId && canConnectRepositories)) return deny(403);
    return authorizeGithub(config, Buffer.from(JSON.stringify(intent)).toString('base64url'));
  } catch {
    return deny(503);
  }
}
