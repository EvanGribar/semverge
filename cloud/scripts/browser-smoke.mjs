import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { migrate } from './migrations.mjs';

const host = '127.0.0.1';

test('native Cloud workspace forms retain their Origin in Chromium and Firefox', { timeout: 75_000 }, async (t) => {
  const db = await PGlite.create();
  const socket = new PGLiteSocketServer({ db, host, port: 0, maxConnections: 4 });
  let server;
  let closed;
  t.after(async () => {
    if (server) {
      server.kill();
      await closed;
    }
    await socket.stop();
    await db.close();
  });

  await migrate({
    query: (statement, values) => values ? db.query(statement, values)
      : db.exec(statement).then((results) => results.at(-1)),
  });
  await socket.start();
  const workspace = randomUUID();
  await db.query('INSERT INTO semverge_workspaces VALUES ($1, $2)', [workspace, 'Browser fixture']);
  await db.query('INSERT INTO semverge_workspace_members VALUES ($1, 1, true)', [workspace]);
  const sessions = Object.fromEntries(['chromium', 'firefox'].map((browser) => [browser, randomBytes(32).toString('base64url')]));
  const digest = (token) => createHash('sha256').update(token).digest();
  for (const token of Object.values(sessions)) {
    await db.query("INSERT INTO semverge_browser_sessions VALUES ($1, 1, now() + interval '5 minutes')", [digest(token)]);
  }

  // Auth requires the exact origin at startup, so select a free port first.
  const reservation = createServer().listen(0, host);
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://${host}:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', host, '-p', String(port)], {
    env: {
      ...process.env,
      SEMVERGE_ORIGIN: origin,
      SEMVERGE_DATABASE_URL: `postgresql://postgres@${socket.getServerConn()}/postgres`,
      SEMVERGE_GITHUB_CLIENT_ID: 'synthetic-fixture',
      SEMVERGE_GITHUB_CLIENT_SECRET: 'synthetic-fixture',
    },
  });
  closed = once(server, 'close');
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100 && !output.includes('Ready') && server.exitCode === null; attempt++) {
    await delay(100);
  }
  assert.match(output, /Ready/);

  const browser = spawn('python', ['scripts/browser-smoke.py'], {
    env: { ...process.env, CLOUD_TEST_ORIGIN: origin, CLOUD_TEST_SESSIONS: JSON.stringify(sessions) },
    stdio: 'inherit',
    timeout: 50_000,
  });
  const [code, signal] = await once(browser, 'close');
  assert.equal(code, 0, `Browser checks failed (signal: ${signal}); Cloud output:\n${output}`);
  const { rows } = await db.query('SELECT count(*)::int AS count FROM semverge_browser_sessions');
  assert.equal(rows[0].count, 0, 'both browser sessions were revoked on sign-out');
});
