import { createPrivateKey, sign } from 'node:crypto';

const api = 'https://api.github.com';
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export type RepositoryBinding = {
  name: string;
  repositoryId: number;
  installationId: number;
  releaseBranch: string;
};

export type GitHubRepository = {
  name: string;
  releaseBranch: string;
  read(path: string, signal: AbortSignal, fresh?: boolean): Promise<unknown>;
};

function repositoryReader(name: string, releaseBranch: string, token?: string): GitHubRepository {
  if (!/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(name) || name.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid GitHub repository name.');
  }
  const root = new URL(`/repos/${name}/`, api);
  return {
    name,
    releaseBranch,
    async read(path, signal, fresh) {
      const url = path === './' ? new URL(root.pathname.slice(0, -1), root) : new URL(path, root);
      if (url.origin !== root.origin || !(url.pathname.startsWith(root.pathname) || url.pathname === root.pathname.slice(0, -1))) {
        throw new Error('GitHub request escaped its repository scope.');
      }
      const response = await fetch(url, {
        headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
        redirect: 'error',
        signal,
        ...(token || fresh ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
      return response.json();
    },
  };
}

export const publicRepository = repositoryReader('EvanGribar/semverge', 'semverge/release');

function base64Url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

type AppCredentials = { appId: string; privateKey: string };

function appJwt(credentials: AppCredentials) {
  if (!/^\d+$/.test(credentials.appId)) throw new Error('Invalid GitHub App ID.');
  const key = createPrivateKey(credentials.privateKey);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('A GitHub App RSA key is required.');
  const now = Math.floor(Date.now() / 1000);
  const payload = `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url({ iat: now - 60, exp: now + 540, iss: credentials.appId })}`;
  return `${payload}.${sign('RSA-SHA256', Buffer.from(payload), key).toString('base64url')}`;
}

export async function repositoryCandidate(name: string, releaseBranch: string, userToken: string,
  credentials: AppCredentials, signal: AbortSignal): Promise<RepositoryBinding> {
  const userRepository = repositoryReader(name, releaseBranch, userToken);
  const metadata = await userRepository.read('./', signal) as { id?: unknown; full_name?: unknown; permissions?: { admin?: unknown } };
  if (typeof metadata.id !== 'number' || !Number.isSafeInteger(metadata.id) || metadata.id < 1 ||
    typeof metadata.full_name !== 'string' || metadata.full_name.toLowerCase() !== name.toLowerCase() ||
    metadata.permissions?.admin !== true) throw new Error('GitHub repository administrator access is required.');
  const response = await fetch(`${api}/repos/${name}/installation`, {
    headers: { ...headers, Authorization: `Bearer ${appJwt(credentials)}` },
    redirect: 'error', cache: 'no-store', signal,
  });
  if (!response.ok) throw new Error('GitHub App is not installed on the repository.');
  const installation = await response.json() as { id?: unknown; suspended_at?: unknown };
  if (typeof installation.id !== 'number' || !Number.isSafeInteger(installation.id) ||
    installation.id < 1 || installation.suspended_at !== null) throw new Error('GitHub installation is unavailable.');
  return { name: metadata.full_name, repositoryId: metadata.id, installationId: installation.id, releaseBranch };
}

// Resolve the binding through workspace membership before calling this function.
export async function installationRepository(binding: RepositoryBinding, credentials: {
  appId: string;
  privateKey: string;
}, signal: AbortSignal, actions = false): Promise<GitHubRepository> {
  const { name, repositoryId, installationId, releaseBranch } = binding;
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 1 ||
      !Number.isSafeInteger(installationId) || installationId < 1 ||
      !/^\d+$/.test(credentials.appId)) {
    throw new Error('Invalid GitHub App binding.');
  }

  const jwt = appJwt(credentials);
  const response = await fetch(`${api}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    headers: { ...headers, 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      repository_ids: [repositoryId],
      permissions: actions ? { contents: 'read', actions: 'read' } : { contents: 'read', pull_requests: 'read' },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`GitHub installation authentication failed (${response.status}).`);
  const access = await response.json() as { token?: unknown };
  if (typeof access?.token !== 'string' || !access.token) throw new Error('GitHub returned no installation token.');

  const repository = repositoryReader(name, releaseBranch, access.token);
  const identity = await repository.read('./', signal) as { id?: unknown };
  if (identity?.id !== repositoryId) throw new Error('GitHub repository identity does not match the workspace binding.');
  return repository;
}
