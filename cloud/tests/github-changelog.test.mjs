import assert from 'node:assert/strict';
import test from 'node:test';
import { publishedTechnicalNotes } from '../app/github-changelog.ts';

const commit = 'a'.repeat(40);
const transaction = { sourceCommit: commit, version: '1.8.0', packageIds: ['billing'] };
const item = { id: 'billing', name: 'billing', version: '1.8.0', previousVersion: '1.7.0', changelog: 'packages/billing/CHANGELOG.md' };
const encode = (content) => ({ encoding: 'base64', content: Buffer.from(content).toString('base64') });

test('technical notes use the transaction commit and isolate the matching version', async () => {
  const seen = [];
  const repo = {
    name: 'team/service',
    async read(path) {
      seen.push(path);
      return path.startsWith('contents/release-manifest.json?')
        ? encode(JSON.stringify({ schemaVersion: 2, mode: 'single', version: '1.8.0', packages: [item] }))
        : encode('# Changelog\n\n## [1.8.0] - 2026-11-14\n\n### Features\n\nInvoice export\n\n## [1.7.0] - 2026-11-04\n\nEarlier release');
    },
  };
  const evidence = await publishedTechnicalNotes(repo, 'v1.8.0', transaction);
  assert.deepEqual(seen, [`contents/release-manifest.json?ref=${commit}`, `contents/packages/billing/CHANGELOG.md?ref=${commit}`]);
  assert.match(evidence.notes, /Invoice export/);
  assert.doesNotMatch(evidence.notes, /Earlier release/);
  assert.equal(evidence.previousVersion, '1.7.0');
  assert.equal(evidence.sources[0].url, `https://github.com/team/service/blob/${commit}/packages/billing/CHANGELOG.md`);
});

test('rejects a manifest outside the transaction and an unsafe file path', async () => {
  let manifest = { schemaVersion: 2, mode: 'single', version: '2.0.0', packages: [item] };
  const repo = { name: 'team/service', async read(path) {
    assert.equal(path, `contents/release-manifest.json?ref=${commit}`);
    return encode(JSON.stringify(manifest));
  } };
  assert.equal(await publishedTechnicalNotes(repo, 'v1.8.0', transaction), undefined);
  manifest = { ...manifest, version: '1.8.0', packages: [{ ...item, changelog: '../CHANGELOG.md' }] };
  assert.equal(await publishedTechnicalNotes(repo, 'v1.8.0', transaction), undefined);
});
