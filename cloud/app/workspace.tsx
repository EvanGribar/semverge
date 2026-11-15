'use client';

import { useRef, useState } from 'react';
import { Field, FieldLabel } from '@ui-sdk/react/field';
import { Input } from '@ui-sdk/react/input';
import { Button } from '@ui-sdk/react/button';
import { FileInput, FileInputTrigger } from '@ui-sdk/react/file-input';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import Markdown from 'react-markdown';
import { importPlan, type Release, type ReleaseSource } from './release-data';

import type { Queue } from './github-queue';
import type { RepositoryOverview } from './repository-overview';

const maxPlanSize = 5_000_000;
const verificationLabels = {
  passed: 'Recorded checks passed',
  degraded: 'Recorded checks had warnings',
  failed: 'Recorded checks failed',
  disabled: 'Recorded checks were disabled',
  unavailable: 'Recorded check result unavailable',
};

function ReleaseDetails({ release, source }: { release: Release; source: ReleaseSource }) {
  return (
    <article className="release">
      <header className="release-heading">
        <div>
          <div className="release-name">{release.name} / {release.channel}</div>
          <h2 className="version">
            {release.previousVersion && release.previousVersion !== release.version && (
              <span className="previous">
                <span className="sr-only">From </span>v{release.previousVersion}
                <span aria-hidden="true"> → </span><span className="sr-only"> to </span>
              </span>
            )}
            <span>v{release.version}</span>
          </h2>
        </div>
        <div className="release-evidence">
          <span className="status" data-status={release.readiness}>{release.readiness === 'Passed' ? 'Readiness passed' : release.readiness}</span>
          {release.url && <a href={release.url}>View GitHub release</a>}
        </div>
      </header>
      {release.verification && (
        <p>
          {verificationLabels[release.verification.status]} · GitHub release record
          {release.verification.recordedAt && <> · <time dateTime={release.verification.recordedAt}>{release.verification.recordedAt.slice(0, 10)}</time></>}
        </p>
      )}
      {release.blockers.length > 0 && (
        <section className="blockers">
          <h3>Readiness blockers</h3>
          <ul>{release.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </section>
      )}
      {release.readiness === 'Blocked' && release.blockers.length === 0 && (
        <p className="blockers">The readiness check did not pass. Consult the original plan for details.</p>
      )}
      <Tabs defaultValue="customer">
        <TabsList aria-label="Release notes" className="tabs">
          <TabsTab value="customer">Customer impact</TabsTab>
          <TabsTab value="technical">Technical changes</TabsTab>
          <TabsTab value="changelog">{source.kind === 'Local plan' ? 'Planned changelog' : 'Version history'}</TabsTab>
        </TabsList>
        <TabsPanel value="customer" className="notes">
          <Markdown disallowedElements={['img']}>{release.customerNotes || 'No customer notes were included.'}</Markdown>
        </TabsPanel>
        <TabsPanel value="technical" className="notes">
          <Markdown disallowedElements={['img']}>{release.technicalNotes || 'No technical notes were included.'}</Markdown>
          {release.technicalSources && <ul aria-label="Changelog sources">
            {release.technicalSources.map((source) => <li key={source.url}><a href={source.url}>View {source.path} at the release commit</a></li>)}
          </ul>}
          {release.migrationGuide && <Markdown disallowedElements={['img']}>{release.migrationGuide}</Markdown>}
        </TabsPanel>
        <TabsPanel value="changelog" className="notes">
          {source.history ? (
            <ol className="history">{source.history.map((entry) => (
              <li key={entry.tag}><a href={entry.url}>{entry.tag}</a><time dateTime={entry.date}>{entry.date}</time></li>
            ))}</ol>
          ) : <Markdown disallowedElements={['img']}>{release.changelog || 'No changelog was included.'}</Markdown>}
        </TabsPanel>
      </Tabs>
    </article>
  );
}

type NavigationItem = { label: string; href: string; current: boolean };
type Navigation = { workspaces: NavigationItem[]; repositories: NavigationItem[]; name?: string; connectWorkspaceId?: string; connection?: string };

function Choices({ label, items }: { label: string; items: NavigationItem[] }) {
  return items.length ? (
    <nav className="workspace-choices" aria-label={label}>
      {items.map((item) => <a key={item.href} href={item.href} aria-current={item.current ? 'page' : undefined}>{item.label}</a>)}
    </nav>
  ) : null;
}

export function Workspace({ example, queue, navigation, notice, overview }: {
  example?: ReleaseSource;
  queue?: Queue;
  navigation?: Navigation;
  notice?: string;
  overview?: { items: RepositoryOverview[]; previous?: string; next?: string };
}) {
  const [opened, setOpened] = useState<{ source: ReleaseSource; attempt: number }>();
  const imported = opened?.source;
  const [error, setError] = useState('');
  const request = useRef(0);

  async function openPlan(file: File) {
    const attempt = ++request.current;
    setError('');
    try {
      if (file.size > maxPlanSize) throw new Error('Choose a JSON plan under 5 MB.');
      const source = importPlan(JSON.parse(await file.text()), file.name);
      if (attempt === request.current) setOpened({ source, attempt });
    } catch (cause) {
      if (attempt !== request.current) return;
      setError(cause instanceof SyntaxError ? 'This file is not valid JSON.' :
        cause instanceof Error ? cause.message : 'Could not open this plan.');
    }
  }

  return (
    <>
      <header className="top"><div className="frame top-inner">
        <a href="/" className="wordmark">SemVerge <span className="cloud">Cloud</span></a>
        {navigation ? (
          <form action="/api/auth/sign-out" method="post"><Button type="submit" className="workspace-signout">Sign out</Button></form>
        ) : <a href="/workspaces">Team workspaces</a>}
      </div></header>
      <main className="frame">
        <section className="intro">
          <h1>{navigation?.name ?? "Releases"}</h1>
          <p>Review release blockers, customer impact, technical changes, and version history.</p>
        </section>
        {navigation && <>
          <Choices label="Workspaces" items={navigation.workspaces} />
          <Choices label="Repositories" items={navigation.repositories} />
        </>}
        {navigation?.connection && <p role="status">{navigation.connection}</p>}
        {navigation?.connectWorkspaceId && (
          <form className="repository-connect" action="/api/auth/github" method="post" aria-label="Connect a repository">
            <input type="hidden" name="workspaceId" value={navigation.connectWorkspaceId} />
            <Field><FieldLabel>GitHub repository</FieldLabel>
              <Input name="repository" placeholder="owner/repository" maxLength={140} required />
            </Field>
            <Field><FieldLabel>Release branch</FieldLabel>
              <Input name="releaseBranch" defaultValue="semverge/release" maxLength={200} required />
            </Field>
            <Button className="primary" type="submit">Connect repository</Button>
          </form>
        )}
        {notice && <p role="status">{notice}</p>}
        {overview && <section className="queue" aria-labelledby="overview-title">
          <h2 id="overview-title">Repository readiness</h2>
          <div className="repository-overview">
            {overview.items.map((repository) => (
              <article className="overview-repository" key={repository.name}>
                <header>
                  <h3><a href={repository.href}>{repository.name}</a></h3>
                  {repository.latest ? <a href={repository.latest.url}>Latest release {repository.latest.version} · {repository.latest.status}</a>
                    : <span className="overview-detail">Latest release evidence unavailable</span>}
                </header>
                {repository.queue.unavailable && <p>Release queue unavailable.</p>}
                {!repository.queue.unavailable && !repository.queue.entries.length && <p>No open release plans.</p>}
                {repository.queue.entries.map((entry) => <ReleaseQueueEntry key={entry.number} entry={entry} />)}
              </article>
            ))}
          </div>
          {(overview.previous || overview.next) && <nav className="overview-pages" aria-label="Repository pages">
            {overview.previous && <a href={overview.previous}>Previous repositories</a>}
            {overview.next && <a href={overview.next}>Next repositories</a>}
          </nav>}
        </section>}
        {queue && <section className="queue" aria-labelledby="queue-title">
          <h2 id="queue-title">Open release plans</h2>
          {queue.unavailable && <p>Could not load the release queue from GitHub.</p>}
          {!queue.unavailable && queue.entries.length === 0 && <p>No open SemVerge release PRs in {example?.name}.</p>}
          {queue.entries.map((entry) => <ReleaseQueueEntry key={entry.number} entry={entry} />)}
        </section>}
        <section className="import" aria-labelledby="import-title">
          <div>
            <h2 id="import-title">Open a CLI release plan</h2>
            <p>Export a plan with <code>semverge plan "feat: add bulk export" &gt; release-plan.json</code>. The file stays in this browser tab.</p>
          </div>
          <FileInput accept=".json" maxSize={maxPlanSize} value={[]}
            onValueChange={(_, details) => { const file = details.added[0]; if (file) void openPlan(file); }}
            onReject={() => { request.current += 1; setError('Choose a JSON plan under 5 MB.'); }}>
            <FileInputTrigger className="primary">Open plan</FileInputTrigger>
          </FileInput>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
        {(example || imported) && <Tabs defaultValue={imported ? 'local' : 'example'} key={opened?.attempt ?? 0}>
          <TabsList aria-label="Release sources" className="sources">
            {example && <TabsTab value="example">{example.kind === 'GitHub releases' ? 'GitHub releases' : 'SemVerge example'}</TabsTab>}
            {imported && <TabsTab value="local">{imported.name}</TabsTab>}
          </TabsList>
          {example && <TabsPanel value="example"><Source source={example} /></TabsPanel>}
          {imported && <TabsPanel value="local"><Source source={imported} /></TabsPanel>}
        </Tabs>}
      </main>
    </>
  );
}

function ReleaseQueueEntry({ entry }: { entry: Queue['entries'][number] }) {
  return (
    <div className="queue-entry">
      <div>
        <strong>{entry.version}</strong>{entry.channel && <span className="queue-channel"> / {entry.channel}</span>}
        {entry.blockers.length > 0 && <ul>{entry.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
        <div><a href={entry.url}>View release PR #{entry.number}</a></div>
      </div>
      <span className="status" data-status={entry.status}>{entry.status === 'Passed' ? 'Readiness passed' : entry.status}</span>
    </div>
  );
}

function Source({ source }: { source: ReleaseSource }) {
  return (
    <section>
      <p className="source-label">{source.notice ?? (source.kind === 'GitHub releases'
        ? `Published releases from ${source.name}.`
        : source.kind === 'Public example' ? 'From SemVerge’s checked-in release manifest and notes.'
        : 'From the imported CLI plan. Readiness reflects the plan’s inputs.')}</p>
      {source.releases.map((release) => <ReleaseDetails key={release.name} release={release} source={source} />)}
    </section>
  );
}



