import { createHash, timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { connectedRepository, loadQueue, loadReleaseHistory } from '../../workspace-data';
import { publicRepository, type GitHubRepository, type RepositoryBinding } from '../../github-repository';
import { configuredWorkspaceForToken } from '../../workspace-store';

const metadata = {
  inputSchema: z.object({ repository: z.string().min(1).max(140).optional() }).strict(),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

type Scope = {
  name: string;
  repositories: { name: string; binding?: RepositoryBinding }[];
};

function result(data: Record<string, unknown>, isError = false) {
  return {
    isError,
    structuredContent: data,
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}

async function readRepository(scope: Scope, requested: string | undefined, read: (repo: GitHubRepository) => Promise<Record<string, unknown>>) {
  const selected = requested
    ? scope.repositories.find((item) => item.name.toLowerCase() === requested.toLowerCase())
    : scope.repositories.length === 1 ? scope.repositories[0] : undefined;
  if (!selected) {
    return result({
      workspace: scope.name,
      repositories: scope.repositories.map(({ name }) => name),
      message: requested ? 'Repository is not connected to this workspace.' : 'Choose a repository connected to this workspace.',
    }, true);
  }
  try {
    const reader = selected.binding
      ? await connectedRepository(selected.binding, AbortSignal.timeout(5000))
      : publicRepository;
    return result({ workspace: scope.name, ...(await read(reader)) });
  } catch {
    return result({ repository: selected.name, unavailable: true, message: 'GitHub repository evidence is unavailable.' }, true);
  }
}

function createScopedHandler(scope: Scope) {
  return createMcpHandler((server) => {
    server.registerTool('release_status', {
      ...metadata,
      description: 'Read open SemVerge release plans, recorded readiness, and PR evidence. Supply owner/repository when the workspace has multiple repositories.',
    }, async ({ repository }) => readRepository(scope, repository, async (repo) => ({
      repository: repo.name,
      sourceUrl: `https://github.com/${repo.name}/pulls`,
      ...await loadQueue(repo),
    })));

    server.registerTool('release_blockers', {
      ...metadata,
      description: 'Read readiness blockers recorded at each open release PR head. An unavailable report is distinct from an empty blocker list.',
    }, async ({ repository }) => readRepository(scope, repository, async (repo) => {
      const { entries, unavailable } = await loadQueue(repo);
      return {
        repository: repo.name,
        sourceUrl: `https://github.com/${repo.name}/pulls`,
        unavailable,
        plans: entries.map(({ number, version, status, blockers, url }) => ({ number, version, status, blockers, url })),
      };
    }));

    server.registerTool('latest_release_outcome', {
      ...metadata,
      description: 'Read the latest GitHub release and its recorded SemVerge verification outcome.',
    }, async ({ repository }) => readRepository(scope, repository, async (repo) => {
      const source = await loadReleaseHistory(repo, false);
      const release = source.kind === 'GitHub releases' ? source.releases[0] : undefined;
      return {
        repository: repo.name,
        sourceUrl: release?.url ?? `https://github.com/${repo.name}/releases`,
        unavailable: !release,
        release: release && {
          version: release.version, channel: release.channel, outcome: release.readiness, verification: release.verification,
        },
      };
    }));
  }, { serverInfo: { name: 'semverge-cloud', version: '0.1.0' } });
}

const pilotScope = { name: 'Public SemVerge', repositories: [{ name: publicRepository.name }] };
const pilotHandler = createScopedHandler(pilotScope);

async function authenticate(request: Request) {
  const expected = process.env.SEMVERGE_MCP_TOKEN_SHA256 ?? '';
  const pilotConfigured = /^[a-f0-9]{64}$/i.test(expected);
  const workspaceConfigured = Boolean(process.env.SEMVERGE_DATABASE_URL);
  const credential = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
  const reply = (status: number, error: string) => Response.json({ error }, {
    status,
    headers: { 'Cache-Control': 'no-store', ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) },
  });

  if (!pilotConfigured && !workspaceConfigured) return reply(503, 'MCP access is not configured.');
  if (!credential) return reply(401, 'A valid SemVerge MCP token is required.');
  const digest = createHash('sha256').update(credential).digest();

  let handler: ReturnType<typeof createScopedHandler>;
  if (pilotConfigured && timingSafeEqual(digest, Buffer.from(expected, 'hex'))) {
    handler = pilotHandler;
  } else if (workspaceConfigured) {
    try {
      const workspace = await configuredWorkspaceForToken(digest);
      if (!workspace) return reply(401, 'A valid SemVerge MCP token is required.');
      handler = createScopedHandler({
        name: workspace.name,
        repositories: workspace.repositories.map((binding) => ({ name: binding.name, binding })),
      });
    } catch {
      return reply(503, 'Workspace access is unavailable.');
    }
  } else {
    return reply(401, 'A valid SemVerge MCP token is required.');
  }

  const response = await handler(request);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { authenticate as GET, authenticate as POST, authenticate as DELETE };
