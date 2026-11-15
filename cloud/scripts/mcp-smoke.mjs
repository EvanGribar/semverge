import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('built Cloud serves authenticated, scoped MCP over Streamable HTTP', { timeout: 30_000 }, async (t) => {
  const token = randomBytes(32).toString('base64url');
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '0'], {
    env: {
      ...process.env,
      SEMVERGE_DATABASE_URL: '',
      SEMVERGE_MCP_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'),
    },
  });
  const closed = once(server, 'close');
  t.after(async () => {
    server.kill();
    await closed;
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  let address;
  for (let attempt = 0; attempt < 100; attempt++) {
    address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (address && output.includes('Ready')) break;
    if (server.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(address && output.includes('Ready'), output);

  const endpoint = new URL('/api/mcp', address);
  let session;
  let protocolVersion = '2025-03-26';
  function send(message, credential = token) {
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': protocolVersion,
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...message }),
      signal: AbortSignal.timeout(5000),
    });
  }
  async function rpc(id, method, params = {}) {
    const response = await send({ id, method, params });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    session = response.headers.get('mcp-session-id') ?? session;
    const body = await response.text();
    const payload = response.headers.get('content-type')?.includes('text/event-stream')
      ? JSON.parse(body.split(/\r?\n/).find((line) => line.startsWith('data: ')).slice(6))
      : JSON.parse(body);
    assert.equal(payload.jsonrpc, '2.0');
    assert.equal(payload.id, id);
    assert.ok(payload.result, body);
    return payload.result;
  }

  for (const credential of [null, randomBytes(32).toString('base64url')]) {
    const response = await send({ id: 0, method: 'tools/list' }, credential);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    await response.body.cancel();
  }

  const initialized = await rpc(1, 'initialize', {
    protocolVersion, capabilities: {}, clientInfo: { name: 'semverge-ci', version: '1.0.0' },
  });
  assert.equal(initialized.serverInfo.name, 'semverge-cloud');
  protocolVersion = initialized.protocolVersion;
  const notification = await send({ method: 'notifications/initialized' });
  assert.equal(notification.status, 202);
  const { tools } = await rpc(2, 'tools/list');
  assert.deepEqual(tools.map(({ name }) => name).sort(), ['latest_release_outcome', 'release_blockers', 'release_status']);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    const result = await rpc(3, 'tools/call', { name: tool.name, arguments: { repository: 'example/out-of-scope' } });
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent.repositories, ['EvanGribar/semverge']);
    assert.match(result.structuredContent.message, /not connected/);
  }
});
