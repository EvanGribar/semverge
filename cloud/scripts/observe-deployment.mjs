import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { observeDeployment, validateTarget } from '../app/deployment-provenance.ts';

const { values } = parseArgs({
  options: Object.fromEntries(
    ['repository', 'repository-id', 'team', 'project', 'deployment', 'candidate', 'journal']
      .map((key) => [key, { type: 'string' }]),
  ),
});

const target = {
  repository: values.repository ?? '',
  repositoryId: values['repository-id'] ?? '',
  teamId: values.team ?? '',
  projectId: values.project ?? '',
  deploymentId: values.deployment ?? '',
  candidateSha: values.candidate,
};

async function read(url, token, headers = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Provider read failed.');
  return response.json();
}

try {
  validateTarget(target);
  const vercelToken = process.env.SEMVERGE_VERCEL_READ_TOKEN;
  if (!vercelToken || !values.journal) throw new Error('Set SEMVERGE_VERCEL_READ_TOKEN and provide --journal.');
  const github = `https://api.github.com/repos/${target.repository}`;
  const githubRead = (path = '') => read(github + path, process.env.SEMVERGE_GITHUB_READ_TOKEN, {
    'X-GitHub-Api-Version': '2022-11-28',
  });
  const result = await observeDeployment(target, {
    deployment: (id) => read(
      `https://api.vercel.com/v13/deployments/${id}?withGitRepoInfo=true&teamId=${target.teamId}`, vercelToken,
    ),
    repository: () => githubRead(),
    commit: (sha) => githubRead(`/commits/${sha}`),
  });
  const { startedAt, observedAt, ...outcome } = result;
  const payload = { version: 1, kind: 'deployment-observed', ...outcome };
  const signature = JSON.stringify(payload);
  const observationId = createHash('sha256').update(signature).digest('hex');
  let event = { ...payload, observationId, startedAt, observedAt };
  const directory = resolve(values.journal);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, observationId + '.json');
  const temp = join(directory, randomUUID() + '.pending');
  const file = await open(temp, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(event, null, 2) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      // Publish atomically without replacing a record from a concurrent observer.
      await link(temp, path);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const {
        observationId: savedId, startedAt: savedStart, observedAt: savedTime, ...savedPayload
      } = JSON.parse(await readFile(path, 'utf8'));
      if (savedId !== observationId || JSON.stringify(savedPayload) !== signature ||
        !Number.isFinite(Date.parse(savedStart)) || !Number.isFinite(Date.parse(savedTime))) {
        throw new Error('Existing journal record failed validation.');
      }
      event = { ...savedPayload, observationId: savedId, startedAt: savedStart, observedAt: savedTime };
    }
  } finally {
    await unlink(temp);
  }
  console.log(JSON.stringify(event, null, 2));
  if (result.status === 'unavailable' || result.candidateMatch === 'mismatch') process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
