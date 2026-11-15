import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import { installationRepository, repositoryCandidate } from '../app/github-repository.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = { appId: '123', privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
const binding = { name: 'team/service', repositoryId: 42, installationId: 81, releaseBranch: 'semverge/release' };

test('installation reader requests one repository and keeps authenticated reads out of shared cache', async (t) => {
  const calls = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.cache, 'no-store');
    const request = new URL(url);
    assert.equal(request.origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    if (options.method === 'POST') {
      assert.equal(request.pathname, '/app/installations/81/access_tokens');
      assert.deepEqual(JSON.parse(options.body), {
        repository_ids: [42], permissions: { contents: 'read', pull_requests: 'read' },
      });
      const [header, payload, signature] = options.headers.Authorization.slice('Bearer '.length).split('.');
      assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, '123');
      assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')));
      return Response.json({ token: 'fixture-token' });
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    if (request.pathname === '/repos/team/service') return Response.json({ id: 42 });
    assert.equal(request.pathname, '/repos/team/service/releases');
    return Response.json([]);
  });

  const signal = AbortSignal.timeout(1000);
  const repository = await installationRepository(binding, credentials, signal);
  assert.deepEqual(await repository.read('releases', signal), []);
  await assert.rejects(repository.read('../other/releases', signal), /escaped its repository scope/);
  assert.equal(calls.mock.callCount(), 3);
});

test('installation reader denies a repository identity mismatch', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, options) =>
    options.method === 'POST' ? Response.json({ token: 'fixture-token' }) : Response.json({ id: 99 }));
  await assert.rejects(
    installationRepository(binding, credentials, AbortSignal.timeout(1000)),
    /identity does not match/,
  );
});


test('connection discovery requires GitHub repository admin access and a live App installation', async (t) => {
  let admin = false;
  let suspended = null;
  const calls = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    const request = new URL(url);
    if (request.pathname === '/repos/team/service') {
      assert.equal(options.headers.Authorization, 'Bearer user-fixture');
      return Response.json({ id: 42, full_name: 'Team/Service', permissions: { admin } });
    }
    assert.equal(request.pathname, '/repos/team/service/installation');
    assert.notEqual(options.headers.Authorization, 'Bearer user-fixture');
    return Response.json({ id: 81, suspended_at: suspended });
  });
  const read = () => repositoryCandidate('team/service', 'semverge/release', 'user-fixture', credentials, AbortSignal.timeout(1000));
  await assert.rejects(read(), /administrator access is required/);
  assert.equal(calls.mock.callCount(), 1);
  admin = true;
  assert.deepEqual(await read(), { ...binding, name: 'Team/Service' });
  suspended = '2026-01-01T00:00:00Z';
  await assert.rejects(read(), /installation is unavailable/);
});
