import { cookies } from 'next/headers';
import { browserAuthConfig, isToken, sessionCookie, tokenDigest } from '../browser-auth';
import { configuredWorkspacesForSession } from '../workspace-store';
import { connectedRepository, loadCommitEvidence, loadQueue, loadReleaseHistory } from '../workspace-data';
import { repositorySummary, type RepositoryOverview } from '../repository-overview';
import { Workspace } from '../workspace';

export const dynamic = 'force-dynamic';

const pageSize = 6;

type Search = { workspace?: string; repository?: string; page?: string; 'sign-in'?: string; connection?: string };

function WorkspaceMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="frame">
      <a href="/">SemVerge Cloud</a>
      <section className="queue">
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const config = browserAuthConfig();
  if (!config) return <WorkspaceMessage title="Team workspaces"><p>Workspace sign-in is unavailable.</p></WorkspaceMessage>;

  const search = await searchParams;
  const token = (await cookies()).get(sessionCookie)?.value;
  const workspaces = await (isToken(token) ? configuredWorkspacesForSession(tokenDigest(token)) : Promise.resolve([])).catch(() => null);
  if (!workspaces) return <WorkspaceMessage title="Team workspaces"><p>Workspace access is unavailable. Try again shortly.</p></WorkspaceMessage>;
  if (!workspaces.length) {
    return (
      <WorkspaceMessage title="Team workspaces">
        {search['sign-in'] === 'no-membership' && <p>Your GitHub account has no SemVerge workspace membership.</p>}
        {search['sign-in'] === 'failed' && <p>GitHub sign-in failed. Try again.</p>}
        <a href="/api/auth/github">Sign in with GitHub</a>
      </WorkspaceMessage>
    );
  }

  const workspace = search.workspace ? workspaces.find(({ id }) => id === search.workspace) : workspaces[0];
  const workspaceNav = workspaces.map(({ id, name }) => ({
    label: name, href: `/workspaces?workspace=${encodeURIComponent(id)}`, current: workspace?.id === id,
  }));
  const repo = workspace?.repositories.find(({ name }) => name === search.repository);
  const overview = !!workspace && search.repository === undefined;
  const repoNav = workspace?.repositories.map(({ name }) => ({
    label: name, href: `/workspaces?${new URLSearchParams({ workspace: workspace.id, repository: name })}`, current: repo?.name === name,
  })) ?? [];
  const navigation = { workspaces: workspaceNav, repositories: workspace ? [
    { label: 'All repositories', href: `/workspaces?workspace=${encodeURIComponent(workspace.id)}`, current: overview },
    ...repoNav,
  ] : [], name: workspace?.name,
    connectWorkspaceId: workspace?.canConnectRepositories ? workspace.id : undefined,
    connection: search.connection === 'connected' ? 'Repository connected.'
      : search.connection === 'not-connected' ? 'Could not connect the repository. Check GitHub access and the workspace’s approved installations.' : undefined,
  };
  if (workspace && overview && workspace.repositories.length) {
    const lastPage = Math.ceil(workspace.repositories.length / pageSize);
    const pageNumber = Math.min(lastPage, Math.max(1, Number.parseInt(search.page ?? '', 10) || 1));
    const start = (pageNumber - 1) * pageSize;
    const selected = workspace.repositories.slice(start, start + pageSize);
    const overviewItems: RepositoryOverview[] = [];
    const pageLink = (page: number) => `/workspaces?${new URLSearchParams({ workspace: workspace.id, page: String(page) })}`;

    for (let offset = 0; offset < selected.length; offset += 3) {
      const batch = await Promise.all(selected.slice(offset, offset + 3).map(async (binding) => {
        const href = `/workspaces?${new URLSearchParams({ workspace: workspace.id, repository: binding.name })}`;
        try {
          const reader = await connectedRepository(binding, AbortSignal.timeout(5000));
          const [published, queue] = await Promise.all([loadReleaseHistory(reader, false), loadQueue(reader)]);
          return repositorySummary(binding.name, href, queue, published);
        } catch {
          return { name: binding.name, href, queue: { entries: [], unavailable: true } };
        }
      }));
      overviewItems.push(...batch);
    }

    return <Workspace navigation={navigation} overview={{
      items: overviewItems,
      previous: pageNumber > 1 ? pageLink(pageNumber - 1) : undefined,
      next: pageNumber < lastPage ? pageLink(pageNumber + 1) : undefined,
    }} />;
  }

  const reader = repo && await connectedRepository(repo, AbortSignal.timeout(5000)).catch(() => null);
  if (!reader) {
    const notice = !workspace ? 'This workspace is unavailable.'
      : !repo ? overview ? 'Connect a repository to see its releases.' : 'This repository is unavailable in the selected workspace.'
      : 'The connected repository is unavailable.';
    return <Workspace navigation={navigation} notice={notice} />;
  }

  const [published, queue, evidence] = await Promise.all([loadReleaseHistory(reader), loadQueue(reader), loadCommitEvidence(repo)]);
  return <Workspace navigation={navigation} example={published} queue={queue} evidence={evidence} />;
}
