import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/observe-deployment.mjs', import.meta.url));
const sha = 'a'.repeat(40);

test('records separate match, mismatch and unavailable observations across process runs', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'semverge-observations-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = join(dir, 'journal');
  const mock = join(dir, 'mock.mjs');
  await writeFile(mock, `
    import assert from 'node:assert/strict';
    globalThis.fetch = async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.method ?? 'GET', 'GET');
      const fixtures = {
        'https://api.vercel.com/v13/deployments/dpl_fixture?withGitRepoInfo=true&teamId=team_fixture':
          { id: 'dpl_fixture', projectId: 'prj_fixture', readyState: 'READY', target: 'production',
            source: 'git', gitSource: { type: 'github', repoId: 42, sha: '${sha}' } },
        'https://api.vercel.com/v13/deployments/dpl_upload?withGitRepoInfo=true&teamId=team_fixture':
          { id: 'dpl_upload', projectId: 'prj_fixture', readyState: 'READY', source: 'cli',
            meta: { githubCommitSha: '${sha}' } },
        'https://api.github.com/repos/team/service': { id: 42, full_name: 'team/service' },
        'https://api.github.com/repos/team/service/commits/${sha}': { sha: '${sha}' },
      };
      assert.ok(Object.hasOwn(fixtures, url), url);
      assert.equal(options.headers.Authorization, url.startsWith('https://api.vercel.com') ? 'Bearer fixture' : undefined);
      return Response.json(fixtures[url]);
    };
  `);

  function run(candidate, deployment, expectedExit) {
    const processResult = spawnSync(process.execPath, [
      '--import', pathToFileURL(mock).href, script, '--repository', 'team/service', '--repository-id', '42',
      '--team', 'team_fixture', '--project', 'prj_fixture', '--deployment', deployment,
      '--candidate', candidate, '--journal', journal,
    ], {
      encoding: 'utf8', env: { ...process.env, SEMVERGE_VERCEL_READ_TOKEN: 'fixture', SEMVERGE_GITHUB_READ_TOKEN: '' },
    });
    assert.equal(processResult.status, expectedExit, processResult.stderr || processResult.stdout);
    return JSON.parse(processResult.stdout);
  }

  const matched = run(sha, 'dpl_fixture', 0);
  assert.deepEqual(run(sha, 'dpl_fixture', 0), matched);
  const mismatched = run('b'.repeat(40), 'dpl_fixture', 2);
  const unavailable = run(sha, 'dpl_upload', 2);
  assert.equal(matched.candidateMatch, 'match');
  assert.equal(mismatched.candidateMatch, 'mismatch');
  assert.equal(unavailable.reason, 'github-source-unavailable');
  const entries = [matched, mismatched, unavailable];
  assert.deepEqual((await readdir(journal)).sort(), entries.map(({ observationId }) => observationId + '.json').sort());
  for (const event of entries) {
    assert.deepEqual(JSON.parse(await readFile(join(journal, event.observationId + '.json'), 'utf8')), event);
  }
});
